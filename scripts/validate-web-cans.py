"""Round-trip all exported GLBs through Blender's Draco importer and compare source geometry."""
import bpy
import bmesh
import hashlib
import json
import math
from mathutils import Vector
from mathutils.kdtree import KDTree
import pathlib
import traceback

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / "public" / "models" / "cans"
SOURCE = pathlib.Path(r"D:\3D model\Model Bottle Can\Blender Model 1")
manifest = json.loads((DIRECTORY / "assets.manifest.json").read_text(encoding="utf-8"))
ROLE = {"Can": "body", "Cap": "tab", "Label": "label"}
results = []
try:
    for asset in manifest["assets"]:
        source_path = SOURCE / asset["sourceFile"]
        bpy.ops.wm.open_mainfile(filepath=str(source_path), load_ui=False, use_scripts=False)
        source_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name in ROLE]
        for obj in source_objects:
            for modifier in obj.modifiers:
                if modifier.type == "SUBSURF":
                    modifier.levels = 1
                    modifier.render_levels = 1
        bpy.context.view_layer.update()
        graph = bpy.context.evaluated_depsgraph_get()
        source_vertices = {}
        source_topology = {}
        for obj in source_objects:
            role = ROLE[obj.name]
            mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(graph), depsgraph=graph)
            points = [obj.matrix_world @ v.co * 0.1 for v in mesh.vertices]
            if role == "label":
                for point in points:
                    radius = math.hypot(point.x, point.y)
                    if radius > 0.000001:
                        radial_scale = (radius + asset.get("labelOffsetMeters", 0.0)) / radius
                        point.x *= radial_scale
                        point.y *= radial_scale
            source_vertices[role] = points
            bm = bmesh.new()
            bm.from_mesh(mesh)
            source_topology[role] = {
                "boundaryEdges": sum(1 for edge in bm.edges if edge.is_boundary),
                "nonManifoldEdges": sum(1 for edge in bm.edges if not edge.is_manifold),
                "signedVolumeBeforeScale": bm.calc_volume(signed=True),
            }
            if role == "label":
                inward_faces = 0
                for face in bm.faces:
                    center_xy = face.calc_center_median()
                    center_xy.z = 0.0
                    if face.normal.dot(center_xy) < -0.000001:
                        inward_faces += 1
                source_topology[role]["inwardFacingRadialFaces"] = inward_faces
            bm.free()
        all_points = [point for points in source_vertices.values() for point in points]
        minimum = Vector(tuple(min(co[i] for co in all_points) for i in range(3)))
        maximum = Vector(tuple(max(co[i] for co in all_points) for i in range(3)))
        center = (minimum + maximum) * 0.5
        source_trees = {}
        for role, points in source_vertices.items():
            tree = KDTree(len(points))
            for index, point in enumerate(points):
                tree.insert(point - center, index)
            tree.balance()
            source_trees[role] = tree
        bpy.ops.wm.read_factory_settings(use_empty=True)
        path = DIRECTORY / f"{asset['id']}.glb"
        bpy.ops.import_scene.gltf(filepath=str(path), merge_vertices=True)
        row = {"id": asset["id"], "sha256Matches": hashlib.sha256(path.read_bytes()).hexdigest() == asset["sha256"], "sourceUnchanged": hashlib.sha256(source_path.read_bytes()).hexdigest() == asset["sourceSha256"], "meshes": []}
        triangles = 0
        max_error = 0.0
        imported_roles = set()
        for obj in bpy.context.scene.objects:
            if obj.type != "MESH":
                continue
            role = obj.get("materialSlot", obj.name)
            imported_roles.add(role)
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
            uv = obj.data.uv_layers.active.data
            degenerate_uv = 0
            for triangle in obj.data.loop_triangles:
                a, b, c = [uv[index].uv for index in triangle.loops]
                if abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)) < 1e-12:
                    degenerate_uv += 1
            errors = []
            for vertex in obj.data.vertices:
                point = obj.matrix_world @ vertex.co
                _, _, distance = source_trees[role].find(point)
                errors.append(distance)
            worst = max(errors)
            max_error = max(max_error, worst)
            row["meshes"].append({"role": role, "name": obj.name, "triangles": len(obj.data.loop_triangles), "maximumPositionErrorMeters": worst, "degenerateUvTriangles": degenerate_uv, "materials": [m.name for m in obj.data.materials], "singleSided": all(m.use_backface_culling for m in obj.data.materials), "sourceTopology": source_topology[role]})
        row.update({"triangles": triangles, "triangleCountMatches": triangles == asset["triangleCount"], "maximumPositionErrorMeters": max_error, "allMaterialRolesPresent": imported_roles == {"body", "label", "tab"}})
        row["passed"] = all([row["sha256Matches"], row["sourceUnchanged"], row["triangleCountMatches"], row["allMaterialRolesPresent"], max_error < 0.000025])
        row["passed"] = row["passed"] and source_topology["label"]["inwardFacingRadialFaces"] == 0
        row["passed"] = row["passed"] and all(mesh["degenerateUvTriangles"] == 0 for mesh in row["meshes"])
        if not row["passed"]:
            raise ValueError(f"Round-trip verification failed: {row}")
        results.append(row)
    report = {"passed": True, "validatedBy": f"Blender {bpy.app.version_string} glTF+Draco importer", "assets": results}
    (DIRECTORY / "validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("WEB_CAN_VALIDATION_PASSED", len(results))
except Exception:
    report = {"passed": False, "error": traceback.format_exc(), "assets": results}
    (DIRECTORY / "validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    raise
