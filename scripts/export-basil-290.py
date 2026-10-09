"""Preserve authored Basil geometry; add exact Label Lab normal-offset gels.

The external Blender/Unity sources are read-only. The editable derived Blender
file contains one gel object per seed. The GLB merges those shells into one
draw-compatible mesh and also includes Label Lab High's accepted glass interface.
"""
import bpy, hashlib, json, math, pathlib, struct, sys, traceback
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

ROOT=pathlib.Path(__file__).resolve().parent.parent
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'scripts'))
from basil_290_unity_mesh import read_unity_mesh
OUT=ROOT/'public'/'models'/'bottles'
WORK=ROOT/'.tmp'/'basil-290'
AUTHORING=ROOT/'assets/source-models'
OUT.mkdir(parents=True,exist_ok=True);WORK.mkdir(parents=True,exist_ok=True)
AUTHORING.mkdir(parents=True,exist_ok=True)
SOURCE=pathlib.Path(r'D:\3D model\Model Bottle Can\Blender Model 1\Glass 290ml model (Basil) - web.blend')
UNITY=pathlib.Path(r'D:\UnityHubData\Unity_3D_Mockup_Project')
GEL_SOURCE=UNITY/'Assets/Data/3D Model/Generated/Basil Seed Gel Shell Nap Van.asset'
HIGH_SOURCE=UNITY/'Assets/Resources/Glass290/BasilVanBodyNormals.asset'
NECK_SOURCE=UNITY/'Assets/Resources/Glass290High/NeckVanMesh.asset'
PROFILE='basil-glass290-high-v1'; ASSET='glass-290-basil'; APP_SCALE=.1
ROLES={'Body':'body','Base':'body','Golden Cap':'cap','Water':'liquid','Neck':'body','Seeds':'inclusions','Label':'label'}
NAMES={'Body':'basil-authored-body','Base':'basil-authored-base','Golden Cap':'basil-gold-cap','Water':'basil-liquid','Neck':'basil-glass-neck','Seeds':'basil-seeds','Label':'printed-label'}

def write(path,value): path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def components(mesh):
    adjacency=[set() for _ in mesh.vertices]
    for edge in mesh.edges:
        a,b=edge.vertices;adjacency[a].add(b);adjacency[b].add(a)
    unseen=set(range(len(mesh.vertices)));groups=[]
    while unseen:
        queue=[min(unseen)];unseen.remove(queue[0]);group=[]
        while queue:
            i=queue.pop();group.append(i)
            for j in sorted(adjacency[i]):
                if j in unseen: unseen.remove(j);queue.append(j)
        groups.append(sorted(group))
    return groups
def unity_mesh(name,data,factor=100,alignment=1,z_offset=0):
    positions=[(-p[0]*factor*alignment,p[1]*factor*alignment,p[2]*factor*alignment+z_offset) for p in data['positions']]
    normals=[Vector((-n[0],n[1],n[2])).normalized() for n in data['normals']]
    faces=[];material_indices=[]
    for material,sub in enumerate(data['submeshes']):
        for ids in sub:
            a,b,c=(Vector(positions[i]) for i in ids)
            if (b-a).cross(c-a).dot(sum((normals[i] for i in ids),Vector()))<0: ids=(ids[0],ids[2],ids[1])
            faces.append(ids);material_indices.append(material)
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(positions,[],faces);mesh.update()
    for poly,material in zip(mesh.polygons,material_indices): poly.material_index=material;poly.use_smooth=True
    mesh.normals_split_custom_set([normals[l.vertex_index] for l in mesh.loops])
    if data['uv']:
        layer=mesh.uv_layers.new(name='UVMap')
        for loop in mesh.loops: layer.data[loop.index].uv=data['uv'][loop.vertex_index]
    return mesh
