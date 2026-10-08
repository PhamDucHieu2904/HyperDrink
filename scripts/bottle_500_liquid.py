"""Seal only the authored open water surface after the saved subdivision.

Existing positions, polygons and corner normals are retained. A small triangle
fan is added at the neck; no subdivision setting or outside contour is changed.
"""
import bpy
import bmesh
from mathutils import Vector


def seal_water_top(mesh, obj):
    mesh.calc_loop_triangles()
    before_triangles = len(mesh.loop_triangles)
    before_normals = [normal.vector.copy() for normal in mesh.corner_normals]
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    boundary = [edge for edge in bm.edges if edge.is_boundary]
    if not boundary:
        bm.free()
        return mesh, before_normals, None
    if any(not edge.is_manifold and not edge.is_boundary for edge in bm.edges):
        raise ValueError('Water has a non-manifold defect other than its open top')
    adjacency = {}
    for edge in boundary:
        a, b = (v.index for v in edge.verts)
        adjacency.setdefault(a, []).append(b)
        adjacency.setdefault(b, []).append(a)
    if any(len(neighbors) != 2 for neighbors in adjacency.values()):
        raise ValueError('Expected one simple water-top boundary')
    start = min(adjacency)
    ring, previous, current = [], None, start
    while current not in ring:
        ring.append(current)
        following = next(v for v in adjacency[current] if v != previous)
        previous, current = current, following
    if current != start or len(ring) != len(adjacency):
        raise ValueError('Water has multiple holes; refusing a broad fill')
    bm.free()

    world = [obj.matrix_world @ vertex.co for vertex in mesh.vertices]
    ring_world = [world[index] for index in ring]
    upper_z = max(point.z for point in world)
    if upper_z - min(point.z for point in ring_world) > 0.0001:
        raise ValueError('The boundary is not the nearly planar top of Water')
    center = sum((mesh.vertices[index].co for index in ring), Vector()) / len(ring)
    # Outward top normal is +Z in the saved Blender water object space.
    area = sum((mesh.vertices[ring[i]].co - center).cross(
        mesh.vertices[ring[(i + 1) % len(ring)]].co - center).z for i in range(len(ring)))
    if area < 0:
        ring.reverse()
    vertices = [vertex.co.copy() for vertex in mesh.vertices] + [center]
    center_index = len(mesh.vertices)
    original_faces = [tuple(face.vertices) for face in mesh.polygons]
    caps = [(ring[i], ring[(i + 1) % len(ring)], center_index) for i in range(len(ring))]
    sealed = bpy.data.meshes.new(mesh.name + '-closed-top')
    sealed.from_pydata(vertices, [], original_faces + caps)
    for material in mesh.materials:
        sealed.materials.append(material)
    for original, retained in zip(mesh.polygons, sealed.polygons):
        retained.use_smooth = original.use_smooth
        retained.material_index = original.material_index
    sealed.update()
    cap_normals = [sealed.polygons[index].normal.copy()
        for index in range(len(original_faces), len(sealed.polygons)) for _ in range(3)]
    normals = before_normals + cap_normals
    sealed.normals_split_custom_set(normals)
    check = bmesh.new(); check.from_mesh(sealed)
    remaining_boundary = sum(edge.is_boundary for edge in check.edges)
    non_manifold = sum(not edge.is_manifold for edge in check.edges)
    consistent = all(edge.is_contiguous for edge in check.edges)
    check.free()
    if remaining_boundary or non_manifold or not consistent:
        raise ValueError('Water closure did not produce a consistently wound sealed volume')
    sealed.calc_loop_triangles()
    repair = dict(kind='seal-water-top', beforeBoundaryEdges=len(boundary), afterBoundaryEdges=0,
        addedVertices=1, addedTriangles=len(caps), originalTriangles=before_triangles,
        repairedTriangles=len(sealed.loop_triangles), originalPositionsUnchanged=True,
        originalFacesUnchanged=True, originalCornerNormalsUnchanged=True,
        waterTopHeightMeters=sum(point.z for point in ring_world) / len(ring_world) * 0.1)
    return sealed, normals, repair
