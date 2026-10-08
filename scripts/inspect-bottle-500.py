"""Read-only inspection of the supplied 500 ml PET authoring file."""
import bpy, hashlib, json, pathlib, traceback

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / '.tmp' / 'bottle-500'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = pathlib.Path(r'D:\3D model\Model Bottle Can\Blender Model 1\500 ml Bottle Model Short Label_web.blend')
try:
    original_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE), load_ui=False, use_scripts=False)
    rows = []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            rows.append(dict(name=obj.name, type=obj.type, hidden=obj.hide_render))
            continue
        obj.data.calc_loop_triangles()
        modifiers = [dict(name=m.name, type=m.type, levels=getattr(m, 'levels', None), renderLevels=getattr(m, 'render_levels', None),
            showViewport=m.show_viewport, showRender=m.show_render) for m in obj.modifiers]
        saved = {m.name: m.levels for m in obj.modifiers if m.type == 'SUBSURF'}
        levels = sorted(set([1, *saved.values()]))
        counts = []
        for level in levels:
            for m in obj.modifiers:
                if m.type == 'SUBSURF': m.levels = level
            bpy.context.view_layer.update()
            depsgraph = bpy.context.evaluated_depsgraph_get()
            evaluated = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), depsgraph=depsgraph)
            evaluated.calc_loop_triangles()
            counts.append(dict(subdivisionLevel=level, vertices=len(evaluated.vertices), triangles=len(evaluated.loop_triangles),
                smoothFaces=sum(p.use_smooth for p in evaluated.polygons), attributes=[dict(name=a.name, type=a.data_type, domain=a.domain) for a in evaluated.attributes]))
            bpy.data.meshes.remove(evaluated)
        for m in obj.modifiers:
            if m.type == 'SUBSURF': m.levels = saved[m.name]
        materials = []
        for m in obj.data.materials:
            if not m: continue
            nodes = []
            if m.use_nodes:
                for n in m.node_tree.nodes:
                    row = dict(name=n.name, type=n.type)
                    if n.type == 'TEX_IMAGE' and n.image: row['image'] = n.image.name
                    if n.type == 'BSDF_PRINCIPLED': row['inputs'] = {s.name: (list(s.default_value) if hasattr(s.default_value, '__len__') else s.default_value) for s in n.inputs if hasattr(s, 'default_value')}
                    nodes.append(row)
            materials.append(dict(name=m.name, diffuse=list(m.diffuse_color), nodes=nodes))
        rows.append(dict(name=obj.name, type=obj.type, dataName=obj.data.name, hidden=obj.hide_render, hiddenViewport=obj.hide_get(),
            dimensions=list(obj.dimensions), location=list(obj.location), scale=list(obj.scale), modifiers=modifiers,
            originalVertices=len(obj.data.vertices), originalTriangles=len(obj.data.loop_triangles), evaluated=counts,
            uvLayers=[u.name for u in obj.data.uv_layers], materialFaceCounts={m.name: sum(p.material_index==i for p in obj.data.polygons) for i,m in enumerate(obj.data.materials) if m}, materials=materials))
    images = [dict(name=i.name, path=i.filepath, size=list(i.size), channels=i.channels,
        packedBytes=len(i.packed_file.data) if i.packed_file else 0, source=i.source) for i in bpy.data.images]
    result = dict(state='complete', source=str(SOURCE), sourceSha256=original_hash, sourceUnchanged=hashlib.sha256(SOURCE.read_bytes()).hexdigest()==original_hash,
        blenderVersion=bpy.app.version_string, unitScale=bpy.context.scene.unit_settings.scale_length, objects=rows, images=images)
except Exception:
    result = dict(state='failed', error=traceback.format_exc())
(OUT / 'inspection.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
