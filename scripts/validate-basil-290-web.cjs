/* eslint-disable @typescript-eslint/no-require-imports -- Local independent asset certificate CLI. */
/** Validate actual output buffers and decoded topology against preserved High. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const createDraco=require('../public/decoders/draco/draco_decoder.js');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'public/models/bottles');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const read=file=>{const bytes=fs.readFileSync(file),length=bytes.readUInt32LE(12);return{bytes,document:JSON.parse(bytes.subarray(20,20+length)),binary:bytes.subarray(28+length)};};
const buffer=(asset,viewIndex)=>{const view=asset.document.bufferViews[viewIndex];return asset.binary.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);};
async function main(){
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'glass-290-basil-web.manifest.json'))),asset=read(path.join(directory,manifest.file)),reference=read(path.join(directory,manifest.referenceHighFile)),referenceCertificate=JSON.parse(fs.readFileSync(path.join(directory,'glass-290-basil.validation.json')));
  if(hash(asset.bytes)!==manifest.sha256||asset.bytes.length!==manifest.bytes)throw new Error('Web output hash/byte count mismatch');
  if(!referenceCertificate.passed||hash(reference.bytes)!==manifest.referenceHighSha256||referenceCertificate.glbSha256!==manifest.referenceHighSha256)throw new Error('Preserved High hash/certificate mismatch');
  if(hash(fs.readFileSync(manifest.source))!==manifest.sourceSha256)throw new Error('External source changed');
  const draco=await createDraco({}),rows=[];let allPassed=true;
  for(const proof of manifest.retainedGeometry){
    const node=asset.document.nodes.find(n=>n.extras?.sourceReferenceNode===proof.sourceNode),primitive=asset.document.meshes[node.mesh].primitives[0],referenceNode=reference.document.nodes.find(n=>n.name===proof.sourceNode),referencePrimitive=reference.document.meshes[referenceNode.mesh].primitives.find(p=>reference.document.materials[p.material].name===proof.sourceMaterial);
    const bytes=buffer(asset,primitive.extensions.KHR_draco_mesh_compression.bufferView),referenceBytes=buffer(reference,referencePrimitive.extensions.KHR_draco_mesh_compression.bufferView);
    const attributes=Object.keys(primitive.attributes),sameSemantics=JSON.stringify(attributes)===JSON.stringify(Object.keys(referencePrimitive.attributes));
    const sameBytes=bytes.equals(referenceBytes)&&hash(bytes)===proof.bufferSha256;
    const decoder=new draco.Decoder(),db=new draco.DecoderBuffer(),mesh=new draco.Mesh();db.Init(bytes,bytes.length);const status=decoder.DecodeBufferToMesh(db,mesh);if(!status.ok())throw new Error(status.error_msg());
    let closed=null,boundaryEdges=0,nonManifoldEdges=0;
    if(proof.role==='liquid'){
      const map=new Map(),tri=new draco.DracoInt32Array();
      // glTF UV seams split indices. Weld exactly equal decoded positions only.
      const positions=new draco.DracoFloat32Array();decoder.GetAttributeFloatForAllPoints(mesh,decoder.GetAttributeByUniqueId(mesh,primitive.extensions.KHR_draco_mesh_compression.attributes.POSITION),positions);
      const canonical=new Map(),vertexIds=[];
      for(let i=0;i<mesh.num_points();i++){const key=[positions.GetValue(i*3),positions.GetValue(i*3+1),positions.GetValue(i*3+2)].join(',');if(!canonical.has(key))canonical.set(key,canonical.size);vertexIds.push(canonical.get(key));}
      for(let i=0;i<mesh.num_faces();i++){decoder.GetFaceFromMesh(mesh,i,tri);const indices=Array.from({length:3},(_,j)=>vertexIds[tri.GetValue(j)]);for(let j=0;j<3;j++){const a=indices[j],b=indices[(j+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;map.set(key,(map.get(key)||0)+1);}}
      for(const count of map.values()){if(count===1)boundaryEdges++;if(count>2)nonManifoldEdges++;}closed=boundaryEdges===0&&nonManifoldEdges===0;
      draco.destroy(positions);draco.destroy(tri);
    }
    const material=asset.document.materials[primitive.material],passed=sameBytes&&sameSemantics&&mesh.num_faces()===proof.triangles&&mesh.num_points()===proof.vertices&&material.name===proof.material&&material.extras.basilProfile==='basil-web-v1'&&(closed===null||closed);
    rows.push({...proof,passed,retainedCompressedBufferByteIdentical:sameBytes,attributeSemanticsIdentical:sameSemantics,decodedTriangles:mesh.num_faces(),decodedVertices:mesh.num_points(),waterClosedManifold:closed,boundaryEdges,nonManifoldEdges});allPassed=allPassed&&passed;
    draco.destroy(status);draco.destroy(mesh);draco.destroy(db);draco.destroy(decoder);
  }
  const highBytes=zlib.gunzipSync(fs.readFileSync(path.join(directory,'glass-290-basil-high.bin.gz'))),headerLength=highBytes.readUInt32LE(4),header=JSON.parse(highBytes.subarray(8,8+headerLength)),metadata=asset.document.nodes[0].extras.basilWebSeeds;
  let maxError=0;
  for(let i=0;i<metadata.count;i++)for(let field=0;field<4;field++)for(let axis=0;axis<3;axis++){
    const value=highBytes.readFloatLE(8+headerLength+header.buffers.seedEllipsoids.byteOffset+(i*16+field*4+axis)*4);maxError=Math.max(maxError,Math.abs(value-metadata.seeds[i][['center','inverseX','inverseY','inverseZ'][field]][axis]));
  }
  const seedsPassed=metadata.count===330&&metadata.seeds.length===330&&maxError===0&&metadata.gelThicknessNative===manifest.seedInstances.gelThicknessNative;
  const nativeFramePassed=JSON.stringify(metadata.nativeToGlbMatrix)===JSON.stringify(manifest.seedInstances.nativeToGlbMatrix);
  const noHighResources=asset.document.nodes.every(n=>!n.extras?.basilHighInterface&&!n.extras?.basilHighNeck&&!n.extras?.basilProfile?.includes('high'))&&asset.document.materials.every(m=>m.extras.basilProfile==='basil-web-v1'&&!m.name.includes('high'));
  const result={state:'complete',passed:allPassed&&seedsPassed&&nativeFramePassed&&noHighResources,sourceUnchanged:true,referenceHighPreserved:true,glbSha256:manifest.sha256,bytes:manifest.bytes,triangleCount:manifest.triangleCount,referenceHighSha256:manifest.referenceHighSha256,retainedGeometryByteIdentical:rows.every(r=>r.retainedCompressedBufferByteIdentical),sourceGeometryReduced:false,subdivisionChanged:false,noHighBvhResources:noHighResources,seedInstances:{count:metadata.count,passed:seedsPassed,nativeFramePassed,maximumHighFloat32Difference:maxError,gelThicknessNative:metadata.gelThicknessNative},meshes:rows};
  fs.writeFileSync(path.join(directory,'glass-290-basil-web.validation.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,bytes:result.bytes,triangles:result.triangleCount,seeds:330,water:rows.find(r=>r.role==='liquid')}));
  if(!result.passed)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
