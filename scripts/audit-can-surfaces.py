"""Read-only source/decoded GLB diagnostics; writes reports only to the workspace .tmp directory."""
import bpy, hashlib, json, math, pathlib, traceback
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / '.tmp' / 'can-surface-audit.json'
STATUS = ROOT / '.tmp' / 'can-surface-audit-status.json'
SOURCE = pathlib.Path(r"D:\3D model\Model Bottle Can\Blender Model 1")
OUT.parent.mkdir(parents=True, exist_ok=True)
manifest = json.loads((ROOT / 'public/models/cans/assets.manifest.json').read_text(encoding='utf-8'))
report = {'blender': bpy.app.version_string, 'assets': []}
ROLE = {'Can':'body','Cap':'tab','Label':'label'}

def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')

def diagnostic_mesh(obj):
    mesh = obj.data
    mesh.calc_loop_triangles()
    uv = mesh.uv_layers.active.data if mesh.uv_layers.active else None
    normals = mesh.corner_normals
    matrix = obj.matrix_world
    normal_matrix = matrix.to_3x3().inverted().transposed()
    pts = [matrix @ v.co for v in mesh.vertices]
    spans = []
    degenerate = 0
    uv_degenerate = 0
    inward = []
    low_normal = []
    shading_outliers = []
    duplicates = {}
    for loop in mesh.loops:
        point = pts[loop.vertex_index]
        normal = (normal_matrix @ normals[loop.index].vector).normalized()
        radial = Vector((point.x,point.y,0)).normalized()
        dot = normal.dot(radial)
        if obj.get('materialSlot') == 'label' and dot < .5:
            low_normal.append({'point':list(point),'normal':list(normal),'radialDot':dot,'uv':list(uv[loop.index].uv) if uv else None})
        key = tuple(round(x,7) for x in point)
        duplicates.setdefault(key,[]).append((normal,loop.index))
    seam_splits=[]
    for point, loops in duplicates.items():
        unique=[]
        for normal, index in loops:
            if all(normal.dot(prior[0]) < .999999 for prior in unique): unique.append((normal,index))
        if len(unique)>1:
            smallest=min(a[0].dot(b[0]) for i,a in enumerate(unique) for b in unique[i+1:])
            angle=math.degrees(math.acos(max(-1,min(1,smallest))))
            if angle>1:
                seam_splits.append({'point':point,'angle':angle,'normals':[list(item[0]) for item in unique], 'uvs':[list(uv[item[1]].uv) for item in unique] if uv else []})
    for tri in mesh.loop_triangles:
        a,b,c=[pts[index] for index in tri.vertices]
        cross=(b-a).cross(c-a)
        if cross.length<1e-15: degenerate+=1
        center=(a+b+c)/3
        radial=Vector((center.x,center.y,0)).normalized()
        if obj.get('materialSlot')=='label' and cross.normalized().dot(radial)<0:
            inward.append({'triangle':tri.index,'center':list(center),'uvs':[list(uv[index].uv) for index in tri.loops]})
        if uv:
            uvs=[uv[index].uv for index in tri.loops]
            u_span=max(v.x for v in uvs)-min(v.x for v in uvs)
            v_span=max(v.y for v in uvs)-min(v.y for v in uvs)
            spans.append((u_span,v_span,tri.index))
            if abs((uvs[1]-uvs[0]).cross(uvs[2]-uvs[0]))<1e-12: uv_degenerate+=1
        if cross.length>0:
            face_normal=cross.normalized()
            for index in tri.loops:
                normal=(normal_matrix @ normals[index].vector).normalized()
                dot=normal.dot(face_normal)
                if dot<.5: shading_outliers.append({'triangle':tri.index,'loop':index,'faceNormalDot':dot,'point':list(center)})
    uv_values=[v.uv for v in uv] if uv else []
    result={'name':obj.name,'role':obj.get('materialSlot'),'triangles':len(mesh.loop_triangles), 'vertices':len(mesh.vertices),
      'smoothPolygons':sum(p.use_smooth for p in mesh.polygons),'flatPolygons':sum(not p.use_smooth for p in mesh.polygons),
      'hasCustomNormals':mesh.has_custom_normals,'degenerateTriangles':degenerate,'degenerateUvTriangles':uv_degenerate,
      'uvRanges':[[min(v[i] for v in uv_values),max(v[i] for v in uv_values)] for i in range(2)] if uv else [],
      'maxTriangleUSpan':max((s[0] for s in spans),default=0),'maxTriangleVSpan':max((s[1] for s in spans),default=0),
      'hugeUSpanTriangles':sum(s[0]>.1 for s in spans),'inwardLabelTriangles':len(inward),'inwardExamples':inward[:10],
      'labelCornerNormalRadialDotBelowHalf':len(low_normal),'lowNormalExamples':low_normal[:12],
      'splitNormalPositionsAboveOneDegree':len(seam_splits),'splitNormalExamples':sorted(seam_splits,key=lambda s:-s['angle'])[:12],
      'shadingOutlierCorners':len(shading_outliers),'shadingOutlierExamples':shading_outliers[:12]}
    if uv:
        try:
            mesh.calc_tangents(uvmap=mesh.uv_layers.active.name)
            result['zeroTangents']=sum(mesh.loops[index].tangent.length<.9 for index in range(len(mesh.loops)))
            result['nonFiniteTangents']=sum(not all(math.isfinite(v) for v in mesh.loops[index].tangent) for index in range(len(mesh.loops)))
        except Exception as exc: result['tangentError']=str(exc)
    return result

