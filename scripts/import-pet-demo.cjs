'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Local, checksum-checked asset import. */
require('./register-admin-typescript.cjs');
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {catalogWithDefaults}=require('../lib/catalog/contracts.ts');
const {validateCatalog,preflightCatalog}=require('../lib/catalog/validation.ts');
const {prepareCatalogRelease}=require('../lib/catalog/service.ts');
const {inspectMedia}=require('../lib/server/media/inspect.ts');
const {checkModelLabelGeometry}=require('../lib/server/media/model-slots.ts');
const {exportPublishedCatalog}=require('./export-public-catalog.cjs');
const model=JSON.parse(fs.readFileSync('public/models/bottles/assets.manifest.json','utf8')).assets[0];
const stamp=new Date().toISOString();
const hash=value=>createHash('sha256').update(value).digest('hex');
const entity=(id,name)=>({id,name,slug:id,lifecycle:'active',revision:1,createdAt:stamp,updatedAt:stamp});
const media=(id,name,role,url)=>{
  const bytes=fs.readFileSync(path.join('public',url));
  const info=inspectMedia(bytes,role);
  return {...entity(id,name),role,status:'ready',url,storageKey:'',mime:info.mime,bytes:bytes.length,sha256:hash(bytes),width:info.width,height:info.height,imageBounds:null,error:''};
};
const resources=[media('model-pet-320-nata','PET 320 ml · Nata De Coco','model',model.src),
  media('poster-pet-320-nata','PET 320 ml · preview','poster','/models/bottles/pet-320-nata-poster.webp'),
  media('label-pet-320-nata-demo','Mango PET 320 ml · demo label','label','/assets/labels/nata-demo/mango-pet320.webp'),
  media('label-pet-320-nata-watermelon-demo','Watermelon PET 320 ml · unprinted comparison sleeve','label','/assets/labels/nata-demo/watermelon-unprinted-pet320.webp')];
if(resources[0].sha256!==model.sha256) throw new Error('GLB does not match its validated manifest');

