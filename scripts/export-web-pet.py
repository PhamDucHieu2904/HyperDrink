"""Read-only authored PET source -> optimized, role-addressable Draco GLB.

Run through Blender with --background --factory-startup --disable-autoexec.
No save_mainfile; all writes are derived assets inside the website project.
"""
import bpy, bmesh, hashlib, json, math, pathlib, struct, traceback
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'models' / 'bottles'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = pathlib.Path(r'D:\3D model\Model Bottle Can\Blender Model 1\Pet 320ml Model - for web.blend')
RING_TEXTURE = pathlib.Path(r'D:\UnityHubData\Unity_3D_Mockup_Project\Assets\Data\3D Model\Plastic.png')
ROLES = {'Body':'body', 'PlasticCap':'cap', 'Label':'label', 'Water':'liquid', 'Nata de coco':'inclusions'}
SLOTS = {'body':['pet-shell','pet-ring'], 'cap':['pet-cap'], 'label':['printed-label'], 'liquid':['nata-liquid'], 'inclusions':['nata-jelly']}
PROFILE = 'nata-pet-v1'

def write(name, data):
    (OUT/name).write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

def mat(role):
    m=bpy.data.materials.new('pet-ring' if role=='ring' else SLOTS[role][0])
    m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    defaults={
      'body':((0.96,0.98,1.0,0.09),0.075,1.0),
      'ring':((1,1,1,1),0.122,0),
      'cap':((0.91,0.90,0.84,1),0.28,0.15),
      'label':((0.96,0.95,0.91,1),0.24,0.2),
      'liquid':((1.0,0.52,0.055,0.78),0.38,0.06),
      'inclusions':((0.87,0.84,0.62,1),0.36,0.12),
    }
    color,rough,coat=defaults[role]
    p.inputs['Base Color'].default_value=color
    p.inputs['Alpha'].default_value=color[3]
    p.inputs['Metallic'].default_value=0
    p.inputs['Roughness'].default_value=rough
    p.inputs['Coat Weight'].default_value=coat
    p.inputs['Coat Roughness'].default_value=0.06 if role=='body' else 0.2
    p.inputs['IOR'].default_value=1.47 if role=='body' else 1.333 if role=='liquid' else 1.45
    # Runtime supplies the depth-dependent haze, without nested transmission passes.
    m.diffuse_color=color
    m.use_backface_culling=True
    if color[3]<1: m.surface_render_method='DITHERED'
    m['materialSlot']='body' if role=='ring' else role
    m['bottleProfile']=PROFILE
    if role=='ring':
        # Unity Ring is transparent HDRP/Lit with the supplied RGBA basemap.
        # Its RGB is white; the almost-clear alpha is the essential distinction.
        image=bpy.data.images.load(str(RING_TEXTURE),check_existing=True)
        image.colorspace_settings.name='sRGB'
        texture=m.node_tree.nodes.new('ShaderNodeTexImage'); texture.image=image
        m.node_tree.links.new(texture.outputs['Color'],p.inputs['Base Color'])
        m.node_tree.links.new(texture.outputs['Alpha'],p.inputs['Alpha'])
        m.surface_render_method='DITHERED'; m['nataRing']=True
    return m

def recalc(mesh):
    bm=bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(mesh); bm.free(); mesh.update()

def tree(mesh):
    return BVHTree.FromPolygons([v.co.copy() for v in mesh.vertices],[list(p.vertices) for p in mesh.polygons],all_triangles=False)

def uv(mesh, cylindrical=False):
    while mesh.uv_layers: mesh.uv_layers.remove(mesh.uv_layers[0])
    layer=mesh.uv_layers.new(name='UVMap')
    lo=Vector(tuple(min(v.co[i] for v in mesh.vertices) for i in range(3)))
    hi=Vector(tuple(max(v.co[i] for v in mesh.vertices) for i in range(3)))
    for p in mesh.polygons:
        values=[]
        axes=((1,2),(0,2),(0,1))[max(range(3),key=lambda i:abs(p.normal[i]))]
        for li in p.loop_indices:
            co=mesh.vertices[mesh.loops[li].vertex_index].co
            if cylindrical:
                u=(math.atan2(co.x,-co.y)/math.tau+0.5)%1
                v=(co.z-lo.z)/max(hi.z-lo.z,1e-9)
            else:
                u=(co[axes[0]]-lo[axes[0]])/max(hi[axes[0]]-lo[axes[0]],1e-9)
                v=(co[axes[1]]-lo[axes[1]])/max(hi[axes[1]]-lo[axes[1]],1e-9)
            values.append((li,u,v))
        seam=cylindrical and max(x[1] for x in values)-min(x[1] for x in values)>0.5
        for li,u,v in values: layer.data[li].uv=(u+1 if seam and u<0.5 else u,v)

