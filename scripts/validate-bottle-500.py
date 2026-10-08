"""Independently decode the exported Draco GLB and compare the untouched source."""
import bpy
import hashlib
import json
import math
import pathlib
import traceback
import sys
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from bottle_500_liquid import seal_water_top

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIRECTORY = ROOT / 'public' / 'models' / 'bottles'
OUT = ROOT / '.tmp' / 'bottle-500' / 'decoded-validation.json'
manifest = json.loads((DIRECTORY / 'pet-500-short-label.manifest.json').read_text(encoding='utf8'))
gpu = json.loads((ROOT / '.tmp/bottle-500/gpu-decoded.json').read_text(encoding='utf8'))
ROLES = {'Body bottle': 'body', 'Cap': 'cap', 'Label': 'label', 'Water': 'liquid', 'Aloe Pulp': 'inclusions'}

def coordinates(obj):
    return [obj.matrix_world @ v.co for v in obj.data.vertices]

def degenerate_count(mesh, coords):
    mesh.calc_loop_triangles()
    return sum((coords[t.vertices[1]]-coords[t.vertices[0]]).cross(
        coords[t.vertices[2]]-coords[t.vertices[0]]).length < 1e-15 for t in mesh.loop_triangles)

def kd_tree(points):
    kd = KDTree(len(points))
    for index, point in enumerate(points):
        kd.insert(point, index)
    kd.balance()
    return kd