function mergePet(raw) {
  const data=catalogWithDefaults(structuredClone(raw));
  function add(collection,record) {
    const prior=data[collection].find(x=>x.id===record.id);
    if(prior) {
      // Idempotent reruns update derived media checksum only; preserve artist/admin edits.
      if(collection==='media' && prior.sha256!==record.sha256) Object.assign(prior,record,{createdAt:prior.createdAt,revision:prior.revision+1});
      // A derived Ring material is part of this owned GLB. Refresh its material
      // declaration without replacing the artist's orientation or other setup.
      if(collection==='models3d' && prior.id==='registry-pet-320-nata' && prior.mediaId===record.mediaId) {
        const mergedSlots={...prior.materialSlots};
        for(const [slot,names] of Object.entries(record.materialSlots)) mergedSlots[slot]=[...new Set([...(mergedSlots[slot]??[]),...names])];
        if(JSON.stringify(mergedSlots)!==JSON.stringify(prior.materialSlots)) Object.assign(prior,{materialSlots:mergedSlots,updatedAt:stamp,revision:prior.revision+1});
      }
      return prior;
    }
    data[collection].push(record);return record;
  }
  const category=data.packagingCategories.find(x=>x.viewerKind==='pet'&&x.lifecycle==='active') || add('packagingCategories',{...entity('pet-bottle','PET bottle'),viewerKind:'pet',position:data.packagingCategories.length});
  add('drinkTypes',{...entity('nata-de-coco','Nata De Coco'),description:'',position:data.drinkTypes.length});
  add('packagingVariants',{...entity('pet-320','320 ml PET'),categoryId:category.id,volumeMl:320,shape:'ribbed',position:data.packagingVariants.length});
  const mango=data.flavors.find(x=>x.id==='juice30-mango');
  add('flavors',{...entity('nata-mango-demo','Mango · Nata De Coco'),shortName:'Mango',description:'Mango drink with coconut jelly. Demo appearance for the PET bottle.',accentColor:'#ffc440',backgroundColor:'#aa6c0b',textColor:'#ffffff',icon:'mango',iconId:mango?.iconId??null,thumbnailId:mango?.thumbnailId??null,position:data.flavors.length,icePoolConfigured:true});
  for(const item of data.flavorAssets.filter(x=>x.flavorId===mango?.id&&x.lifecycle==='active'&&x.enabled)) add('flavorAssets',{...item,...entity(`nata-demo-${item.id}`,item.name),flavorId:'nata-mango-demo'});
  const watermelon=data.flavors.find(x=>x.id==='juice30-watermelon');
  add('flavors',{...entity('nata-watermelon-demo','Watermelon · Nata De Coco'),shortName:'Watermelon',description:'Watermelon Nata De Coco optical demo, compared with the supplied Unity render.',accentColor:'#ff4430',backgroundColor:'#92251e',textColor:'#ffffff',icon:'watermelon',iconId:watermelon?.iconId??null,thumbnailId:watermelon?.thumbnailId??null,position:data.flavors.length,icePoolConfigured:true});
  for(const item of data.flavorAssets.filter(x=>x.flavorId===watermelon?.id&&x.lifecycle==='active'&&x.enabled)) add('flavorAssets',{...item,...entity(`nata-watermelon-demo-${item.id}`,item.name),flavorId:'nata-watermelon-demo'});
  resources.forEach(x=>add('media',x));
  add('models3d',{...entity('registry-pet-320-nata',model.name),packagingVariantId:'pet-320',mediaId:'model-pet-320-nata',posterId:'poster-pet-320-nata',layoutProfile:'pet-wrap-v1',materialSlots:model.materialSlots,orientation:[0,0,0],mockupVisible:true,mockupPosition:data.models3d.length,mockupFrontYaw:0});
  add('labels',{...entity('nata-pet320-mango-demo-label','Mango · PET 320 ml · Demo'),drinkTypeId:'nata-de-coco',flavorId:'nata-mango-demo',mediaId:'label-pet-320-nata-demo',compatibilities:[{packagingVariantId:'pet-320',layoutProfile:'pet-wrap-v1'}],mockupVisible:true,mockupPosition:data.labels.length});
  add('labels',{...entity('nata-pet320-watermelon-demo-label','Watermelon · PET 320 ml · Neutral sleeve demo'),drinkTypeId:'nata-de-coco',flavorId:'nata-watermelon-demo',mediaId:'label-pet-320-nata-watermelon-demo',compatibilities:[{packagingVariantId:'pet-320',layoutProfile:'pet-wrap-v1'}],mockupVisible:true,mockupPosition:data.labels.length});
  add('productGroups',{...entity('nata-de-coco','Nata De Coco'),drinkTypeId:'nata-de-coco',description:'A mango juice drink with coconut jelly. Preview the PET 320 ml bottle with a temporary demo label.',buttonLabel:'Nata De Coco',position:data.productGroups.length,visible:true,collectionVisible:false,heroVolumeCaption:'Net content',heroFlavorText:'Mango with coconut jelly',heroOriginText:'Real fruit from Vietnam'});
  add('productVariants',{...entity('nata-pet320-mango-demo','Nata De Coco · Mango · PET 320 ml'),groupId:'nata-de-coco',packagingVariantId:'pet-320',flavorId:'nata-mango-demo',code:'NATA-PET320-DEMO',description:'Temporary demo label. Replace with approved packaging artwork.',enabled:true});
  add('displays3d',{...entity('nata-pet320-mango-demo-3d','Nata De Coco · Mango · PET 320 ml'),productVariantId:'nata-pet320-mango-demo',modelId:'registry-pet-320-nata',labelId:'nata-pet320-mango-demo-label',liquidColor:null,enabled:true});
  add('productVariants',{...entity('nata-pet320-watermelon-demo','Nata De Coco · Watermelon · PET 320 ml'),groupId:'nata-de-coco',packagingVariantId:'pet-320',flavorId:'nata-watermelon-demo',code:'NATA-PET320-WATERMELON-DEMO',description:'Neutral unprinted sleeve for comparison with the Unity watermelon reference.',enabled:true});
  add('displays3d',{...entity('nata-pet320-watermelon-demo-3d','Nata De Coco · Watermelon · PET 320 ml'),productVariantId:'nata-pet320-watermelon-demo',modelId:'registry-pet-320-nata',labelId:'nata-pet320-watermelon-demo-label',liquidColor:null,enabled:true});
  add('packagingSlots',{...entity('slot-nata-pet320','Nata De Coco · PET 320 ml'),groupId:'nata-de-coco',packagingVariantId:'pet-320',regionKey:'packaging-picker',position:0,buttonLabel:'320 ml PET',mode:'3d',defaultVariantId:'nata-pet320-mango-demo',enabled:true});
  if(process.argv.includes('--watermelon')) {
    const slot=data.packagingSlots.find(x=>x.id==='slot-nata-pet320');
    slot.defaultVariantId='nata-pet320-watermelon-demo';
    const group=data.productGroups.find(x=>x.id==='nata-de-coco');
    if(group.description?.includes('temporary demo label')) group.description='Fruit juice drinks with coconut jelly. Preview the PET 320 ml bottle with the watermelon optical demo.';
    if(['Mango with coconut jelly','Watermelon with coconut jelly'].includes(group.heroFlavorText)) group.heroFlavorText='Fruit juice with coconut jelly';
  }
  const failures=[...validateCatalog(data),...preflightCatalog(data)].filter(x=>x.severity==='error');
  const ownFailures=failures.filter(x=>/nata|pet-320|slot-nata/.test(x.entityId));
  if(ownFailures.length) throw new Error(JSON.stringify(ownFailures));
  const m=data.models3d.find(x=>x.id==='registry-pet-320-nata');
  if(checkModelLabelGeometry(m,fs.readFileSync(path.join('public',model.src))).length) throw new Error('Label UV/slot invalid');
  return data;
}

