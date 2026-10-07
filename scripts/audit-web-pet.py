"""Independent decoded PET diagnostics. No source or derived asset mutation."""
import bpy, bmesh, json, math, pathlib, hashlib, traceback
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
ROOT=pathlib.Path(__file__).resolve().parent.parent
OUT=ROOT/'.tmp/pet-320/decoded-audit.json'
PUBLIC=ROOT/'public/models/bottles/surface-audit.json'
manifest=json.loads((ROOT/'public/models/bottles/assets.manifest.json').read_text(encoding='utf8'))['assets'][0]

def pts(obj): return [obj.matrix_world @ v.co for v in obj.data.vertices]
def tree(obj): return BVHTree.FromPolygons(pts(obj),[list(p.vertices) for p in obj.data.polygons])
def signed_dist(bvh,point):
    nearest,normal,_,distance=bvh.find_nearest(point)
    return (point-nearest).dot(normal) if nearest is not None else None

PARITY_DIRECTIONS=[Vector(d).normalized() for d in [(1,.137,.271),(.193,1,.319),(.227,.173,1),(-1,.379,.113),(.311,-1,.419)]]
def parity_inside(bvh,point):
    # A nearest-face normal cannot classify the interior of a concave PET base.
    # Use five unrelated rays and majority parity to avoid shared edges/vertices.
    votes=[]
    for direction in PARITY_DIRECTIONS:
        origin=point.copy();hits=0
        for _ in range(128):
            hit,_,_,_=bvh.ray_cast(origin,direction,.3)
            if hit is None:break
            hits+=1;origin=hit+direction*1e-7
        votes.append(hits%2==1)
    return sum(votes)>=3,len(set(votes))>1

def radial_outer(bvh,point):
    direction=Vector((point.x,point.y,0)).normalized();origin=Vector((0,0,point.z));outer=None
    for _ in range(12):
        hit,_,_,_=bvh.ray_cast(origin,direction,.1)
        if hit is None:break
        outer=Vector((hit.x,hit.y,0)).length;origin=hit+direction*1e-7
    return outer

def diagnostic(obj):
    mesh=obj.data;mesh.calc_loop_triangles();coords=pts(obj);uv=mesh.uv_layers.active.data
    normal_matrix=obj.matrix_world.to_3x3().inverted().transposed()
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
    boundary=sum(e.is_boundary for e in bm.edges);nonmanifold=sum(not e.is_manifold for e in bm.edges)
    volume=bm.calc_volume(signed=True)
    boundary_points=[obj.matrix_world@v.co for e in bm.edges if e.is_boundary for v in e.verts]
    boundary_z=[min(p.z for p in boundary_points),max(p.z for p in boundary_points)]if boundary_points else []
    bm.free()
    degenerate=0;uv_deg=0;inward=0;max_uspan=0;outlier_corners=0
    for tri in mesh.loop_triangles:
        a,b,c=[coords[i] for i in tri.vertices];cross=(b-a).cross(c-a)
        if cross.length<1e-15:degenerate+=1
        if uv:
            t=[uv[i].uv for i in tri.loops]
            uv_deg+=abs((t[1]-t[0]).cross(t[2]-t[0]))<1e-12
            max_uspan=max(max_uspan,max(v.x for v in t)-min(v.x for v in t))
        if obj.get('materialSlot')=='label':
            center=(a+b+c)/3;radial=Vector((center.x,center.y,0))
            if cross.dot(radial)<0:inward+=1
        if cross.length>0:
            fn=cross.normalized()
            for i in tri.loops:
                n=(normal_matrix@mesh.corner_normals[i].vector).normalized()
                if n.dot(fn)<.5:outlier_corners+=1
    return dict(role=obj.get('materialSlot'),triangles=len(mesh.loop_triangles),vertices=len(mesh.vertices),
        smoothTriangles=sum(mesh.polygons[t.polygon_index].use_smooth for t in mesh.loop_triangles),
        flatTriangles=sum(not mesh.polygons[t.polygon_index].use_smooth for t in mesh.loop_triangles),
        boundaryEdgesWelded=boundary,boundaryHeightRange=boundary_z,nonManifoldEdgesWelded=nonmanifold,signedVolume=volume,
        degenerateTriangles=degenerate,degenerateUvTriangles=uv_deg,inwardLabelTriangles=inward,
        maxTriangleUSpan=max_uspan,shadingOutlierCorners=outlier_corners,
        uvRange=[[min(v.uv[i] for v in uv),max(v.uv[i] for v in uv)]for i in range(2)])

