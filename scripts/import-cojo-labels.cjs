'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Checksum-checked local data import. */
require('./register-admin-typescript.cjs');
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {catalogWithDefaults}=require('../lib/catalog/contracts.ts');
const {validateCatalog,preflightCatalog}=require('../lib/catalog/validation.ts');
const {resolveDisplay3D}=require('../lib/catalog/resolve.ts');
const {inspectMedia}=require('../lib/server/media/inspect.ts');

// File numbers verified visually against the supplied printed flavor names.
const artwork=[
  [1,'orange','Orange'],[2,'guava','Guava'],[3,'watermelon','Watermelon'],[4,'peach','Peach'],
  [5,'red-grape','Red Grape'],[6,'lychee','Lychee'],[7,'pineapple','Pineapple'],
  [8,'passion-fruit','Passion Fruit'],[9,'mango','Mango'],[10,'cocktail','Cocktail'],
  [11,'black-currant','Black Currant'],[12,'coconut','Coconut'],[13,'melon','Melon'],[14,'strawberry','Strawberry'],
];
const presets=[['strawberry','#ff3e68'],['watermelon','#ff4430'],['passion-fruit','#ffb52e'],['mango','#ffb52e'],['black-currant','#5144ad'],['guava','#f783ad'],['lychee','#f9a4be']];
const source=path.resolve(process.argv.find(arg=>arg.startsWith('--source='))?.slice(9)||'D:/Vinut-TK/Downloads/resized-images (23)');
const stamp=new Date().toISOString();
const entity=(id,name)=>({id,name,slug:id,lifecycle:'active',revision:1,createdAt:stamp,updatedAt:stamp});
const resources=artwork.map(([number,key,name])=>{
  const bytes=fs.readFileSync(path.join(source,`CojoCojo (${number})-resized.webp`));
  const info=inspectMedia(bytes,'label');
  if(info.mime!=='image/webp')throw new Error(`Expected WebP: ${name}`);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const url=`/assets/labels/cojo/${key}-${sha256.slice(0,12)}.webp`;
  return {key,name,bytes,record:{...entity(`cojo-label-media-${key}`,`Cojo Cojo · ${name} · 320 ml`),role:'label',status:'ready',url,storageKey:'',mime:info.mime,bytes:bytes.length,sha256,width:info.width,height:info.height,imageBounds:null,error:''}};
});

