"""Measure whether authored Basil islands can be rendered as exact instances."""
import bpy,json,pathlib,traceback,numpy as np
ROOT=pathlib.Path(__file__).resolve().parent.parent
SOURCE=pathlib.Path(r'D:\3D model\Model Bottle Can\Blender Model 1\Glass 290ml model (Basil) - web.blend')
OUT=ROOT/'.tmp/basil-290'
try:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE),load_ui=False,use_scripts=False)
    obj=bpy.context.scene.objects['Seeds'];graph=bpy.context.evaluated_depsgraph_get();mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(graph),depsgraph=graph)
    adjacency=[set() for _ in mesh.vertices]
    for e in mesh.edges:
        a,b=e.vertices;adjacency[a].add(b);adjacency[b].add(a)
    unseen=set(range(len(mesh.vertices)));groups=[]
    while unseen:
        q=[min(unseen)];unseen.remove(q[0]);g=[]
        while q:
            i=q.pop();g.append(i)
            for j in sorted(adjacency[i]):
                if j in unseen:unseen.remove(j);q.append(j)
        groups.append(sorted(g))
    template=np.array([list(mesh.vertices[i].co) for i in groups[0]],dtype=np.float64)
    center=template.mean(axis=0);template-=center
    design=np.column_stack([template,np.ones(len(template))])
    rows=[]
    for group in groups:
        target=np.array([list(mesh.vertices[i].co) for i in group],dtype=np.float64)
        solution=np.linalg.lstsq(design,target,rcond=None)[0]
        prediction=design@solution;errors=np.linalg.norm(prediction-target,axis=1)
        rows.append(dict(vertices=len(group),errorMaxSource=float(errors.max()),errorP95Source=float(np.percentile(errors,95)),matrix=solution.T.tolist(),determinant=float(np.linalg.det(solution[:3,:]))))
    result=dict(state='complete',count=len(groups),templateVertices=len(template),maxErrorSource=max(r['errorMaxSource'] for r in rows),maxErrorMeters=max(r['errorMaxSource'] for r in rows)*.1,rows=rows)
except Exception:result=dict(state='failed',error=traceback.format_exc())
(OUT/'seed-instance-audit.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
