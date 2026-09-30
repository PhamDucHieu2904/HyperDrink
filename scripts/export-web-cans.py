"""Reproducible read-only .blend -> web GLB pipeline for the six supplied cans.

Run using Blender's --background --factory-startup --disable-autoexec --python.
The source files are never saved. Everything written lives under public/models/cans.
Only explicit Can, Cap and Label meshes are exported; lights/cameras/scripts are excluded.
"""
from __future__ import annotations

import bpy
import hashlib
import json
import math
from mathutils import Matrix, Vector
import pathlib
import struct
import sys
import traceback

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "public" / "models" / "cans"
SOURCE = pathlib.Path(r"D:\3D model\Model Bottle Can\Blender Model 1")
MODELS = [
    ("can-330", "330ml Can Model.blend", 330, "330 ml"),
    ("can-180", "Can 180ml.blend", 180, "180 ml"),
    ("can-250-short", "Can 250ml short Model.blend", 250, "250 ml · Short"),
    ("can-250", "Can 250ml.blend", 250, "250 ml · Slim"),
    ("can-320", "Can 320ml.blend", 320, "320 ml"),
    ("can-500", "Can 500ml.blend", 500, "500 ml"),
]
SLOTS = {"body": ["aluminum-body"], "tab": ["aluminum-tab"], "label": ["printed-label"]}
ROLE_BY_NAME = {"Can": "body", "Cap": "tab", "Label": "label"}
SCALE_TO_METERS = 0.1  # Source 0.66-unit can diameter corresponds to about 66 mm.
LABEL_OFFSET_METERS = 0.00008  # 0.08 mm clears all wraps, including between vertices.
OUTPUT.mkdir(parents=True, exist_ok=True)
USE_DRACO = "--no-draco" not in sys.argv


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def pbr_material(role):
    """Explicit glTF-compatible PBR values; studio lighting is supplied by viewer."""
    name = SLOTS[role][0]
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    material.node_tree.nodes.clear()
    shader = material.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    output = material.node_tree.nodes.new("ShaderNodeOutputMaterial")
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    if role == "label":
        color = (0.83, 0.83, 0.81, 1.0)
        metallic, roughness, anisotropy = 0.18, 0.28, 0.0
        coat, coat_roughness = 0.35, 0.15
    else:
        color = (0.62, 0.66, 0.69, 1.0)
        metallic, roughness = 1.0, (0.22 if role == "body" else 0.24)
        # The exposed can surfaces are lids/rims/base, where a global directional
        # brush field would be misleading. Use satin isotropic reflections;
        # future anisotropy remains possible with the valid metal UV charts.
        anisotropy = 0.0
        coat, coat_roughness = 0.0, 0.15
    for socket, value in [
        ("Base Color", color), ("Metallic", metallic), ("Roughness", roughness),
        ("Coat Weight", coat), ("Coat Roughness", coat_roughness),
        ("Anisotropic", anisotropy), ("Anisotropic Rotation", 0.25),
    ]:
        shader.inputs[socket].default_value = value
    material.diffuse_color = color
    material.metallic = metallic
    material.roughness = roughness
    # Body and tab are closed outward meshes. The label is an outward wrap
    # covering the opaque body; its hidden reverse faces need no extra pass.
    material.use_backface_culling = True
    material["materialSlot"] = role
    return material


def cylindrical_label_uv(mesh):
    """Standardize seam at rear, front -Y in Blender -> +Z glTF, U=0.5.

    Blender V=1 at top becomes glTF V=0 at top. Wrap seam loops are shifted by
    a period only within crossing polygons so interpolated UVs do not smear.
    """
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    layer = mesh.uv_layers.new(name="UVMap")
    minimum = min(v.co.z for v in mesh.vertices)
    maximum = max(v.co.z for v in mesh.vertices)
    height = max(maximum - minimum, 1e-6)
    for polygon in mesh.polygons:
        values = []
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            u = (math.atan2(vertex.x, -vertex.y) / math.tau + 0.5) % 1.0
            v = (vertex.z - minimum) / height
            values.append((loop_index, u, v))
        crosses_seam = max(x[1] for x in values) - min(x[1] for x in values) > 0.5
        for loop_index, u, v in values:
            if crosses_seam and u < 0.5:
                u += 1.0
            layer.data[loop_index].uv = (u, v)