def clearance(body,label):
    bvh=tree(body);mesh=label.data;mesh.calc_loop_triangles();coords=pts(label)
    gaps=[];misses=0;bad=[]
    for tri in mesh.loop_triangles:
        a,b,c=[coords[i]for i in tri.vertices]
        for ai in range(5):
            for bi in range(5-ai):
                point=a*(ai/4)+b*(bi/4)+c*(1-(ai+bi)/4)
                radial=Vector((point.x,point.y,0));direction=radial.normalized();origin=Vector((0,0,point.z));outer=None
                for _ in range(12):
                    hit,_,_,_=bvh.ray_cast(origin,direction,.1)
                    if hit is None:break
                    outer=Vector((hit.x,hit.y,0)).length;origin=hit+direction*1e-7
                if outer is None:misses+=1;continue
                gap=radial.length-outer;gaps.append(gap)
                if gap<25e-6 and len(bad)<12:bad.append(dict(triangle=tri.index,point=list(point),gap=gap))
    return dict(minimumMeters=min(gaps),negativeSamples=sum(g<0 for g in gaps),under25MicrometerSamples=sum(g<25e-6 for g in gaps),samples=len(gaps),misses=misses,badExamples=bad)

def sampled_nesting(obj,bvh,radial=False,parity=False):
    mesh=obj.data;mesh.calc_loop_triangles();coords=pts(obj);distances=[];radial_gaps=[];bad=[];outside=0;disagreement=0;minimum_distance=1
    for tri in mesh.loop_triangles:
        a,b,c=[coords[i]for i in tri.vertices]
        for ai in range(5):
            for bi in range(5-ai):
                point=a*(ai/4)+b*(bi/4)+c*(1-(ai+bi)/4)
                distance=signed_dist(bvh,point);distances.append(distance)
                nearest,_,_,euclidean=bvh.find_nearest(point);minimum_distance=min(minimum_distance,euclidean)
                if parity:
                    inside,disagrees=parity_inside(bvh,point);disagreement+=disagrees;is_outside=not inside
                else:is_outside=distance>=0
                outside+=is_outside
                if is_outside and len(bad)<10:bad.append(dict(triangle=tri.index,point=list(point),signedNearestDistance=distance))
                if radial:
                    outer=radial_outer(bvh,point)
                    if outer is not None:radial_gaps.append(Vector((point.x,point.y,0)).length-outer)
    return dict(samples=len(distances),outsideSamples=outside,method='majority ray parity (five directions)'if parity else 'signed nearest surface plus radial outer shell',
        signedNearestPositiveSamples=sum(d>=0 for d in distances),signedNearestMinimumInset=-max(distances),minimumEuclideanDistance=minimum_distance,
        parityDisagreementSamples=disagreement,
        radialOutsideSamples=sum(d>=0 for d in radial_gaps),minimumRadialInset=-max(radial_gaps)if radial_gaps else None,badExamples=bad)

