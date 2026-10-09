/* eslint-disable @typescript-eslint/no-require-imports -- Read-only-source asset derivation CLI. */
/** Derive the raster web bottle from certified High geometry without remeshing.
 * The High asset remains complete. Only unused reference meshes are omitted.
 * The 330 seed ellipsoids are the exact Float32 fits already used by Unity High.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const createDraco = require('../public/decoders/draco/draco_decoder.js');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'public/models/bottles');
const sourceFile = path.join(directory, 'glass-290-basil.glb');
const sourceManifestFile = path.join(directory, 'glass-290-basil.manifest.json');
const sourceCertificateFile = path.join(directory, 'glass-290-basil.validation.json');
const highDataFile = path.join(directory, 'glass-290-basil-high.bin.gz');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const read = file => {
  const bytes = fs.readFileSync(file), length = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid GLB');
  return {bytes, document:JSON.parse(bytes.subarray(20,20+length)), binary:bytes.subarray(28+length)};
};
async function main() {
  const draco = await createDraco({});
  const source = read(sourceFile), highManifest = JSON.parse(fs.readFileSync(sourceManifestFile)), certificate = JSON.parse(fs.readFileSync(sourceCertificateFile));
  const originalHighSha=hash(source.bytes),originalDataSha=hash(fs.readFileSync(highDataFile));
  if (!certificate.passed || !certificate.sourceUnchanged || certificate.glbSha256 !== originalHighSha || highManifest.sha256 !== originalHighSha) throw new Error('The complete High reference must have a matching passing certificate');
  const highBytes=zlib.gunzipSync(fs.readFileSync(highDataFile)),headerLength=highBytes.readUInt32LE(4),header=JSON.parse(highBytes.subarray(8,8+headerLength)),seedBuffer=header.buffers.seedEllipsoids;
  const seeds=[];
  for(let seed=0;seed<seedBuffer.count;seed++) {
    const offset=8+headerLength+seedBuffer.byteOffset+seed*16*4;
    const row={};for(let field=0;field<4;field++)row[['center','inverseX','inverseY','inverseZ'][field]]=Array.from({length:3},(_,axis)=>highBytes.readFloatLE(offset+(field*4+axis)*4));seeds.push(row);
  }
  if (seeds.length!==330)throw new Error('Expected exactly 330 accepted High seed ellipsoids');
  const seedMetadata={formatVersion:1,count:seeds.length,nativeToGlbMatrix:highManifest.highInterface.nativeToGlbMatrixRowMajor.flat(),gelThicknessNative:highManifest.highInterface.gelThicknessNative,seeds};
  const profile='basil-web-v1', assetId='glass-290-basil-web',layout='glass-290-basil-wrap-v1';
  const names={G290_ClosedGlass:['basil-high-outer','basil-web-outer','body'],G290_HighNeck:['basil-high-neck','basil-web-neck','body'],'Golden Cap':['basil-gold-cap','basil-gold-cap','cap'],Label:['printed-label','printed-label','label'],Water:['basil-liquid','basil-web-liquid','liquid']};
  const document={asset:{version:'2.0',generator:'HyperDrink certified Basil raster derivative',extras:{assetId,basilProfile:profile,referenceHighSha256:originalHighSha}},scene:0,scenes:[{nodes:[0]}],nodes:[],meshes:[],materials:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}],extensionsUsed:[],extensionsRequired:[]};
  document.nodes.push({name:'Basil 290 ml raster web',children:[],extras:{basilProfile:profile,assetId,layoutProfile:layout,basilWebSeeds:seedMetadata}});
  const accessorMap=new Map(),viewMap=new Map(),chunks=[],proof=[];let byteOffset=0;
  function copyView(oldIndex) {
    if(viewMap.has(oldIndex))return viewMap.get(oldIndex);
    const original=source.document.bufferViews[oldIndex],bytes=source.binary.subarray(original.byteOffset||0,(original.byteOffset||0)+original.byteLength),index=document.bufferViews.length;
    document.bufferViews.push({...original,buffer:0,byteOffset,byteLength:bytes.length});viewMap.set(oldIndex,index);
    const padded=Buffer.alloc(Math.ceil(bytes.length/4)*4);bytes.copy(padded);chunks.push(padded);byteOffset+=padded.length;
    return index;
  }
  function copyAccessor(oldIndex) {
    if(accessorMap.has(oldIndex))return accessorMap.get(oldIndex);
    const index=document.accessors.length,accessor=structuredClone(source.document.accessors[oldIndex]);
    if(accessor.bufferView!==undefined)accessor.bufferView=copyView(accessor.bufferView);
    if(accessor.sparse)throw new Error('Unexpected sparse attribute in certified source');
    document.accessors.push(accessor);accessorMap.set(oldIndex,index);return index;
  }
  for(const [sourceNodeName,[sourceMaterialName,materialName,role]] of Object.entries(names)) {
    const sourceNode=source.document.nodes.find(n=>n.name===sourceNodeName),sourceMesh=source.document.meshes[sourceNode.mesh];
    const sourcePrimitive=sourceMesh.primitives.find(p=>source.document.materials[p.material].name===sourceMaterialName);
    if(!sourcePrimitive)throw new Error('Missing certified visible primitive '+sourceMaterialName);
    const material=structuredClone(source.document.materials[sourcePrimitive.material]);material.name=materialName;material.extras={materialSlot:role,basilProfile:profile};
    // The actual web shader configures optics. Imported defaults must not start
    // a redundant native transmission capture for every loaded source material.
    if(material.extensions){delete material.extensions.KHR_materials_transmission;delete material.extensions.KHR_materials_ior;if(!Object.keys(material.extensions).length)delete material.extensions;}
    const materialIndex=document.materials.length;document.materials.push(material);
    const primitive=structuredClone(sourcePrimitive);primitive.material=materialIndex;
    primitive.attributes=Object.fromEntries(Object.entries(primitive.attributes).map(([key,index])=>[key,copyAccessor(index)]));primitive.indices=copyAccessor(primitive.indices);
    if(primitive.extensions?.KHR_draco_mesh_compression)primitive.extensions.KHR_draco_mesh_compression.bufferView=copyView(primitive.extensions.KHR_draco_mesh_compression.bufferView);
    const meshIndex=document.meshes.length;document.meshes.push({name:materialName,primitives:[primitive]});
    const node=structuredClone(sourceNode);node.name=sourceNodeName==='G290_ClosedGlass'?'Basil web glass':sourceNodeName==='G290_HighNeck'?'Basil web neck':sourceNodeName;node.mesh=meshIndex;
    node.extras={materialSlot:role,basilProfile:profile,assetId,layoutProfile:layout,sourceReferenceNode:sourceNodeName};
    if(role==='body'){node.extras.basilWebShell=sourceNodeName==='G290_ClosedGlass';node.extras.basilWebNeck=sourceNodeName==='G290_HighNeck';node.extras.nativeToGlbMatrix=sourceNode.extras.nativeToGlbMatrix;}
    const nodeIndex=document.nodes.length;document.nodes.push(node);document.nodes[0].children.push(nodeIndex);
    const extension=sourcePrimitive.extensions?.KHR_draco_mesh_compression,originalView=extension?source.document.bufferViews[extension.bufferView]:null;
    const copiedBytes=source.binary.subarray(originalView.byteOffset||0,(originalView.byteOffset||0)+originalView.byteLength),decoder=new draco.Decoder(),db=new draco.DecoderBuffer(),decoded=new draco.Mesh();db.Init(copiedBytes,copiedBytes.length);const status=decoder.DecodeBufferToMesh(db,decoded);
    if(!status.ok())throw new Error(status.error_msg());
    // The complete reference's normal-correction encoder welded identical
    // attributes. Keep its exact payload and make the derivative's declarations
    // agree with the actual decoded point count rather than an old accessor.
    for(const accessorIndex of Object.values(primitive.attributes))document.accessors[accessorIndex].count=decoded.num_points();
    proof.push({sourceNode:sourceNodeName,sourceMaterial:sourceMaterialName,material:materialName,role,triangles:source.document.accessors[sourcePrimitive.indices].count/3,vertices:decoded.num_points(),referenceAccessorVertices:source.document.accessors[sourcePrimitive.attributes.POSITION].count,bufferSha256:hash(copiedBytes),geometryCopiedByteForByte:true});
    draco.destroy(status);draco.destroy(decoded);draco.destroy(db);draco.destroy(decoder);
  }
  document.buffers[0].byteLength=byteOffset;
  document.extensionsUsed=document.extensionsRequired=['KHR_draco_mesh_compression'];
  const text=Buffer.from(JSON.stringify(document)),jsonChunk=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(jsonChunk);const binary=Buffer.concat(chunks),glbHeader=Buffer.alloc(20),binHeader=Buffer.alloc(8);
  glbHeader.writeUInt32LE(0x46546c67);glbHeader.writeUInt32LE(2,4);glbHeader.writeUInt32LE(28+jsonChunk.length+binary.length,8);glbHeader.writeUInt32LE(jsonChunk.length,12);glbHeader.writeUInt32LE(0x4e4f534a,16);binHeader.writeUInt32LE(binary.length);binHeader.writeUInt32LE(0x004e4942,4);
  const output=Buffer.concat([glbHeader,jsonChunk,binHeader,binary]),outputFile=path.join(directory,'glass-290-basil-web.glb');fs.writeFileSync(outputFile,output);
  const manifest={version:1,id:assetId,basilProfile:profile,layoutProfile:layout,file:'glass-290-basil-web.glb',bytes:output.length,sha256:hash(output),triangleCount:proof.reduce((n,r)=>n+r.triangles,0),materialSlots:{body:['basil-web-outer','basil-web-neck'],cap:['basil-gold-cap'],label:['printed-label'],liquid:['basil-web-liquid'],inclusions:[]},defaultLiquidColor:highManifest.defaultLiquidColor,dimensionsMeters:highManifest.dimensionsMeters,source:highManifest.source,sourceSha256:highManifest.sourceSha256,sourceUnchanged:true,referenceHighFile:'glass-290-basil.glb',referenceHighSha256:originalHighSha,referenceHighDataSha256:originalDataSha,referenceHighPreserved:true,sourceGeometryReduced:false,authoredSubdivisionChanged:false,omittedHiddenReferenceMeshes:['Base','Body','Neck','Seeds','Basil Seed Gel Shell','basil-high-inner'],retainedGeometry:proof,seedInstances:{count:330,representation:'same accepted High Float32 ellipsoid fits; runtime instanced opaque hydrated envelopes',gelThicknessNative:seedMetadata.gelThicknessNative,nativeToGlbMatrix:seedMetadata.nativeToGlbMatrix,sourceHighFloat32Exact:true,noSeedBvhTextures:true},runtimeOptics:{profile:'basil-web-v1',shaderCreatedByRuntime:true,noHighDataRequest:true,environment:'shared viewer environment'} };
  fs.writeFileSync(path.join(directory,'glass-290-basil-web.manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  if(hash(fs.readFileSync(sourceFile))!==originalHighSha||hash(fs.readFileSync(highDataFile))!==originalDataSha)throw new Error('The complete High reference changed');
  console.log(JSON.stringify({bytes:manifest.bytes,sha256:manifest.sha256,triangles:manifest.triangleCount,seeds:330,meshes:proof.length}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