function mergeCojo(raw){
  const data=catalogWithDefaults(structuredClone(raw));
  const changed=[];
  function put(collection,record){
    const prior=data[collection].find(item=>item.id===record.id);
    if(prior){
      const candidate={...prior,...record,createdAt:prior.createdAt,updatedAt:prior.updatedAt,revision:prior.revision};
      if(JSON.stringify(candidate)===JSON.stringify(prior))return prior;
      Object.assign(prior,candidate,{updatedAt:stamp,revision:prior.revision+1});
    }else data[collection].push(record);
    changed.push({collection,id:record.id});return prior||record;
  }
  const model=data.models3d.find(item=>item.id==='registry-pet-320-nata'&&item.lifecycle==='active');
  if(!model||!model.materialSlots.liquid?.length)throw new Error('Missing PET 320 ml model with a liquid slot.');
  const group=data.productGroups.find(item=>item.id==='nata-de-coco');
  if(!group)throw new Error('Missing Nata De Coco product group.');
  for(const resource of resources){
    const {key,name,record}=resource;
    const flavorId=`cojo-${key}`;
    const previous=data.flavors.find(item=>item.id===flavorId);
    if(!previous){
      const base=data.flavors.find(item=>item.id===`juice30-${key}`);
      const color=presets.find(item=>item[0]===key)?.[1]||base?.accentColor||'#86b653';
      put('flavors',{...entity(flavorId,`Cojo Cojo · ${name}`),shortName:name,description:'',accentColor:color,backgroundColor:base?.backgroundColor||'#4f477d',textColor:'#ffffff',icon:base?.icon||'leaf',iconId:base?.iconId||null,thumbnailId:base?.thumbnailId||null,icePoolConfigured:true,position:data.flavors.length});
      if(base)for(const asset of data.flavorAssets.filter(item=>item.flavorId===base.id&&item.lifecycle==='active'&&item.enabled))put('flavorAssets',{...asset,...entity(`cojo-${asset.id}`,`${name} · ${asset.role}`),flavorId});
    }
    put('media',record);
    const id=`cojo-pet320-${key}-label`;
    const label=data.labels.find(item=>item.id===id);
    put('labels',{...(label||entity(id,`Cojo Cojo · ${name} · PET 320 ml`)),drinkTypeId:group.drinkTypeId,flavorId,mediaId:record.id,compatibilities:[{packagingVariantId:model.packagingVariantId,layoutProfile:model.layoutProfile}],mockupVisible:true,mockupPosition:label?.mockupPosition??data.labels.length});
  }
  for(const [key,color]of presets){
    const name=artwork.find(item=>item[1]===key)[2];
    const variantId=`cojo-pet320-${key}`;
    const variant=data.productVariants.find(item=>item.id===variantId);
    put('productVariants',{...(variant||entity(variantId,`Cojo Cojo · ${name} · PET 320 ml`)),groupId:group.id,packagingVariantId:model.packagingVariantId,flavorId:`cojo-${key}`,code:`COJO-PET320-${key.toUpperCase()}`,description:'',enabled:true});
    const id=`${variantId}-3d`;
    put('displays3d',{...(data.displays3d.find(item=>item.id===id)||entity(id,`Cojo Cojo · ${name} · PET 320 ml`)),productVariantId:variantId,modelId:model.id,labelId:`${variantId}-label`,liquidColor:color,enabled:true});
  }
  // Keep the former demo records recoverable, but stop presenting test artwork.
  for(const collection of ['productVariants','displays3d'])for(const prior of data[collection].filter(item=>/^nata-pet320-(mango|watermelon)-demo(?:-3d)?$/.test(item.id)))put(collection,{...prior,enabled:false});
  for(const prior of data.labels.filter(item=>/^nata-pet320-(mango|watermelon)-demo-label$/.test(item.id)))put('labels',{...prior,mockupVisible:false});
  put('productGroups',{...group,name:'Cojo Cojo',buttonLabel:'Cojo Cojo',description:'Fruit juice drinks with nata de coco.',heroFlavorText:'Many flavor choices',visible:true});
  const slot=data.packagingSlots.find(item=>item.id==='slot-nata-pet320');
  if(!slot)throw new Error('Missing PET 320 ml packaging slot.');
  put('packagingSlots',{...slot,defaultVariantId:'cojo-pet320-watermelon',mode:'3d',enabled:true});
  const failures=[...validateCatalog(data),...preflightCatalog(data)].filter(item=>item.severity==='error');
  if(failures.length)throw new Error(JSON.stringify(failures,null,2));
  for(const[key,color]of presets){
    const display=data.displays3d.find(item=>item.id===`cojo-pet320-${key}-3d`);
    const resolved=resolveDisplay3D(data,display);
    if(!resolved||resolved.appearance.slots.liquid.color!==color||resolved.variant.flavorId!==`cojo-${key}`)throw new Error(`Invalid resolved Cojo display: ${key}`);
  }
  return {data,changed};
}

const db=new DatabaseSync('data/admin/catalog.sqlite');
try{
  db.exec('PRAGMA busy_timeout=5000');
  const original=db.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data;
  const {data,changed}=mergeCojo(JSON.parse(original));
  const apply=process.argv.includes('--apply');
  if(apply&&changed.length){
    const backup=path.join('data/admin/cojo-backups',`before-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,original);
    for(const resource of resources){const destination=path.join('public',resource.record.url);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,resource.bytes);}
    db.exec('BEGIN IMMEDIATE');
    if(db.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data!==original)throw new Error('Draft changed while importing. Rerun to merge latest data.');
    db.prepare('UPDATE draft_catalog SET data=? WHERE id=1').run(JSON.stringify(data));
    const audit=db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)');
    for(const item of changed)audit.run(randomUUID(),'cojo-label-import',`save:${item.collection}`,item.id,stamp);
    db.exec('COMMIT');
  }
  console.log(JSON.stringify({apply,labels:resources.length,displays:presets.map(([key,liquidColor])=>({id:`cojo-pet320-${key}-3d`,liquidColor})),changed:changed.length,preflight:'passed',publication:'draft only',releaseCount:db.prepare('SELECT count(*) as count FROM releases').get().count},null,2));
}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}finally{db.close();}