try:
    source = pathlib.Path(manifest['source'])
    source_hash_before = hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    graph = bpy.context.evaluated_depsgraph_get()
    source_data = {}
    center = Vector(manifest['sourceBounds']['center']) * manifest['exportScale']
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or obj.name not in ROLES:
            continue
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(graph), depsgraph=graph)
        if ROLES[obj.name] == 'liquid' and manifest.get('waterTopRepair'):
            mesh, _, repair = seal_water_top(mesh, obj)
            if repair != manifest['waterTopRepair']:
                raise ValueError('Water-top repair differs from the certified export')
        mesh.calc_loop_triangles()
        points = [obj.matrix_world @ v.co * manifest['exportScale'] - center for v in mesh.vertices]
        normals, uv = [[] for v in mesh.vertices], [[] for v in mesh.vertices]
        matrix = obj.matrix_world.to_3x3().inverted().transposed()
        layer = mesh.uv_layers.get('UVMap')
        for loop in mesh.loops:
            normals[loop.vertex_index].append((matrix @ mesh.corner_normals[loop.index].vector).normalized())
            if layer:
                uv[loop.vertex_index].append(layer.data[loop.index].uv.copy())
        source_data[ROLES[obj.name]] = dict(points=points, normals=normals, uv=uv,
            triangles=len(mesh.loop_triangles), degenerateTriangles=degenerate_count(mesh, points))
        bpy.data.meshes.remove(mesh)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    glb = DIRECTORY / manifest['file']
    bpy.ops.import_scene.gltf(filepath=str(glb), merge_vertices=False)
    rows = []
    gpu_by_role = {row['role']: row for row in gpu['meshes']}
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        role = obj.get('materialSlot')
        expected = source_data[role]
        points = coordinates(obj)
        kd = kd_tree(expected['points'])
        decoded_kd = kd_tree(points)
        errors = [kd.find(p)[2] for p in points]
        reverse_errors = [decoded_kd.find(p)[2] for p in expected['points']]
        angles, uv_errors = [], []
        matrix = obj.matrix_world.to_3x3().inverted().transposed()
        layer = obj.data.uv_layers.active
        for loop in obj.data.loops:
            point = points[loop.vertex_index]
            normal = (matrix @ obj.data.corner_normals[loop.index].vector).normalized()
            nearby = kd.find_range(point, 15e-6)
            if not nearby:
                nearby = [kd.find(point)]
            best = max(normal.dot(n) for _, index, _ in nearby for n in expected['normals'][index])
            angles.append(math.degrees(math.acos(max(-1, min(1, best)))))
            if role in {'body', 'label'}:
                if not layer:
                    raise ValueError(f'{role}: missing UVMap')
                value = layer.data[loop.index].uv
                uv_errors.append(min((value-u).length for _, index, _ in nearby for u in expected['uv'][index]))
        obj.data.calc_loop_triangles()
        # Blender's normal importer can reconstruct a different custom normal
        # at a few extremely small base corners. Check the actual decoded GPU
        # attribute with the project decoder, retaining the importer as a
        # separate position/topology/UV round-trip check.
        raw = gpu_by_role[role]
        world_matrix = Matrix([raw['blenderWorldMatrix'][i::4] for i in range(4)])
        normal_matrix = world_matrix.to_3x3().inverted().transposed()
        gpu_angles, gpu_errors = [], []
        for primitive in raw['primitives']:
            positions, normals = primitive['POSITION'], primitive['NORMAL']
            for i in range(0, len(positions), 3):
                point = world_matrix @ Vector(positions[i:i+3])
                normal = (normal_matrix @ Vector(normals[i:i+3])).normalized()
                nearest = kd.find(point)
                gpu_errors.append(nearest[2])
                nearby = kd.find_range(point, 15e-6) or [nearest]
                best = max(normal.dot(n) for _, index, _ in nearby for n in expected['normals'][index])
                gpu_angles.append(math.degrees(math.acos(max(-1, min(1, best)))))
        row = dict(role=role, sourceTriangles=expected['triangles'], decodedTriangles=len(obj.data.loop_triangles),
            maximumPositionErrorMeters=max(errors), maximumReversePositionErrorMeters=max(reverse_errors),
            maximumGpuNormalAngleDegrees=max(gpu_angles), meanGpuNormalAngleDegrees=sum(gpu_angles)/len(gpu_angles),
            maximumGpuPositionErrorMeters=max(gpu_errors),
            blenderImporterMaximumCornerNormalAngleDegrees=max(angles),
            sourceDegenerateTriangles=expected['degenerateTriangles'], decodedDegenerateTriangles=degenerate_count(obj.data, points),
            maximumUvError=max(uv_errors) if uv_errors else None, preservedUv=role in {'body', 'label'})
        row['passed'] = all([row['sourceTriangles'] == row['decodedTriangles'], max(errors+reverse_errors) < 15e-6,
            row['maximumGpuNormalAngleDegrees'] < 1, max(gpu_errors) < 15e-6,
            row['decodedDegenerateTriangles'] <= row['sourceDegenerateTriangles'],
            not uv_errors or max(uv_errors) < 0.0005])
        rows.append(row)
    report = dict(passed=all(r['passed'] for r in rows) and {r['role'] for r in rows} == set(ROLES.values()),
        validatedBy=f'Blender {bpy.app.version_string} glTF importer + project Draco decoder for GPU normals',
        sourceUnchanged=source_hash_before == manifest['sourceSha256'] == hashlib.sha256(source.read_bytes()).hexdigest(),
        sourceSha256=source_hash_before, assetSha256=hashlib.sha256(glb.read_bytes()).hexdigest(),
        assetHashMatches=hashlib.sha256(glb.read_bytes()).hexdigest() == manifest['sha256'],
        meshes=rows, waterTopRepair=manifest.get('waterTopRepair'),
        method='Bidirectional vertex check against retained source and explicit water-top closure, GPU normal comparison, triangle and body/label UV checks')
    report['passed'] = report['passed'] and report['sourceUnchanged'] and report['assetHashMatches']
    OUT.write_text(json.dumps(report, indent=2)+'\n', encoding='utf8')
    if not report['passed']:
        raise ValueError('Decoded GLB fidelity gate failed; see decoded-validation.json')
    (DIRECTORY / 'pet-500-short-label.validation.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf8')
    print('BOTTLE_500_VALIDATION_PASSED')
except Exception:
    if not OUT.exists():
        OUT.write_text(json.dumps(dict(passed=False, error=traceback.format_exc()), indent=2)+'\n', encoding='utf8')
    raise
