"""Inspect original Basil authoring geometry without saving the source."""
import bpy, hashlib, json, pathlib, traceback

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / '.tmp' / 'basil-290'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = pathlib.Path(r'D:\3D model\Model Bottle Can\Blender Model 1\Glass 290ml model (Basil) - web.blend')
try:
    digest = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE), load_ui=False, use_scripts=False)
    graph = bpy.context.evaluated_depsgraph_get()
    rows=[]
    for obj in bpy.context.scene.objects:
        row=dict(name=obj.name,type=obj.type,hidden=obj.hide_render,location=list(obj.location),scale=list(obj.scale),matrix=[list(r) for r in obj.matrix_world],dimensions=list(obj.dimensions))
        if obj.type=='MESH':
            obj.data.calc_loop_triangles()
            mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(graph),depsgraph=graph)
            mesh.calc_loop_triangles()
            row.update(vertices=len(obj.data.vertices),triangles=len(obj.data.loop_triangles),evaluatedVertices=len(mesh.vertices),evaluatedTriangles=len(mesh.loop_triangles),uvLayers=[l.name for l in mesh.uv_layers],materials=[m.name if m else None for m in obj.data.materials],modifiers=[dict(name=m.name,type=m.type,levels=getattr(m,'levels',None),renderLevels=getattr(m,'render_levels',None),viewport=m.show_viewport,render=m.show_render) for m in obj.modifiers],bounds=[[min(v.co[i] for v in mesh.vertices),max(v.co[i] for v in mesh.vertices)] for i in range(3)])
            bpy.data.meshes.remove(mesh)
        rows.append(row)
    result=dict(state='complete',source=str(SOURCE),sourceSha256=digest,sourceUnchanged=hashlib.sha256(SOURCE.read_bytes()).hexdigest()==digest,unitScale=bpy.context.scene.unit_settings.scale_length,unitSystem=bpy.context.scene.unit_settings.system,objects=rows,images=[dict(name=i.name,path=i.filepath,size=list(i.size),packed=bool(i.packed_file)) for i in bpy.data.images])
except Exception:
    result=dict(state='failed',error=traceback.format_exc())
(OUT/'inspection.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
