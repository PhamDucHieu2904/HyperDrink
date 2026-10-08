"""Export the 500 ml short-label bottle without reducing authored subdivision.

Run in Blender's background mode, then run pack-bottle-500.cjs with Node.
The external .blend is read-only; all derived output is inside this repository.
"""
import bpy
import hashlib
import json
import pathlib
import traceback

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / '.tmp' / 'bottle-500'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = pathlib.Path(r'D:\3D model\Model Bottle Can\Blender Model 1\500 ml Bottle Model Short Label_web.blend')
ROLES = {'Body bottle': 'body', 'Cap': 'cap', 'Label': 'label', 'Water': 'liquid', 'Aloe Pulp': 'inclusions'}

try:
    source_sha = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE), load_ui=False, use_scripts=False)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if {o.name for o in meshes} != set(ROLES):
        raise ValueError('Unexpected source objects; inspect before changing the export')
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    rows, points, evaluated = [], [], []
    for obj in meshes:
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(graph), depsgraph=graph)
        mesh.calc_loop_triangles()
        points.extend(obj.matrix_world @ v.co for v in mesh.vertices)
        rows.append(dict(name=obj.name, role=ROLES[obj.name], triangles=len(mesh.loop_triangles),
            evaluatedVertices=len(mesh.vertices), originalUvLayers=[u.name for u in obj.data.uv_layers],
            modifiers=[dict(name=m.name, type=m.type, levels=getattr(m, 'levels', None),
                renderLevels=getattr(m, 'render_levels', None), showViewport=m.show_viewport,
                showRender=m.show_render) for m in obj.modifiers]))
        # Capture the saved subdivision/triangulation result BEFORE changing UV
        # layers. A UV edit can invalidate Blender's modifier normal cache near
        # tiny base faces. Explicit evaluated corner normals preserve that form.
        evaluated.append((mesh, [n.vector.copy() for n in mesh.corner_normals]))
    minimum = [min(p[i] for p in points) for i in range(3)]
    maximum = [max(p[i] for p in points) for i in range(3)]
    center = [(a+b)/2 for a, b in zip(minimum, maximum)]

    # UVMap is the actual image sampling input of the source normal-map graph.
    # The other body UVs and all untextured water/cap UVs add unused glTF vertex
    # splits. Pruning them does not change positions, faces or explicit normals.
    # Preserve the label's UVMap for artwork to be supplied later.
    for obj, row, (mesh, normals) in zip(meshes, rows, evaluated):
        original_name = obj.data.name
        obj.data.name = original_name + '-authoring-source'
        obj.modifiers.clear()
        obj.data = mesh
        mesh.name = original_name
        keep = {'UVMap'} if ROLES[obj.name] in {'body', 'label'} else set()
        row['exportUvLayers'] = [u.name for u in obj.data.uv_layers if u.name in keep]
        for layer in list(obj.data.uv_layers):
            if layer.name not in keep:
                obj.data.uv_layers.remove(layer)
        obj.data.update()
        obj.data.normals_split_custom_set(normals)
        obj.update_tag(refresh={'DATA'})
        obj['materialSlot'] = ROLES[obj.name]
        obj['sourceObject'] = obj.name
        # Deliberately omit the Nata profile: this model contains authored aloe.
        for material in obj.data.materials:
            if material:
                material['materialSlot'] = ROLES[obj.name]
    normal_image = bpy.data.images.get('Normal.png')
    if not normal_image:
        raise ValueError('The expected normal map is missing')
    normal_path = pathlib.Path(bpy.path.abspath(normal_image.filepath))
    if not normal_path.is_file():
        raise FileNotFoundError(normal_path)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'pet-500-pruned-png.glb'),
        export_format='GLB', use_selection=True, export_apply=True,
        export_normals=True, export_texcoords=True, export_tangents=False,
        export_materials='EXPORT', export_animations=False,
        export_cameras=False, export_lights=False, export_extras=True,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
        export_draco_position_quantization=14, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12, export_image_format='AUTO')
    # The water mesh has much smaller triangles at its base. Give only that
    # primitive additional position precision to avoid collapsed triangles.
    bpy.ops.object.select_all(action='DESELECT')
    next(o for o in meshes if ROLES[o.name] == 'liquid').select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'pet-500-water-precise.glb'),
        export_format='GLB', use_selection=True, export_apply=True,
        export_normals=True, export_texcoords=True, export_tangents=False,
        export_materials='EXPORT', export_animations=False,
        export_cameras=False, export_lights=False, export_extras=True,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
        export_draco_position_quantization=16, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12, export_image_format='AUTO')
    source_unchanged = hashlib.sha256(SOURCE.read_bytes()).hexdigest() == source_sha
    if not source_unchanged:
        raise ValueError('Source hash changed during export')
    result = dict(state='complete', source=str(SOURCE), sourceSha256=source_sha,
        sourceUnchanged=source_unchanged, blenderVersion=bpy.app.version_string,
        normalMapSource=str(normal_path), normalMapSourceSha256=hashlib.sha256(normal_path.read_bytes()).hexdigest(),
        sourceBounds=dict(minimum=minimum, maximum=maximum, center=center),
        exportScale=0.1, meshes=rows, triangleCount=sum(r['triangles'] for r in rows),
        draco=dict(level=10, positionBits=14, liquidPositionBits=16, normalBits=10, uvBits=12))
except Exception:
    result = dict(state='failed', error=traceback.format_exc())
    (OUT / 'export-report.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf8')
    raise
(OUT / 'export-report.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf8')
print('BOTTLE_500_EXPORT_COMPLETE', result['triangleCount'])
