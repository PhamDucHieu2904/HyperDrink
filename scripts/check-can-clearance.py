"""Measure exported label vertices against the actual opaque body with radial ray casts."""
import bpy
import json
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / "public" / "models" / "cans"
manifest = json.loads((DIRECTORY / "assets.manifest.json").read_text(encoding="utf-8"))
results = []
for asset in manifest["assets"]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(DIRECTORY / f"{asset['id']}.glb"), merge_vertices=True)
    body = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.get("materialSlot") == "body")
    label = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.get("materialSlot") == "label")
    vertices = [body.matrix_world @ v.co for v in body.data.vertices]
    polygons = [list(p.vertices) for p in body.data.polygons]
    tree = BVHTree.FromPolygons(vertices, polygons)
    clearances = []
    samples = [label.matrix_world @ vertex.co for vertex in label.data.vertices]
    for polygon in label.data.polygons:
        center = sum((label.data.vertices[index].co for index in polygon.vertices), Vector()) / len(polygon.vertices)
        samples.append(label.matrix_world @ center)
    for point in samples:
        direction = Vector((point.x, point.y, 0)).normalized()
        origin = Vector((0.0, 0.0, point.z))
        farthest_radius = None
        for _ in range(8):
            position, _, _, distance = tree.ray_cast(origin, direction, 0.2)
            if position is None:
                break
            farthest_radius = Vector((position.x, position.y, 0)).length
            origin = position + direction * 0.0000001
        if farthest_radius is not None:
            clearances.append(Vector((point.x, point.y, 0)).length - farthest_radius)
    row = {"id": asset["id"], "minimumSampledClearanceMeters": min(clearances), "negativeClearances": sum(1 for x in clearances if x < 0), "nearCoplanarClearances": sum(1 for x in clearances if x < 0.000025), "samples": len(clearances), "sampleTypes": ["vertices", "triangle-centroids"]}
    results.append(row)
(DIRECTORY / "clearance.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
