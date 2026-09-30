import bpy
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "public" / "models" / "cans"
SOURCE = pathlib.Path(r"D:\3D model\Model Bottle Can\Blender Model 1\330ml Can Model.blend")
bpy.ops.wm.open_mainfile(filepath=str(SOURCE), load_ui=False, use_scripts=False)
results = []
for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    data = obj.data
    data.calc_loop_triangles()
    uv = data.uv_layers.active.data
    degenerate = 0
    for triangle in data.loop_triangles:
        a, b, c = [uv[index].uv for index in triangle.loops]
        if abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)) < 1e-10:
            degenerate += 1
    results.append({"mesh": obj.name, "smoothFaces": sum(1 for p in data.polygons if p.use_smooth), "faceCount": len(data.polygons), "hasCustomNormals": data.has_custom_normals, "sharpEdges": sum(1 for e in data.edges if e.use_edge_sharp), "degenerateUvTriangles": degenerate, "bottomVertices": sorted([list(obj.matrix_world @ v.co) for v in data.vertices], key=lambda v: v[2])[:20]})
(OUTPUT / "normals-inspection.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