def material(name,role):
    m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF')
    settings={
      'body':((1,1,1,1),.025,0,1.52,1),
      'cap':((.54,.48,.047,1),.23,1,1.5,0),
      'liquid':((.55,.02,.08,1),.5,0,1.333,1),
      'inclusions':((.012,.018,.008,1),.65,0,1.33,0),
      'label':((.98,.98,.98,1),.2,0,1.5,0),
      'gel':((.88,.94,.91,.18),.76,0,1.335,.82),
    }
    color,rough,metal,ior,transmission=settings[role]
    p.inputs['Base Color'].default_value=color;p.inputs['Alpha'].default_value=color[3]
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    p.inputs['IOR'].default_value=ior;p.inputs['Transmission Weight'].default_value=transmission
    m.diffuse_color=color;m.use_backface_culling=True
    if color[3]<1: m.surface_render_method='DITHERED'
    m['materialSlot']='inclusions' if role=='gel' else role;m['bottleProfile']=PROFILE
    if role=='gel':m['basilGel']=True
    return m
def object_for(name,mesh,collection):
    obj=bpy.data.objects.new(name,mesh);collection.objects.link(obj);return obj
def annotate(obj):
    obj['basilProfile']='basil-high-v1'
    obj['layoutProfile']='glass-290-basil-wrap-v1'
def metadata_glb(path):
    raw=path.read_bytes();old_json_length=struct.unpack_from('<I',raw,12)[0]
    document=json.loads(raw[20:20+old_json_length]);document['asset'].setdefault('extras',{}).update(assetId=ASSET,basilProfile='basil-high-v1',sourceTopologyPreserved=True)
    data=json.dumps(document,separators=(',',':')).encode('utf-8');data+=b' '*((-len(data))%4)
    tail=raw[20+old_json_length:]
    path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(data)+len(tail))+struct.pack('<II',len(data),0x4e4f534a)+data+tail)