def components(mesh):
    adjacent=[set() for _ in mesh.vertices]
    for e in mesh.edges:
        a,b=e.vertices; adjacent[a].add(b); adjacent[b].add(a)
    todo=set(range(len(mesh.vertices))); result=[]
    while todo:
        queue=[todo.pop()]; group=[]
        while queue:
            i=queue.pop(); group.append(i)
            for j in adjacent[i]:
                if j in todo: todo.remove(j); queue.append(j)
        result.append(group)
    return result

try:
    original_sha=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE),load_ui=False,use_scripts=False)
    authored=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.name in ROLES]
    if len(authored)!=5: raise ValueError('Expected exactly five authored PET source meshes')
    # Keep the author's saved viewport/export subdivision and smoothing. The
    # standard glTF apply-modifiers path evaluates this same dependency graph.
    modifier_settings={o.name:[dict(name=m.name,type=m.type,levels=getattr(m,'levels',None),
        renderLevels=getattr(m,'render_levels',None)) for m in o.modifiers] for o in authored}
    bpy.context.view_layer.update(); dg=bpy.context.evaluated_depsgraph_get()
    baked={}; source_counts={}; authored_normals={}
    for src in authored:
        role=ROLES[src.name]
        mesh=bpy.data.meshes.new_from_object(src.evaluated_get(dg),depsgraph=dg)
        normal_matrix=src.matrix_world.to_3x3().inverted().transposed()
        authored_normals[role]=[(normal_matrix@n.vector).normalized() for n in mesh.corner_normals]
        provenance=mesh.attributes.new(name='authoredCorner',type='INT',domain='CORNER')
        for i,entry in enumerate(provenance.data): entry.value=i+1
        mesh.transform(Matrix.Scale(0.1,4) @ src.matrix_world)
        mesh.calc_loop_triangles(); source_counts[role]=len(mesh.loop_triangles)
        o=bpy.data.objects.new('derived-'+role,mesh); bpy.context.collection.objects.link(o)
        baked[role]=o
    # Preserve the authored Ring faces as their own transparent material.
    body=baked['body']; ring_indices={i for i,m in enumerate(body.data.materials) if m and m.name=='Ring'}
    ring_faces=[p.index for p in body.data.polygons if p.material_index in ring_indices]
    for src in authored: bpy.data.objects.remove(src,do_unlink=True)
    # With the authored subdivision intact, Water already fits the PET recesses.
    # Moving vertices radially would squeeze its raised base through the shell.
    water=baked['liquid']
    # Ensure source wrap remains outside the true evaluated shoulder geometry.
    shell_tree=tree(body.data)
    bm=bmesh.new(); bm.from_mesh(water.data)
    boundaries=[e for e in bm.edges if e.is_boundary]
    if boundaries: bmesh.ops.holes_fill(bm,edges=boundaries,sides=128)
    bm.to_mesh(water.data); bm.free()
    for v in baked['label'].data.vertices:
        r=math.hypot(v.co.x,v.co.y)
        if r<1e-7: continue
        direction=Vector((v.co.x/r,v.co.y/r,0))
        hit=shell_tree.ray_cast(Vector((0,0,v.co.z)),direction,0.05)[0]
        target=max(r+0.00008,math.hypot(hit.x,hit.y)+0.00025 if hit else r+0.00025)
        v.co.x*=target/r; v.co.y*=target/r
    # Keep every authored jelly piece inside the liquid, correcting source placements only.
    recalc(water.data); wt=tree(water.data)
    jelly=baked['inclusions']; groups=components(jelly.data); adjusted=0
    def enclosed(bvh,co,margin=0):
        nearest,_,_,distance=bvh.find_nearest(co)
        if nearest is None or distance<margin: return False
        # Ray parity is valid for the concave, recessed bottle base; nearest-face
        # normal sign alone can incorrectly classify interior points at its ribs.
        direction=Vector((0.923,0.327,0.202)).normalized(); origin=co.copy(); hits=0
        for _ in range(64):
            hit=bvh.ray_cast(origin,direction,0.3)[0]
            if hit is None: break
            hits+=1; origin=hit+direction*1e-7
        return hits%2==1
    def inside(co,margin=0.0003): return enclosed(wt,co,margin)
    for group in groups:
        verts=[jelly.data.vertices[i] for i in group]
        if all(inside(v.co) for v in verts): continue
        center=sum((v.co.copy() for v in verts),Vector())/len(verts)
        target=center.copy(); target.z=min(0.071,max(0.012,target.z))
        r=math.hypot(target.x,target.y)
        if r>0.019: target.x*=0.019/r; target.y*=0.019/r
        offsets=[v.co-center for v in verts]
        shrink=1.0
        while shrink>0.25 and not all(inside(target+off*shrink) for off in offsets): shrink*=0.92
        for v,off in zip(verts,offsets): v.co=target+off*shrink
        adjusted+=1
    all_coords=[v.co for role,o in baked.items() if role!='inclusions' for v in o.data.vertices]
    lo=Vector(tuple(min(c[i] for c in all_coords) for i in range(3)))
    hi=Vector(tuple(max(c[i] for c in all_coords) for i in range(3)))
    center=(lo+hi)*0.5
    materials={role:mat(role) for role in SLOTS}
    materials['ring']=mat('ring')
    for role,o in baked.items():
        o.name=role; o.data.name=role; o.data.transform(Matrix.Translation(-center))
        o.data.materials.clear(); o.data.materials.append(materials[role])
        for p in o.data.polygons: p.material_index=0
        if role=='body' and ring_faces:
            o.data.materials.append(materials['ring'])
            for index in ring_faces: o.data.polygons[index].material_index=1
        bm=bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm,faces=list(bm.faces))
        bm.to_mesh(o.data); bm.free()
        recalc(o.data)
        # Blender transforms authored corner normals with the inverse transpose.
        # Recomputing them after nonuniform world-space baking/triangulation
        # changes the cap and the molded curves even with identical positions.
        provenance=o.data.attributes.get('authoredCorner')
        fallback=[n.vector.copy() for n in o.data.corner_normals]
        if provenance:
            normals=[authored_normals[role][entry.value-1] if 0<entry.value<=len(authored_normals[role]) else fallback[i]
                for i,entry in enumerate(provenance.data)]
            o.data.normals_split_custom_set(normals)
            o.data.attributes.remove(provenance)
        uv(o.data,role=='label')
        o['materialSlot']=role; o['assetId']='pet-320-nata'; o['bottleProfile']=PROFILE
        o['layoutProfile']='pet-wrap-v1'
        o.data.calc_loop_triangles()
    bpy.ops.object.select_all(action='DESELECT')
    for o in baked.values(): o.select_set(True)
    bpy.context.view_layer.objects.active=body
    path=OUT/'pet-320-nata.glb'
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,
        export_normals=True,export_texcoords=True,export_tangents=True,export_materials='EXPORT',
        export_animations=False,export_cameras=False,export_lights=False,export_extras=True,
        export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,
        export_draco_position_quantization=16,export_draco_normal_quantization=12,
        export_draco_texcoord_quantization=14,export_draco_generic_quantization=12)
    raw=path.read_bytes(); gltf=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
    counts={role:len(o.data.loop_triangles) for role,o in baked.items()}
    # Verify actual Draco decoding, label UV and all inclusion vertices inside the liquid.
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported={o.get('materialSlot'):o for o in bpy.context.scene.objects if o.type=='MESH'}
    if set(imported)!=set(SLOTS): raise ValueError('Role contract changed during GLB round-trip')
    decoded_water=imported['liquid']; decoded_tree=tree(decoded_water.data)
    outside=0
    for v in imported['inclusions'].data.vertices:
        co=decoded_water.matrix_world.inverted() @ (imported['inclusions'].matrix_world @ v.co)
        if not enclosed(decoded_tree,co): outside+=1
    if outside: raise ValueError(f'{outside} decoded jelly vertices outside the liquid')
    if not imported['label'].data.uv_layers: raise ValueError('Label UV missing after decoding')
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest()!=original_sha: raise ValueError('Source changed')
    manifest=dict(schemaVersion=1,assets=[dict(id='pet-320-nata',name='PET 320 ml · Nata De Coco',
        src='/models/bottles/pet-320-nata.glb',volumeMl=320,packaging='pet',layoutProfile='pet-wrap-v1',
        materialSlots=SLOTS,labelUv=dict(frontU=0.5,seam='rear',wrapS='repeat',wrapT='clamp'),
        dimensionsMeters=dict(width=hi.x-lo.x,depth=hi.y-lo.y,height=hi.z-lo.z),triangles=sum(counts.values()),
        trianglesByRole=counts,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest(),source=str(SOURCE),
        sourceSha256=original_sha,compression='KHR_draco_mesh_compression',bottleProfile=PROFILE,
        jellyPieces=len(groups),adjustedJellyPieces=adjusted,
        ringBasemap=dict(source=str(RING_TEXTURE),sha256=hashlib.sha256(RING_TEXTURE.read_bytes()).hexdigest(),embedded=True,usesAlpha=True))])
    write('assets.manifest.json',manifest)
    write('validation.json',dict(passed=True,sourceUnchanged=True,decodedJellyVerticesOutside=outside,
        roles=list(imported),evaluatedSourceTriangles=source_counts,derivedTriangles=counts,labelUv=True,
        authoredModifierSettings=modifier_settings,decimationApplied=False,authoredSmoothingPreserved=True))
    write('export-status.json',dict(state='complete',bytes=len(raw),triangles=sum(counts.values())))
except Exception:
    write('export-status.json',dict(state='failed',error=traceback.format_exc()))
    raise