try:
    asset=ROOT/'public/models/bottles/pet-320-nata.glb'
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(asset),merge_vertices=False)
    decoded={obj.get('materialSlot'):obj for obj in bpy.context.scene.objects if obj.type=='MESH'}
    body=decoded['body'];liquid=decoded['liquid'];label=decoded['label'];jelly=decoded['inclusions']
    body_tree=tree(body);water_tree=tree(liquid)
    liquid_points=pts(liquid);liquid_d=[signed_dist(body_tree,p) for p in liquid_points]
    exterior=[];outside_by_material={}
    for p,d in zip(liquid_points,liquid_d):
        if d<0:continue
        _,_,face,_=body_tree.find_nearest(p)
        mat=body.data.materials[body.data.polygons[face].material_index].name
        outside_by_material[mat]=outside_by_material.get(mat,0)+1
        exterior.append(p)
    shell_faces=[list(poly.vertices)for poly in body.data.polygons if body.data.materials[poly.material_index].name=='pet-shell']
    shell_tree=BVHTree.FromPolygons(pts(body),shell_faces)
    liquid_shell_d=[signed_dist(shell_tree,p)for p in liquid_points]
    shell_exterior=[p for p,d in zip(liquid_points,liquid_shell_d)if d>=0]
    histogram={str(i):sum(i/1000<=p.z<(i+10)/1000 for p in exterior)for i in range(-80,81,10)}
    liquid_radial=[]
    for p in liquid_points:
        outer=radial_outer(body_tree,p)
        if outer is not None:liquid_radial.append((Vector((p.x,p.y,0)).length-outer,p))
    jelly_points=pts(jelly);jelly_d=[signed_dist(water_tree,p) for p in jelly_points]
    jelly_parity=[parity_inside(water_tree,p)for p in jelly_points]
    report=dict(assetSha256=hashlib.sha256(asset.read_bytes()).hexdigest(),assetShaMatches=hashlib.sha256(asset.read_bytes()).hexdigest()==manifest['sha256'],
        sourceSha256=hashlib.sha256(pathlib.Path(manifest['source']).read_bytes()).hexdigest(),
        sourceShaMatches=hashlib.sha256(pathlib.Path(manifest['source']).read_bytes()).hexdigest()==manifest['sourceSha256'],
        decoded=[diagnostic(obj)for obj in decoded.values()],labelClearance=clearance(body,label),
        liquidNesting=dict(outsideVertices=sum(d>=0 for d in liquid_d),minimumInsetMeters=-max(liquid_d),
            outsideHeightRange=[min(p.z for p in exterior),max(p.z for p in exterior)]if exterior else [],
            outsideByClosestMaterial=outside_by_material,outsideTenMillimeterHistogram=histogram,
            shellOnlyOutsideVertices=len(shell_exterior),shellOnlyMaxProtrusion=max(liquid_shell_d),
            radialOutsideVertices=sum(d>=0 for d,p in liquid_radial),maximumRadialProtrusion=max(d for d,p in liquid_radial),
            radialBadExamples=[dict(protrusion=d,point=list(p))for d,p in sorted(liquid_radial,key=lambda item:-item[0])[:12]]),
        jellyNesting=dict(outsideVertices=sum(not inside for inside,_ in jelly_parity),parityDisagreementVertices=sum(disagreement for _,disagreement in jelly_parity),
            signedNearestPositiveVertices=sum(d>=0 for d in jelly_d),signedNearestMinimumInsetMeters=-max(jelly_d)),
        denseLiquidNesting=sampled_nesting(liquid,body_tree,True),denseJellyNesting=sampled_nesting(jelly,water_tree,parity=True))
    # Verify actual decoded positions against a fresh, unmodified source
    # evaluation. No disabled modifiers, decimation, or normal/smoothing reset.
    decoded_points={role:pts(obj)for role,obj in decoded.items()}
    decoded_corners={}
    for role,obj in decoded.items():
        normal_matrix=obj.matrix_world.to_3x3().inverted().transposed()
        decoded_corners[role]=[(obj.matrix_world@obj.data.vertices[loop.vertex_index].co,(normal_matrix@obj.data.corner_normals[loop.index].vector).normalized())for loop in obj.data.loops]
    bpy.ops.wm.open_mainfile(filepath=manifest['source'],load_ui=False,use_scripts=False)
    roles={'Body':'body','PlasticCap':'cap','Label':'label','Water':'liquid','Nata de coco':'inclusions'}
    graph=bpy.context.evaluated_depsgraph_get();source_points={};source_counts={};source_modifiers={};source_smoothing={};source_normals={}
    for obj in bpy.context.scene.objects:
        if obj.type!='MESH'or obj.name not in roles:continue
        role=roles[obj.name]
        mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(graph),depsgraph=graph);mesh.calc_loop_triangles()
        source_points[role]=[obj.matrix_world@v.co*.1 for v in mesh.vertices];source_counts[role]=len(mesh.loop_triangles)
        normal_matrix=obj.matrix_world.to_3x3().inverted().transposed();normals=[[]for v in mesh.vertices]
        for loop in mesh.loops:normals[loop.vertex_index].append((normal_matrix@mesh.corner_normals[loop.index].vector).normalized())
        source_normals[role]=normals
        source_smoothing[role]=dict(smoothTriangles=sum(mesh.polygons[t.polygon_index].use_smooth for t in mesh.loop_triangles),flatTriangles=sum(not mesh.polygons[t.polygon_index].use_smooth for t in mesh.loop_triangles))
        source_modifiers[obj.name]=[dict(name=m.name,type=m.type,viewportLevels=getattr(m,'levels',None),renderLevels=getattr(m,'render_levels',None),showViewport=m.show_viewport,showRender=m.show_render)for m in obj.modifiers]
        bpy.data.meshes.remove(mesh)
    all_points=[p for role,points in source_points.items()if role!='inclusions'for p in points]
    lo=Vector(tuple(min(p[i]for p in all_points)for i in range(3)));hi=Vector(tuple(max(p[i]for p in all_points)for i in range(3)));center=(lo+hi)/2
    fidelity={};normal_fidelity={}
    for role in ['body','cap','liquid']:
        points=source_points[role];kd=KDTree(len(points))
        for i,p in enumerate(points):kd.insert(p-center,i)
        kd.balance();errors=[kd.find(p)[2]for p in decoded_points[role]]
        fidelity[role]=dict(maximumDecodedVertexErrorMeters=max(errors),sourceTriangles=source_counts[role],decodedTriangles=next(d['triangles']for d in report['decoded']if d['role']==role))
        angles=[]
        for p,normal in decoded_corners[role]:
            # The tamper-ring mesh has coincident, disconnected authored
            # vertices with distinct normals. Consider all positions within
            # the decoded quantization tolerance instead of a random KD tie.
            nearby=kd.find_range(p,5e-6)
            if not nearby:nearby=[kd.find(p)]
            best=max(normal.dot(n)for _,index,_ in nearby for n in source_normals[role][index])
            angles.append(math.degrees(math.acos(max(-1,min(1,best)))))
        normal_fidelity[role]=dict(maximumCornerAngleDegrees=max(angles),overOneDegree=sum(a>1 for a in angles),overFiveDegrees=sum(a>5 for a in angles),corners=len(angles),
            method='decoded explicit corner normal versus authored evaluated vertex corner normals within 5 micrometers')
    report['sourceFidelity']=dict(modifierSettings=source_modifiers,evaluatedSourceTriangles=source_counts,positionChecks=fidelity,
        expectedLiquidClosureTriangles=94,
        authoredSmoothing=source_smoothing,normalFidelity=normal_fidelity,
        importedSmoothingNote='glTF stores explicit vertex normals; Blender reconstructs smooth/flat flags when importing, so those flags are diagnostic rather than a fidelity gate')
    report['sourceStillUnchanged']=hashlib.sha256(pathlib.Path(manifest['source']).read_bytes()).hexdigest()==manifest['sourceSha256']
    report['passed']=all([report['assetShaMatches'],report['sourceShaMatches'],report['sourceStillUnchanged'],
        all(d['degenerateTriangles']==0 and d['degenerateUvTriangles']==0 for d in report['decoded']),
        all(d['inwardLabelTriangles']==0 for d in report['decoded']),
        all(v['maximumDecodedVertexErrorMeters']<25e-6 for v in fidelity.values()),
        all(v['maximumCornerAngleDegrees']<5 for v in normal_fidelity.values()),
        report['labelClearance']['negativeSamples']==0,report['labelClearance']['under25MicrometerSamples']==0,report['labelClearance']['misses']==0,
        report['denseLiquidNesting']['outsideSamples']==0,report['denseLiquidNesting']['radialOutsideSamples']==0,
        report['denseJellyNesting']['outsideSamples']==0,
        next(d['boundaryEdgesWelded']for d in report['decoded']if d['role']=='liquid')==0])
    OUT.write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    if report['passed']:PUBLIC.write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print('PET_DECODED_AUDIT_COMPLETE',report['passed'])
except Exception:
    OUT.write_text(json.dumps(dict(error=traceback.format_exc()),indent=2),encoding='utf8');raise
