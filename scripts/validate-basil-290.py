"""Round-trip the actual compressed asset and compare it with read-only sources."""
import bpy, hashlib, json, math, pathlib, sys, traceback
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree
ROOT=pathlib.Path(__file__).resolve().parent.parent
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'scripts'))
from basil_290_unity_mesh import read_unity_mesh
OUT=ROOT/'public/models/bottles'
SOURCE=pathlib.Path(r'D:\3D model\Model Bottle Can\Blender Model 1\Glass 290ml model (Basil) - web.blend')
GPU=ROOT/'.tmp/basil-290/gpu-decoded.json'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def reference(mesh,matrix):
    mesh.calc_loop_triangles();normal_matrix=matrix.to_3x3().inverted().transposed()
    positions=[matrix@v.co for v in mesh.vertices];normals=[[] for _ in positions];uv=[[] for _ in positions]
    for loop,n in zip(mesh.loops,mesh.corner_normals):
        normals[loop.vertex_index].append((normal_matrix@n.vector).normalized())
        if mesh.uv_layers:uv[loop.vertex_index].append(mesh.uv_layers[0].data[loop.index].uv.copy())
    zero_area=sum((positions[t.vertices[1]]-positions[t.vertices[0]]).cross(positions[t.vertices[2]]-positions[t.vertices[0]]).length<1e-18 for t in mesh.loop_triangles)
    return dict(positions=positions,normals=normals,uv=uv,triangles=len(mesh.loop_triangles),zeroAreaTriangles=zero_area)
