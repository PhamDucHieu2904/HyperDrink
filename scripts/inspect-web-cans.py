"""Read-only Blender inspection of the six can sources; run with --disable-autoexec."""
import bpy
import json
import pathlib

SOURCE = pathlib.Path(r"D:\3D model\Model Bottle Can\Blender Model 1")
FILES = ["330ml Can Model.blend", "Can 180ml.blend", "Can 250ml short Model.blend", "Can 250ml.blend", "Can 320ml.blend", "Can 500ml.blend"]
results = []
for filename in FILES:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE / filename), load_ui=False, use_scripts=False)
    result = {"filename": filename, "units": bpy.context.scene.unit_settings.system, "unitScale": bpy.context.scene.unit_settings.scale_length, "objects": []}
    for obj in bpy.context.scene.objects:
        row = {"name": obj.name, "type": obj.type, "dimensions": list(obj.dimensions), "location": list(obj.location), "rotation": list(obj.rotation_euler), "scale": list(obj.scale), "hidden": obj.hide_render}
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            row.update({"vertices": len(obj.data.vertices), "triangles": len(obj.data.loop_triangles), "bounds": [list(x) for x in obj.bound_box], "uvLayers": [x.name for x in obj.data.uv_layers], "modifiers": [{"name": m.name, "type": m.type, "levels": getattr(m, "levels", None), "renderLevels": getattr(m, "render_levels", None)} for m in obj.modifiers], "materials": []})
            for mat in obj.data.materials:
                if not mat:
                    continue
                mr = {"name": mat.name, "diffuse": list(mat.diffuse_color), "metallic": mat.metallic, "roughness": mat.roughness, "nodes": []}
                if mat.use_nodes:
                    for node in mat.node_tree.nodes:
                        nr = {"name": node.name, "type": node.type}
                        if node.type == "BSDF_PRINCIPLED":
                            nr["inputs"] = {key: list(node.inputs[key].default_value) if key == "Base Color" else node.inputs[key].default_value for key in ["Base Color", "Metallic", "Roughness", "IOR", "Coat Weight", "Coat Roughness"]}
                        if node.type == "TEX_IMAGE":
                            nr["image"] = node.image.filepath if node.image else None
                        mr["nodes"].append(nr)
                row["materials"].append(mr)
        result["objects"].append(row)
    results.append(result)
output = pathlib.Path(__file__).resolve().parent.parent / "public" / "models" / "cans" / "source-inspection.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(results, indent=2), encoding="utf-8")
print("INSPECTION_REPORT", output)