def metal_uv(mesh):
    """Provide nondegenerate projection charts for all exposed metal faces.

    Authored metal UVs include collapsed base/cap charts. Those charts are not
    used by artwork here and produce invalid anisotropy/normal-map tangents.
    Project each polygon on its dominant normal plane; preserve geometry and
    smooth normals, with UV seams only between projection chart directions.
    """
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])
    layer = mesh.uv_layers.new(name="UVMap")
    minimum = Vector(tuple(min(vertex.co[i] for vertex in mesh.vertices) for i in range(3)))
    maximum = Vector(tuple(max(vertex.co[i] for vertex in mesh.vertices) for i in range(3)))
    extent = maximum - minimum
    axes = {0: (1, 2), 1: (0, 2), 2: (0, 1)}
    for polygon in mesh.polygons:
        normal_axis = max(range(3), key=lambda i: abs(polygon.normal[i]))
        u_axis, v_axis = axes[normal_axis]
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            u = (vertex[u_axis] - minimum[u_axis]) / max(extent[u_axis], 1e-6)
            v = (vertex[v_axis] - minimum[v_axis]) / max(extent[v_axis], 1e-6)
            layer.data[loop_index].uv = (u, v)


def parse_glb(path):
    content = path.read_bytes()
    magic, version, length = struct.unpack_from("<III", content)
    if magic != 0x46546C67 or version != 2 or length != len(content):
        raise ValueError(f"Invalid GLB header: {path}")
    chunk_length, chunk_type = struct.unpack_from("<II", content, 12)
    if chunk_type != 0x4E4F534A:
        raise ValueError(f"Missing GLB JSON chunk: {path}")
    return json.loads(content[20:20 + chunk_length]), content


