"""Read-only optics/print audit of the authored 500 ml bottle."""
import bpy, json, pathlib
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / '.tmp/aloe-500'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = r'D:\3D model\Model Bottle Can\Blender Model 1\500 ml Bottle Model Short Label_web.blend'
bpy.ops.wm.open_mainfile(filepath=SOURCE, load_ui=False, use_scripts=False)
bpy.context.view_layer.update()
graph = bpy.context.evaluated_depsgraph_get()
objects = {o.name: o for o in bpy.context.scene.objects if o.type == 'MESH'}
meshes = {name: bpy.data.meshes.new_from_object(o.evaluated_get(graph), depsgraph=graph) for name, o in objects.items()}
water = meshes['Water']
water_points = [objects['Water'].matrix_world @ v.co for v in water.vertices]
tree = BVHTree.FromPolygons(water_points, [list(p.vertices) for p in water.polygons])
def inside(p):
    hits = 0
    direction = Vector((0.731, 0.423, 0.536)).normalized()
    cursor = p.copy()
    for _ in range(50):
        location, normal, index, distance = tree.ray_cast(cursor, direction)
        if location is None: break
        hits += 1
        cursor = location + direction * 0.000001
    return hits % 2 == 1
pulp = meshes['Aloe Pulp']
adjacency = [set() for v in pulp.vertices]
for edge in pulp.edges:
    a, b = edge.vertices
    adjacency[a].add(b); adjacency[b].add(a)
todo = set(range(len(pulp.vertices)))
pieces = []
while todo:
    queue = [todo.pop()]; group = []
    while queue:
        i = queue.pop(); group.append(i)
        for j in adjacency[i]:
            if j in todo: todo.remove(j); queue.append(j)
    pts = [objects['Aloe Pulp'].matrix_world @ pulp.vertices[i].co for i in group]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    c = sum(pts, Vector()) / len(pts)
    pieces.append(dict(vertices=len(group), center=list(c), sizeMm=[(b-a)*100 for a,b in zip(lo,hi)],
        outsideVertices=sum(not inside(p) for p in pts), centerInside=inside(c)))
label = meshes['Label']; label_uv = label.uv_layers.get('UVMap')
label_rows = []
for poly in label.polygons:
    for li in poly.loop_indices:
        co = objects['Label'].matrix_world @ label.vertices[label.loops[li].vertex_index].co
        label_rows.append(dict(co=list(co), uv=list(label_uv.data[li].uv)))
result = dict(pieceCount=len(pieces), pieces=pieces, outsidePulpVertices=sum(p['outsideVertices'] for p in pieces),
    pulpVertices=len(pulp.vertices), label=label_rows,
    waterBounds=dict(minimum=[min(p[i] for p in water_points) for i in range(3)], maximum=[max(p[i] for p in water_points) for i in range(3)]))
(OUT / 'authored-audit.json').write_text(json.dumps(result), encoding='utf8')
print('ALOE_AUDIT', result['pieceCount'], result['outsidePulpVertices'])