try:
    digests={str(p):sha(p) for p in [SOURCE,GEL_SOURCE,HIGH_SOURCE,NECK_SOURCE]}
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE),load_ui=False,use_scripts=False)
    sources=[o for o in bpy.context.scene.objects if o.type=='MESH']
    if {o.name for o in sources}!=set(ROLES):raise ValueError('Unexpected authored objects; inspect first')
    bpy.context.view_layer.update();graph=bpy.context.evaluated_depsgraph_get()
    evaluated={};audit=[];captured_normals={}
    for obj in sources:
        mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(graph),depsgraph=graph);mesh.calc_loop_triangles()
        captured_normals[obj.name]=[n.vector.copy() for n in mesh.corner_normals]
        evaluated[obj.name]=(mesh,obj.matrix_world.copy())
        audit.append(dict(name=obj.name,role=ROLES[obj.name],vertices=len(mesh.vertices),triangles=len(mesh.loop_triangles),uvLayers=[l.name for l in mesh.uv_layers],modifiers=[dict(name=m.name,type=m.type,levels=getattr(m,'levels',None),renderLevels=getattr(m,'render_levels',None)) for m in obj.modifiers]))
    seed_mesh,seed_matrix=evaluated['Seeds'];seed_groups=components(seed_mesh)
    gel_data=read_unity_mesh(GEL_SOURCE);gel_mesh=unity_mesh('LabelLab exact gel shells',gel_data)
    gel_groups=components(gel_mesh)
    if len(seed_groups)!=330 or len(gel_groups)!=len(seed_groups):raise ValueError('Expected 330 seed/gel pairs')
    # Validate against the source mesh independently of Unity's vertex ordering.
    seed_tree=KDTree(len(seed_mesh.vertices))
    for v in seed_mesh.vertices:seed_tree.insert(seed_matrix@v.co,v.index)
    seed_tree.balance();errors=[];normal_alignment=[]
    for p,n in zip(gel_data['positions'],gel_data['normals']):
        core=Vector((-100*(p[0]-n[0]*.0000832),100*(p[1]-n[1]*.0000832),100*(p[2]-n[2]*.0000832)))
        closest,index,error=seed_tree.find(core);errors.append(error)
        normal_alignment.append(Vector((-n[0],n[1],n[2])).normalized().dot(seed_mesh.vertices[index].normal))
    if max(errors)>.000001:raise ValueError('Unity gel source does not match the supplied Blender seeds: '+str(max(errors)))
    gel_material=material('basil-gel','gel');gel_mesh.materials.append(gel_material)
    authoring=bpy.data.collections.new('Basil gel per seed (Label Lab exact)');bpy.context.scene.collection.children.link(authoring)
    pair_rows=[]
    for index,ids in enumerate(gel_groups):
        remap={v:i for i,v in enumerate(ids)};id_set=set(ids)
        polys=[p for p in gel_mesh.polygons if p.vertices[0] in id_set]
        center=sum((gel_mesh.vertices[v].co for v in ids),Vector())/len(ids)
        piece=bpy.data.meshes.new('Basil Gel %03d mesh'%(index+1))
        piece.from_pydata([gel_mesh.vertices[v].co-center for v in ids],[],[[remap[v] for v in p.vertices] for p in polys]);piece.update()
        piece.materials.append(gel_material)
        original_normals=[gel_mesh.corner_normals[l].vector.copy() for p in polys for l in p.loop_indices]
        for p in piece.polygons:p.use_smooth=True
        piece.normals_split_custom_set(original_normals)
        obj=object_for('Basil Gel %03d'%(index+1),piece,authoring);obj.location=center
        obj['basilSeedIndex']=index;obj['unityNormalOffset']=.0000832;obj['sourceNormalOffset']=.00832
        piece.calc_loop_triangles();pair_rows.append(dict(index=index,name=obj.name,vertices=len(ids),triangles=len(piece.loop_triangles),center=list(center),dimensions=list(obj.dimensions)))
    # Keep all original objects/modifiers/materials editable in this derived file.
    bpy.context.scene['sourceReadOnly']=str(SOURCE);bpy.context.scene['basilGelUnityOffset']=.0000832
    bpy.ops.wm.save_as_mainfile(filepath=str(AUTHORING/'glass-290-basil-with-gel.blend'),check_existing=False)
    for obj in sources:obj.name='Authoring reference '+obj.name
    # Evaluate-preserving export objects are separate from the editable originals.
    export_collection=bpy.data.collections.new('Web export');bpy.context.scene.collection.children.link(export_collection)
    exported=[];all_points=[]
    for name,(mesh,matrix) in evaluated.items():
        obj=object_for(name,mesh,export_collection);obj.matrix_world=matrix
        obj['materialSlot']=ROLES[name];obj['bottleProfile']=PROFILE;obj['sourceObject']=name;obj['assetId']=ASSET;annotate(obj)
        if name in {'Body','Base'}:obj['basilAuthoredReference']=True
        mesh.materials.clear();mesh.materials.append(material(NAMES[name],ROLES[name]));exported.append(obj)
        all_points.extend(matrix@v.co for v in mesh.vertices)
    # Literal High uses accepted closed glass instead of the old Body/Base pair.
    high_data=read_unity_mesh(HIGH_SOURCE)
    body_points=[evaluated['Body'][1]@v.co for v in evaluated['Body'][0].vertices]
    base_points=[evaluated['Base'][1]@v.co for v in evaluated['Base'][0].vertices]
    body_width=max(p.x for p in body_points)-min(p.x for p in body_points)
    high_width=(max(p[0] for p in high_data['positions'])-min(p[0] for p in high_data['positions']))*100
    alignment=body_width/high_width
    z_offset=min(p.z for p in base_points)-min(p[2] for p in high_data['positions'])*100*alignment
    accepted_mesh=unity_mesh('Label Lab High accepted glass',high_data,alignment=alignment,z_offset=z_offset)
    accepted_mesh.materials.append(material('basil-high-outer','body'));accepted_mesh.materials.append(material('basil-high-inner','body'))
    accepted=object_for('G290_ClosedGlass',accepted_mesh,export_collection)
    accepted['materialSlot']='body';accepted['bottleProfile']=PROFILE;accepted['assetId']=ASSET;accepted['basilHighInterface']=True
    accepted['unityAlignment']=alignment;accepted['unityZOffset']=z_offset
    native_scale=100*alignment*APP_SCALE
    exported.append(accepted)
    # Export neck is already baked in Unity product-root Y-up space. Convert it
    # to Blender Z-up while reflecting Unity's imported FBX X axis only once.
    neck_data=read_unity_mesh(NECK_SOURCE)
    neck_converted=dict(neck_data,positions=[(p[0],-p[2],p[1]) for p in neck_data['positions']],normals=[(n[0],-n[2],n[1]) for n in neck_data['normals']])
    neck_mesh=unity_mesh('Label Lab High export neck',neck_converted,factor=1)
    neck_mesh.materials.append(material('basil-high-neck','body'))
    neck=object_for('G290_HighNeck',neck_mesh,export_collection)
    neck['materialSlot']='body';neck['bottleProfile']=PROFILE;neck['assetId']=ASSET;neck['basilHighNeck']=True;annotate(neck)
    exported.append(neck)
    gel=object_for('Basil Seed Gel Shell',gel_mesh,export_collection)
    gel['materialSlot']='inclusions';gel['bottleProfile']=PROFILE;gel['assetId']=ASSET;gel['basilGel']=True;gel['unityNormalOffset']=.0000832;annotate(gel)
    exported.append(gel)
    minimum=Vector(tuple(min(p[i] for p in all_points) for i in range(3)));maximum=Vector(tuple(max(p[i] for p in all_points) for i in range(3)));center=(minimum+maximum)*.5
    native_matrix=[[-native_scale,0,0,-center.x*APP_SCALE],[0,0,native_scale,(z_offset-center.z)*APP_SCALE],[0,-native_scale,0,center.y*APP_SCALE],[0,0,0,1]]
    accepted['nativeToGlbMatrix']=sum(native_matrix,[]);annotate(accepted)
    neck_matrix=[[-APP_SCALE,0,0,-center.x*APP_SCALE],[0,APP_SCALE,0,-center.z*APP_SCALE],[0,0,APP_SCALE,center.y*APP_SCALE],[0,0,0,1]]
    neck['nativeToGlbMatrix']=sum(neck_matrix,[])
    label_mesh,label_matrix=evaluated['Label'];uv_layer=label_mesh.uv_layers[0]
    front=[]
    for loop in label_mesh.loops:
        p=label_matrix@label_mesh.vertices[loop.vertex_index].co
        if abs(p.x)<.03 and p.y<-.16:front.append(float(uv_layer.data[loop.index].uv.x))
    for obj in exported:
        source_normals=captured_normals.get(obj.get('sourceObject'))
        if source_normals is None:source_normals=[n.vector.copy() for n in obj.data.corner_normals]
        normals=[(obj.matrix_world.to_3x3().inverted().transposed()@n).normalized() for n in source_normals]
        obj.data.transform(Matrix.Scale(APP_SCALE,4)@Matrix.Translation(-center)@obj.matrix_world)
        obj.matrix_world=Matrix.Identity(4);obj.data.normals_split_custom_set(normals)
        if obj.name=='Base':
            # Keep a raw fallback for the old bottom's microscopic seam faces.
            # This has every evaluated triangle and the captured authored normal;
            # Draco must not drop any of these hidden reference triangles.
            positions=[];raw_normals=[];uvs=[];indices=[];lookup={};obj.data.calc_loop_triangles()
            for triangle in obj.data.loop_triangles:
                for li in triangle.loops:
                    loop=obj.data.loops[li];p=obj.data.vertices[loop.vertex_index].co;n=normals[li];uv=obj.data.uv_layers[0].data[li].uv
                    values=(p.x,p.z,-p.y,n.x,n.z,-n.y,uv.x,1-uv.y)
                    if values not in lookup:
                        lookup[values]=len(positions)//3;positions.extend(values[:3]);raw_normals.extend(values[3:6]);uvs.extend(values[6:])
                    indices.append(lookup[values])
            write(WORK/'base-raw.json',dict(POSITION=positions,NORMAL=raw_normals,TEXCOORD_0=uvs,indices=indices,triangles=len(obj.data.loop_triangles)))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in exported:obj.select_set(True)
    bpy.context.view_layer.objects.active=exported[0]
    bpy.ops.export_scene.gltf(filepath=str(OUT/'glass-290-basil.glb'),export_format='GLB',use_selection=True,export_apply=False,export_normals=True,export_texcoords=True,export_tangents=False,export_materials='EXPORT',export_animations=False,export_cameras=False,export_lights=False,export_extras=True,export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=10,export_draco_position_quantization=24,export_draco_normal_quantization=16,export_draco_texcoord_quantization=14,export_image_format='AUTO')
    metadata_glb(OUT/'glass-290-basil.glb')
    if any(sha(pathlib.Path(p))!=digest for p,digest in digests.items()):raise ValueError('Read-only source changed')
    manifest=dict(state='complete',id=ASSET,bottleProfile=PROFILE,source=str(SOURCE),sourceSha256=digests[str(SOURCE)],sourceUnchanged=True,derivedBlend=str(WORK/'glass-290-basil-with-gel.blend'),output='glass-290-basil.glb',outputBytes=(OUT/'glass-290-basil.glb').stat().st_size,outputSha256=sha(OUT/'glass-290-basil.glb'),appMetersPerSourceUnit=APP_SCALE,sourceCenter=list(center),dimensionsMeters=list((maximum-minimum)*APP_SCALE),authored=audit,authoredTriangles=sum(r['triangles'] for r in audit),gel=dict(count=len(gel_groups),vertices=len(gel_mesh.vertices),triangles=sum(len(s) for s in gel_data['submeshes']),unityOffset=.0000832,sourceOffset=.00832,metersOffset=.000832,sourceMesh=str(GEL_SOURCE),sourceSha256=digests[str(GEL_SOURCE)],sourceCoreMaxError=max(errors),sourceNormalMinDot=min(normal_alignment),objects=pair_rows),highInterface=dict(source=str(HIGH_SOURCE),sourceSha256=digests[str(HIGH_SOURCE)],vertices=high_data['vertices'],triangles=[len(s) for s in high_data['submeshes']],nativeToSourceScale=100*alignment,nativeToMetersScale=100*alignment*APP_SCALE,sourceZOffset=z_offset,metersTranslation=[-center.x*APP_SCALE,(z_offset-center.z)*APP_SCALE,center.y*APP_SCALE],nativeAxisMapping='(-x, z, -y) for glTF Y-up; offset on glTF Y',materialNames=['basil-high-outer','basil-high-inner']),materialSlots=dict(body=['basil-authored-body','basil-authored-base','basil-glass-neck','basil-high-outer','basil-high-inner'],cap=['basil-gold-cap'],label=['printed-label'],liquid=['basil-liquid'],inclusions=['basil-seeds','basil-gel']))
    manifest.update(sha256=manifest['outputSha256'],bytes=manifest['outputBytes'],triangleCount=manifest['authoredTriangles']+manifest['gel']['triangles']+sum(manifest['highInterface']['triangles']),basilProfile='basil-high-v1',layoutProfile='glass-290-basil-wrap-v1',defaultLiquidColor='#8c0514')
    manifest['highNeck']=dict(source=str(NECK_SOURCE),sourceSha256=digests[str(NECK_SOURCE)],vertices=neck_data['vertices'],triangles=[len(s) for s in neck_data['submeshes']],materialNames=['basil-high-neck'],nativeToGlbMatrixRowMajor=neck_matrix,nativeBounds=[[min(p[i] for p in neck_data['positions']),max(p[i] for p in neck_data['positions'])] for i in range(3)])
    manifest['triangleCount']+=sum(manifest['highNeck']['triangles']);manifest['materialSlots']['body'].append('basil-high-neck')
    manifest['highInterface'].update(nativeToGlbMatrixRowMajor=native_matrix,nativeBounds=[[min(p[i] for p in high_data['positions']),max(p[i] for p in high_data['positions'])] for i in range(3)],gelThicknessNative=.0000832/alignment)
    manifest['labelUv']=dict(profile='glass-290-basil-wrap-v1',authored=True,sourceFront='-Y',glbFront='+Z',frontUSamples=sorted(set(round(x,6) for x in front)),wrapS='repeat',wrapT='clamp')
    manifest['derivedBlend']=str(AUTHORING/'glass-290-basil-with-gel.blend');manifest['derivedBlendRelative']='assets/source-models/glass-290-basil-with-gel.blend'
    write(OUT/'glass-290-basil.manifest.json',manifest);write(WORK/'export-status.json',dict(state='complete',bytes=manifest['outputBytes'],gelCount=len(gel_groups)))
except Exception:
    write(WORK/'export-status.json',dict(state='failed',error=traceback.format_exc()))