const db=new DatabaseSync('data/admin/catalog.sqlite');
try {
  db.exec('PRAGMA busy_timeout=5000');
  const originalDraft=db.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data;
  const active=db.prepare('SELECT r.* FROM releases r JOIN publication p ON p.release_id=r.id WHERE p.id=1').get();
  if(!active) throw new Error('No local published catalog');
  const draft=mergePet(JSON.parse(originalDraft));
  // Activate only this model's records; unpublished changes from other chats stay in draft.
  const released=prepareCatalogRelease(mergePet(JSON.parse(active.data)));
  const failures=preflightCatalog(released).filter(x=>x.severity==='error');
  if(failures.length) throw new Error(JSON.stringify(failures));
  const summary={apply:process.argv.includes('--apply'),triangles:model.triangles,glbBytes:model.bytes,models:released.models3d.length,displayId:process.argv.includes('--watermelon')?'nata-pet320-watermelon-demo-3d':'nata-pet320-mango-demo-3d',draftPreserved:true};
  if(summary.apply) {
    const dir=path.join('data/admin/pet-320-backups');fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,`before-${Date.now()}.json`),JSON.stringify({draft:JSON.parse(originalDraft),release:active},null,2));
    db.exec('BEGIN IMMEDIATE');
    if(db.prepare('SELECT data FROM draft_catalog WHERE id=1').get().data!==originalDraft||db.prepare('SELECT release_id FROM publication WHERE id=1').get().release_id!==active.id) throw new Error('Catalog changed during import; rerun to merge latest data');
    db.prepare('UPDATE draft_catalog SET data=? WHERE id=1').run(JSON.stringify(draft));
    const id=randomUUID();
    db.prepare('INSERT INTO releases(id,created_at,created_by,note,data) VALUES(?,?,?,?,?)').run(id,stamp,'pet-model-import','PET 320 ml Nata De Coco: local Mango and Watermelon optical demos',JSON.stringify(released));
    db.prepare('UPDATE publication SET release_id=? WHERE id=1').run(id);
    db.exec('COMMIT');
    summary.releaseId=id;
    summary.export=exportPublishedCatalog();
  }
  console.log(JSON.stringify(summary,null,2));
} catch(error) {
  if(db.isTransaction) db.exec('ROLLBACK');throw error;
} finally { db.close(); }
