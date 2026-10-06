'use client';
import { useEffect,useState } from 'react';
import { Bell,TriangleAlert } from 'lucide-react';
import type { SecurityReport } from '@/lib/operations/contracts';
import { operationRequest } from './api';
import styles from './operations.module.css';
export default function OperationsStatus({onOpen}:{onOpen:()=>void}){
  const [report,setReport]=useState<SecurityReport|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();let busy=false;
    const load=async()=>{if(busy||document.visibilityState==='hidden')return;busy=true;try{const data=await operationRequest<SecurityReport>('security',{signal:controller.signal});setReport(data);setFailed(false);}catch{if(!controller.signal.aborted)setFailed(true);}finally{busy=false;}};
    void load();const timer=window.setInterval(()=>void load(),30000);document.addEventListener('visibilitychange',load);
    return()=>{controller.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',load);};
  },[]);
  const count=report?.totals.openAlerts||0,unavailable=failed||report?.monitoring==='degraded';
  if (!count && !unavailable) return null;
  return <button type="button" className={`${styles.statusButton} ${styles.statusWarning}`} onClick={onOpen} aria-label={unavailable?'Giám sát cần kiểm tra':`${count} cảnh báo cần kiểm tra`} title={unavailable?'Không nhận được log mới':report?`Kiểm tra gần nhất: ${new Date(report.generatedAt).toLocaleTimeString('vi-VN')}`:undefined}>{unavailable?<TriangleAlert size={17}/>:<Bell size={17}/>}<span>{unavailable?'Kiểm tra log':`${count} cảnh báo`}</span></button>;
}
