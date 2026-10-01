'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Cherry, Citrus, Leaf, RefreshCw } from 'lucide-react';
import type { CatalogData, PackagingSlot, ProductVariant } from '@/lib/catalog/contracts';
import { mediaUrl, resolveDisplay3D } from '@/lib/catalog/resolve';
import { publicUrl } from '@/lib/public-url';
import styles from './published.module.css';

const ProductViewer = dynamic(()=>import('@/components/ProductViewer'),{ssr:false});
type Published = {catalog:CatalogData;releaseId:string;publishedAt:string};

/** Reads committed releases only. Ready for integration with the main showcase. */
export default function PublishedShowcase() {
  const [published,setPublished]=useState<Published|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [groupId,setGroupId]=useState('');
  const [slotId,setSlotId]=useState('');
  const [variantId,setVariantId]=useState('');
  const refresh=useCallback(async()=>{
    setLoading(true);setError('');
    try {const base=(process.env.NEXT_PUBLIC_ADMIN_API_URL||publicUrl('/')).replace(/\/$/,'');const response=await fetch(base+'/api/public/v1/catalog',{cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'Không tải được catalog.');setPublished(result.data);}
    catch(cause){setError(cause instanceof Error?cause.message:'Không tải được dữ liệu.');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{const timer=setTimeout(()=>void refresh(),0);return()=>clearTimeout(timer);},[refresh]);
  const data=published?.catalog;
  const groups=data?.productGroups.filter(item=>item.visible&&item.lifecycle==='active').sort((a,b)=>a.position-b.position)||[];
  const group=groups.find(item=>item.id===groupId)||groups[0];
  const slots=data?.packagingSlots.filter(item=>item.groupId===group?.id&&item.enabled&&item.lifecycle==='active').sort((a,b)=>a.position-b.position)||[];
  const slot=slots.find(item=>item.id===slotId)||slots[0];
  const variants=data?.productVariants.filter(item=>item.groupId===group?.id&&item.packagingVariantId===slot?.packagingVariantId&&item.enabled&&item.lifecycle==='active')||[];
  const variant=variants.find(item=>item.id===variantId)||variants.find(item=>item.id===slot?.defaultVariantId)||variants[0];
  const flavor=data?.flavors.find(item=>item.id===variant?.flavorId);
  const Icon=flavor?.icon==='berry'?Cherry:['citrus','orange','lime'].includes(flavor?.icon||'')?Citrus:Leaf;
  return <main className={styles.showcase} style={flavor?{backgroundColor:flavor.backgroundColor,color:flavor.textColor}:undefined}>
    <header className={styles.header}><a href={publicUrl('/admin')}><ArrowLeft size={17}/> Admin</a><strong>VINUT · CATALOG PREVIEW</strong><button onClick={()=>void refresh()} disabled={loading}><RefreshCw size={17}/> {loading?'Đang tải':'Tải bản mới'}</button></header>
    <div className={styles.pattern} aria-hidden="true">{Array.from({length:70},(_,index)=><Icon key={index} size={27}/>)}</div>
    <section className={styles.content}>
      <p className={styles.eyebrow}>DỮ LIỆU ĐÃ XUẤT BẢN</p>
      <nav className={styles.groups} aria-label="Dòng sản phẩm">{groups.map(item=><button key={item.id} aria-pressed={group?.id===item.id} onClick={()=>{setGroupId(item.id);setSlotId('');setVariantId('');}}>{item.buttonLabel||item.name}</button>)}</nav>
      {error&&<p className={styles.notice} role="alert">{error} {published?'Bản đã tải vẫn được giữ.':''}</p>}
      {data&&group&&slot&&variant?<>
        <div className={styles.hero}><div className={styles.copy}><span>{data.drinkTypes.find(item=>item.id===group.drinkTypeId)?.name}</span><h1>{group.name}</h1><h2>{flavor?.name}</h2><p>{variant.description||group.description||flavor?.description}</p><nav className={styles.flavors} aria-label="Hương vị">{variants.map(item=>{const entry=data.flavors.find(value=>value.id===item.flavorId);const image=data.media.find(value=>value.id===entry?.thumbnailId);return <button key={item.id} aria-pressed={variant.id===item.id} onClick={()=>setVariantId(item.id)}>{image&&<Image unoptimized width={42} height={42} src={mediaUrl(image)} alt=""/>}<span>{entry?.shortName||item.name}</span></button>;})}</nav></div><LiveProduct key={published.releaseId+':'+variant.id+':'+slot.mode} data={data} variant={variant} slot={slot} releaseId={published.releaseId}/></div>
        <nav className={styles.packaging} aria-label="Kiểu dáng bao bì"><span>KIỂU DÁNG BAO BÌ</span><div>{slots.map(item=><button key={item.id} aria-pressed={slot.id===item.id} onClick={()=>{setSlotId(item.id);setVariantId('');}}>{item.buttonLabel||data.packagingVariants.find(value=>value.id===item.packagingVariantId)?.name}</button>)}</div></nav>
      </>:!loading&&!error&&<p className={styles.notice}>Bản phát hành chưa có dòng sản phẩm đang hiển thị. Tạo cấu hình, bật dòng và xuất bản trong admin.</p>}
      <footer className={styles.footer}>{published?'Release '+published.releaseId.slice(0,8)+' · '+new Date(published.publishedAt).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok'}):'Chưa tải bản phát hành'}<span>Trang kiểm tra riêng để phối hợp tích hợp với giao diện chính.</span></footer>
    </section>
  </main>;
}

function LiveProduct({data,variant,slot,releaseId}:{data:CatalogData;variant:ProductVariant;slot:PackagingSlot;releaseId:string}) {
  const [failed,setFailed]=useState(false);
  const display=data.displays3d.find(item=>item.productVariantId===variant.id&&item.enabled);
  const resolved=display?resolveDisplay3D(data,display,releaseId):null;
  const display2d=data.displays2d.find(item=>item.productVariantId===variant.id&&item.enabled);
  const asset=data.assets2d.find(item=>item.id===display2d?.assetId);
  const productImage=data.media.find(item=>item.id===asset?.mediaId);
  const image=productImage||data.media.find(item=>item.id===data.models3d.find(model=>model.id===display?.modelId)?.posterId);
  return <div className={styles.stage}>{slot.mode!=='2d'&&resolved&&!failed?<ProductViewer asset={resolved.asset} appearance={resolved.appearance} accentScene={resolved.accentScene} onStatus={status=>{if(status.phase==='error')setFailed(true);}}/>:image?<><Image unoptimized fill sizes="(max-width: 760px) 95vw, 50vw" src={mediaUrl(image)} alt={productImage?display2d?.alt||variant.name:'Hình minh họa kiểu dáng bao bì'} style={{objectFit:'contain',padding:'30px'}}/>{!productImage&&<p role="status" style={{position:'absolute',bottom:8,padding:'8px 14px',background:'rgba(0,0,0,.55)',borderRadius:8}}>3D chưa tải được · Hình minh họa bao bì</p>}</>:<p role="status">Tài nguyên sản phẩm chưa tải được.</p>}</div>;
}