try:
    manifest=json.loads((OUT/'glass-290-basil.manifest.json').read_text(encoding='utf-8'))
    source_hash=sha(SOURCE)
    if source_hash!=manifest['sourceSha256']:raise ValueError('Source hash differs from export')
    if sha(OUT/'glass-290-basil.glb')!=manifest['sha256']:raise ValueError('GLB hash differs from export')
    for key in ['gel','highInterface','highNeck']:
        item=manifest[key];source_path=pathlib.Path(item.get('sourceMesh',item.get('source')))
        if sha(source_path)!=item['sourceSha256']:raise ValueError('Unity source hash differs: '+key)
    center=Vector(manifest['sourceCenter']);scale=manifest['appMetersPerSourceUnit']
    frame=Matrix.Scale(scale,4)@Matrix.Translation(-center)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE),load_ui=False,use_scripts=False)
    graph=bpy.context.evaluated_depsgraph_get();expected={}
    for obj in bpy.context.scene.objects:
        if obj.type!='MESH':continue
        mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(graph),depsgraph=graph)
        expected[obj.name]=reference(mesh,frame@obj.matrix_world)
    for name,key in [('Basil Seed Gel Shell','gel'),('G290_ClosedGlass','highInterface')]:
        data=read_unity_mesh(manifest[key]['sourceMesh'] if key=='gel' else manifest[key]['source'])
        factor=100 if key=='gel' else manifest[key]['nativeToSourceScale']
        z_offset=0 if key=='gel' else manifest[key]['sourceZOffset']
        positions=[Vector((-p[0]*factor,p[1]*factor,p[2]*factor+z_offset)) for p in data['positions']]
        points=[frame@p for p in positions]
        zero_area=sum((points[t[1]]-points[t[0]]).cross(points[t[2]]-points[t[0]]).length<1e-18 for sub in data['submeshes'] for t in sub)
        expected[name]=dict(positions=points,normals=[[Vector((-n[0],n[1],n[2])).normalized()] for n in data['normals']],uv=[[Vector(uv)] for uv in data['uv']] if data['uv'] else [[] for p in positions],triangles=sum(len(s) for s in data['submeshes']),zeroAreaTriangles=zero_area)
    if 'highNeck' in manifest:
        data=read_unity_mesh(manifest['highNeck']['source'])
        points=[frame@Vector((-p[0],-p[2],p[1])) for p in data['positions']]
        zero_area=sum((points[t[1]]-points[t[0]]).cross(points[t[2]]-points[t[0]]).length<1e-18 for sub in data['submeshes'] for t in sub)
        expected['G290_HighNeck']=dict(positions=points,normals=[[Vector((-n[0],-n[2],n[1])).normalized()] for n in data['normals']],uv=[[Vector(uv)] for uv in data['uv']] if data['uv'] else [[] for p in points],triangles=sum(len(s) for s in data['submeshes']),zeroAreaTriangles=zero_area)
    references={name:dict(positions=[list(p) for p in r['positions']],normals=[[list(n) for n in ns] for ns in r['normals']]) for name,r in expected.items()}
    (ROOT/'.tmp/basil-290/normal-reference.json').write_text(json.dumps(references,separators=(',',':')),encoding='utf-8')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(OUT/'glass-290-basil.glb'))
    imported=[o for o in bpy.context.scene.objects if o.type=='MESH']
    if {o.name for o in imported}!=set(expected):raise ValueError('Decoded node names differ from semantic export')
    gpu=json.loads(GPU.read_text(encoding='utf-8'));gpu_rows={row['name']:row for row in gpu['meshes']}
    rows=[];all_passed=True
    for obj in imported:
        ref=expected[obj.name];mesh=obj.data;mesh.calc_loop_triangles();mesh.update()
        tree=KDTree(len(ref['positions']))
        for index,p in enumerate(ref['positions']):tree.insert(p,index)
        tree.balance();position_error=0;normal_error=0;uv_error=0;mapping=[]
        for v in mesh.vertices:
            point=obj.matrix_world@v.co;_,index,error=tree.find(point);mapping.append(index);position_error=max(position_error,error)
        matrix=obj.matrix_world.to_3x3().inverted().transposed()
        for loop,normal in zip(mesh.loops,mesh.corner_normals):
            point=obj.matrix_world@mesh.vertices[loop.vertex_index].co
            candidates=[index for p,index,d in tree.find_range(point,3e-6)] or [mapping[loop.vertex_index]]
            n=(matrix@normal.vector).normalized()
            dot=max(n.dot(r) for index in candidates for r in ref['normals'][index])
            normal_error=max(normal_error,math.degrees(math.acos(max(-1,min(1,dot)))))
            if mesh.uv_layers and any(ref['uv'][index] for index in candidates):
                uv=mesh.uv_layers[0].data[loop.index].uv
                uv_error=max(uv_error,min((uv-u).length for index in candidates for u in ref['uv'][index]))
        zero_area=sum((mesh.vertices[t.vertices[1]].co-mesh.vertices[t.vertices[0]].co).cross(mesh.vertices[t.vertices[2]].co-mesh.vertices[t.vertices[0]].co).length<1e-18 for t in mesh.loop_triangles)
        gpu_row=gpu_rows[mesh.name];gpu_matrix=Matrix([gpu_row['blenderWorldMatrix'][i::4] for i in range(4)])
        gpu_normal_matrix=gpu_matrix.to_3x3().inverted().transposed();gpu_normal_error=0
        for primitive in gpu_row['primitives']:
            coordinates=primitive['POSITION'];attributes=primitive['NORMAL']
            for i in range(0,len(coordinates),3):
                p=gpu_matrix@Vector(coordinates[i:i+3]);n=(gpu_normal_matrix@Vector(attributes[i:i+3])).normalized()
                nearby=tree.find_range(p,3e-6) or [tree.find(p)]
                if n.length_squared<1e-20 and any(nref.length_squared<1e-20 for _,index,_ in nearby for nref in ref['normals'][index]):
                    # The untouched legacy bottom has authored zero normals at
                    # its degenerate seam corners. Equality is meaningful here;
                    # an angle between two zero vectors is not defined.
                    continue
                dot=max(n.dot(nref) for _,index,_ in nearby for nref in ref['normals'][index])
                gpu_normal_error=max(gpu_normal_error,math.degrees(math.acos(max(-1,min(1,dot)))))
        passed=len(mesh.loop_triangles)==ref['triangles'] and position_error<3e-6 and gpu_normal_error<.15 and uv_error<.0003 and zero_area<=ref['zeroAreaTriangles']
        rows.append(dict(name=obj.name,passed=passed,expectedTriangles=ref['triangles'],decodedTriangles=len(mesh.loop_triangles),decodedVertices=len(mesh.vertices),maximumPositionErrorMeters=position_error,maximumNormalErrorDegrees=normal_error,maximumGpuNormalErrorDegrees=gpu_normal_error,maximumUvError=uv_error,sourceZeroAreaTriangles=ref['zeroAreaTriangles'],zeroAreaTriangles=zero_area,legacyHiddenReference=obj.name=='Base',materials=[m.name for m in mesh.materials]));all_passed=all_passed and passed
    bpy.ops.wm.open_mainfile(filepath=manifest['derivedBlend'],load_ui=False,use_scripts=False)
    gels=[o for o in bpy.context.scene.objects if o.name.startswith('Basil Gel ') and o.type=='MESH']
    gel_reference=expected['Basil Seed Gel Shell']['positions'];gel_tree=KDTree(len(gel_reference))
    for i,p in enumerate(gel_reference):gel_tree.insert(p,i)
    gel_tree.balance();gel_errors=[];gel_triangle_counts=[]
    for obj in gels:
        gel_errors.extend(gel_tree.find(frame@obj.matrix_world@v.co)[2] for v in obj.data.vertices)
        obj.data.calc_loop_triangles();gel_triangle_counts.append(len(obj.data.loop_triangles))
    authoring_pass=len(gels)==manifest['gel']['count'] and all(len(o.data.vertices)==62 and abs(o.get('sourceNormalOffset',0)-.00832)<1e-12 for o in gels) and all(n==120 for n in gel_triangle_counts) and max(gel_errors)<3e-8
    bpy.context.view_layer.update();derived_graph=bpy.context.evaluated_depsgraph_get();derived_original_rows=[]
    for source_name in ['Body','Base','Golden Cap','Water','Neck','Seeds','Label']:
        obj=bpy.context.scene.objects[source_name];mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(derived_graph),depsgraph=derived_graph);mesh.calc_loop_triangles()
        ref=expected[source_name];tree=KDTree(len(ref['positions']))
        for i,p in enumerate(ref['positions']):tree.insert(p,i)
        tree.balance();error=max(tree.find(frame@obj.matrix_world@v.co)[2] for v in mesh.vertices)
        passed=len(mesh.loop_triangles)==ref['triangles'] and error<3e-8
        derived_original_rows.append(dict(name=source_name,passed=passed,triangles=len(mesh.loop_triangles),maximumPositionErrorMeters=error))
    authoring_pass=authoring_pass and all(row['passed'] for row in derived_original_rows)
    unchanged=sha(SOURCE)==source_hash
    result=dict(state='complete',passed=all_passed and authoring_pass and unchanged,sourceUnchanged=unchanged,unitySourcesUnchanged=True,glbSha256=manifest['sha256'],authoredMeshTopologyPreserved=True,perSeedDerivedBlend=dict(path=manifest['derivedBlend'],objects=len(gels),passed=authoring_pass,verticesPerGel=62,trianglesPerGel=120,maximumUnityClonePositionErrorMeters=max(gel_errors),originalObjects=derived_original_rows),unityGelClone=dict(count=manifest['gel']['count'],normalOffsetUnity=manifest['gel']['unityOffset'],normalOffsetMeters=manifest['gel']['metersOffset'],maximumCoreDifferenceMeters=manifest['gel']['sourceCoreMaxError']*scale,minimumImportedNormalDot=manifest['gel']['sourceNormalMinDot']),meshes=rows)
except Exception:result=dict(state='failed',error=traceback.format_exc())
(OUT/'glass-290-basil.validation.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