def clearance(body,label):
    vertices=[body.matrix_world @ vertex.co for vertex in body.data.vertices]
    tree=BVHTree.FromPolygons(vertices,[list(poly.vertices) for poly in body.data.polygons])
    mesh=label.data; mesh.calc_loop_triangles()
    minimum=1.0; negative=0; near=0; samples=0; misses=0; bad=[]
    for tri in mesh.loop_triangles:
        a,b,c=[label.matrix_world @ mesh.vertices[index].co for index in tri.vertices]
        for ai in range(5):
            for bi in range(5-ai):
                point=a*(ai/4)+b*(bi/4)+c*(1-(ai+bi)/4)
                radial=Vector((point.x,point.y,0))
                direction=radial.normalized()
                origin=Vector((0,0,point.z)); farthest=None
                for _ in range(12):
                    hit,_,_,_=tree.ray_cast(origin,direction,.2)
                    if hit is None:break
                    farthest=Vector((hit.x,hit.y,0)).length
                    origin=hit+direction*1e-7
                if farthest is None: misses+=1;continue
                gap=radial.length-farthest; samples+=1
                minimum=min(minimum,gap)
                if gap<0:negative+=1
                if gap<25e-6:
                    near+=1
                    if len(bad)<20:bad.append({'triangle':tri.index,'point':list(point),'gap':gap})
    return {'minimumMeters':minimum,'negativeSamples':negative,'under25MicrometerSamples':near,'samples':samples,'misses':misses,'badExamples':bad,'sampling':'15 barycentric points/decoded label triangle'}

try:
    for asset in manifest['assets']:
        write(STATUS, {'state':'running','id':asset['id']})
        source_path=SOURCE/asset['sourceFile']
        source_hash=hashlib.sha256(source_path.read_bytes()).hexdigest()
        bpy.ops.wm.open_mainfile(filepath=str(source_path),load_ui=False,use_scripts=False)
        source_objects=[obj for obj in bpy.context.scene.objects if obj.type=='MESH' and obj.name in ROLE]
        for obj in source_objects:
            for modifier in obj.modifiers:
                if modifier.type=='SUBSURF':modifier.levels=modifier.render_levels=1
        bpy.context.view_layer.update();graph=bpy.context.evaluated_depsgraph_get()
        source=[]
        for original in source_objects:
            mesh=bpy.data.meshes.new_from_object(original.evaluated_get(graph),depsgraph=graph)
            obj=bpy.data.objects.new('audit-'+original.name,mesh);bpy.context.collection.objects.link(obj)
            obj.matrix_world=original.matrix_world;obj['materialSlot']=ROLE[original.name]
            source.append(diagnostic_mesh(obj))
        bpy.ops.wm.read_factory_settings(use_empty=True)
        glb_path=ROOT/'public/models/cans'/f"{asset['id']}.glb"
        bpy.ops.import_scene.gltf(filepath=str(glb_path),merge_vertices=False)
        decoded=[obj for obj in bpy.context.scene.objects if obj.type=='MESH']
        body=next(obj for obj in decoded if obj.get('materialSlot')=='body')
        label=next(obj for obj in decoded if obj.get('materialSlot')=='label')
        row={'id':asset['id'],'glbHashMatches':hashlib.sha256(glb_path.read_bytes()).hexdigest()==asset['sha256'],
          'sourceHashMatches':source_hash==asset['sourceSha256'],'sourceStillUnchanged':hashlib.sha256(source_path.read_bytes()).hexdigest()==source_hash,
          'sourceEvaluated':source,'decoded':[diagnostic_mesh(obj) for obj in decoded],'denseClearance':clearance(body,label)}
        label_diagnostic=next(item for item in row['decoded'] if item['role']=='label')
        row['passed']=(row['glbHashMatches'] and row['sourceHashMatches'] and row['sourceStillUnchanged']
          and all(item['degenerateTriangles']==0 and item['degenerateUvTriangles']==0
            and item.get('zeroTangents',1)==0 and item.get('nonFiniteTangents',1)==0 for item in row['decoded'])
          and label_diagnostic['inwardLabelTriangles']==0 and label_diagnostic['shadingOutlierCorners']==0
          and label_diagnostic['splitNormalPositionsAboveOneDegree']==0
          and row['denseClearance']['samples']>0 and row['denseClearance']['misses']==0
          and row['denseClearance']['negativeSamples']==0 and row['denseClearance']['under25MicrometerSamples']==0)
        report['assets'].append(row);write(OUT,report)
    write(STATUS,{'state':'complete','count':len(report['assets']),'passed':all(row['passed'] for row in report['assets'])})
except Exception:
    report['error']=traceback.format_exc();write(OUT,report);write(STATUS,{'state':'failed','error':report['error']})