def export_model(model):
    asset_id, filename, volume, label = model
    source_path = SOURCE / filename
    source_sha = hashlib.sha256(source_path.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(source_path), load_ui=False, use_scripts=False)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name in ROLE_BY_NAME]
    if len(meshes) != 3:
        raise ValueError(f"{filename}: expected exactly Can, Cap and Label source meshes")
    source_triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        source_triangles += len(obj.data.loop_triangles)
        for modifier in obj.modifiers:
            if modifier.type == "SUBSURF":
                modifier.levels = 1
                modifier.render_levels = 1
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    baked = []
    for source_obj in meshes:
        role = ROLE_BY_NAME[source_obj.name]
        mesh = bpy.data.meshes.new_from_object(source_obj.evaluated_get(depsgraph), depsgraph=depsgraph)
        mesh.transform(Matrix.Scale(SCALE_TO_METERS, 4) @ source_obj.matrix_world)
        if role == "label":
            for vertex in mesh.vertices:
                radius = math.hypot(vertex.co.x, vertex.co.y)
                if radius > 0.000001:
                    radial_scale = (radius + LABEL_OFFSET_METERS) / radius
                    vertex.co.x *= radial_scale
                    vertex.co.y *= radial_scale
        obj = bpy.data.objects.new(f"export-{role}", mesh)
        bpy.context.collection.objects.link(obj)
        baked.append((obj, role))
    all_vertices = [vertex.co for obj, _ in baked for vertex in obj.data.vertices]
    minimum = Vector(tuple(min(co[i] for co in all_vertices) for i in range(3)))
    maximum = Vector(tuple(max(co[i] for co in all_vertices) for i in range(3)))
    center = (minimum + maximum) * 0.5
    extent = maximum - minimum
    for obj, role in baked:
        obj.data.transform(Matrix.Translation(-center))
        obj.data.materials.clear()
        obj.data.materials.append(pbr_material(role))
        for polygon in obj.data.polygons:
            polygon.material_index = 0
        if role == "label":
            cylindrical_label_uv(obj.data)
        else:
            metal_uv(obj.data)
        obj["materialSlot"] = role
        obj["assetId"] = asset_id
        obj["sourceMesh"] = next(name for name, value in ROLE_BY_NAME.items() if value == role)
        obj.data.calc_loop_triangles()
    # Remove the original in-memory meshes after baking, freeing role names.
    for source_obj in meshes:
        bpy.data.objects.remove(source_obj, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj, role in baked:
        obj.name = role
        obj.data.name = role
        obj.select_set(True)
    bpy.context.view_layer.objects.active = baked[0][0]
    output = OUTPUT / f"{asset_id}.glb"
    export_options = dict(
        filepath=str(output), export_format="GLB", use_selection=True,
        export_yup=True, export_apply=False, export_normals=True,
        export_texcoords=True, export_tangents=True, export_materials="EXPORT",
        export_animations=False, export_cameras=False, export_lights=False,
        export_extras=True, export_draco_mesh_compression_enable=False,
    )
    bpy.ops.export_scene.gltf(**export_options)
    uncompressed_bytes = output.stat().st_size
    if USE_DRACO:
        export_options.update(
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=6,
            export_draco_position_quantization=14,
            export_draco_normal_quantization=10,
            export_draco_texcoord_quantization=12,
            export_draco_generic_quantization=12,
        )
        bpy.ops.export_scene.gltf(**export_options)
    document, content = parse_glb(output)
    triangle_count = sum(document["accessors"][primitive["indices"]]["count"] // 3 for mesh in document["meshes"] for primitive in mesh["primitives"])
    for obj, _ in baked:
        if obj.data is None:
            raise ValueError(f"Missing baked mesh {asset_id}")
    if triangle_count > 40000:
        raise ValueError(f"{asset_id}: triangle budget exceeded: {triangle_count}")
    if len(content) > 1_500_000:
        raise ValueError(f"{asset_id}: asset byte budget exceeded: {len(content)}")
    return {
        "id": asset_id, "src": f"/models/cans/{asset_id}.glb",
        "sourceFile": filename, "sourceSha256": source_sha,
        "volumeMl": volume, "label": label, "kind": "can",
        "dimensions": {"width": round(extent.x, 6), "height": round(extent.z, 6), "depth": round(extent.y, 6)},
        "triangleCount": triangle_count, "sourceBaseTriangleCount": source_triangles,
        "subdivisionLevel": 1, "bytes": len(content),
        "materialSlots": SLOTS,
        "materials": document.get("materials", []),
        "meshNames": [mesh["name"] for mesh in document["meshes"]],
        "extensionsUsed": document.get("extensionsUsed", []),
        "labelUv": {"frontU": 0.5, "topV": 0, "seam": "rear", "wrapS": "repeat"},
        "labelOffsetMeters": LABEL_OFFSET_METERS,
        "sidedness": "single-sided outward surfaces; label is an open wrap over opaque body",
        "compression": "draco" if USE_DRACO else "none", "uncompressedBytes": uncompressed_bytes,
        "quantizationBits": {"position": 14, "normal": 10, "texcoord": 12, "generic": 12} if USE_DRACO else None,
        "sha256": hashlib.sha256(content).hexdigest(),
        "sourceUnchanged": hashlib.sha256(source_path.read_bytes()).hexdigest() == source_sha,
    }


try:
    manifest = {"schemaVersion": 1, "generator": f"Blender {bpy.app.version_string} / export-web-cans.py", "upAxis": "Y", "frontAxis": "+Z", "unit": "meter", "centered": True, "assets": []}
    for index, model in enumerate(MODELS):
        write_json(OUTPUT / "export-status.json", {"state": "exporting", "index": index, "assetId": model[0]})
        manifest["assets"].append(export_model(model))
        write_json(OUTPUT / "assets.manifest.json", manifest)
    write_json(OUTPUT / "export-status.json", {"state": "complete", "count": len(manifest["assets"])})
    print("WEB_CANS_EXPORTED", len(manifest["assets"]))
except Exception:
    error = traceback.format_exc()
    write_json(OUTPUT / "export-status.json", {"state": "failed", "error": error})
    print(error)
    raise
