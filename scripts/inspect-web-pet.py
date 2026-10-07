"""Read-only source inspection; never saves the supplied Blender file."""
import bpy, hashlib, json, pathlib, traceback
from mathutils import Vector
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / '.tmp' / 'pet-320'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = pathlib.Path(r'D:\3D model\Model Bottle Can\Blender Model 1\Pet 320ml Model - for web.blend')
try:
    sha = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE), load_ui=False, use_scripts=False)
    rows = []
    for obj in bpy.context.scene.objects:
        row = dict(name=obj.name, type=obj.type, dimensions=list(obj.dimensions), location=list(obj.location), scale=list(obj.scale), hidden=obj.hide_render)
        if obj.type == 'MESH':
            row['modifiers'] = [dict(name=m.name, type=m.type, levels=getattr(m,'levels',None), renderLevels=getattr(m,'render_levels',None), count=getattr(m,'count',None)) for m in obj.modifiers]
            obj.data.calc_loop_triangles()
            row['triangles'] = len(obj.data.loop_triangles)
            row['uvLayers'] = [uv.name for uv in obj.data.uv_layers]
            row['materials'] = [dict(name=m.name, diffuse=list(m.diffuse_color)) for m in obj.data.materials if m]
            row['bounds'] = [list(obj.matrix_world @ Vector(co)) for co in obj.bound_box]
            counts = []
            for level in [0,1,2]:
                for mod in obj.modifiers:
                    if mod.type == 'SUBSURF': mod.levels=level
                bpy.context.view_layer.update()
                dg=bpy.context.evaluated_depsgraph_get()
                mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(dg), depsgraph=dg)
                mesh.calc_loop_triangles()
                counts.append(dict(level=level, vertices=len(mesh.vertices), triangles=len(mesh.loop_triangles)))
                bpy.data.meshes.remove(mesh)
            row['evaluated']=counts
        rows.append(row)
    result=dict(state='complete',sourceSha256=sha,unitScale=bpy.context.scene.unit_settings.scale_length,objects=rows)
except Exception:
    result=dict(state='failed',error=traceback.format_exc())
(OUT/'inspection.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
