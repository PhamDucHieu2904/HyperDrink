'use client';
import { useState } from 'react';
import styles from './operations.module.css';
const number=(value:number)=>new Intl.NumberFormat('vi-VN').format(value);
export function TrendChart({rows,series,hourly=false}:{rows:{time:string;[key:string]:string|number}[];series:{key:string;label:string;color:string}[];hourly?:boolean}){
  const [selected,setSelected]=useState<number|null>(null);
  const largest=Math.max(1,...rows.flatMap(row=>series.map(item=>Number(row[item.key]))));
  const unit=Math.pow(10,Math.floor(Math.log10(largest/4)));
  const step=Math.max(1,[1,2,5,10].find(value=>value*unit>=largest/4)!*unit);
  const max=step*4;
  const x=(i:number)=>52+i*640/Math.max(1,rows.length-1),y=(value:number)=>196-value/max*164;
  const date=(time:string)=>new Intl.DateTimeFormat('vi-VN',{timeZone:'UTC',...(hourly?{hour:'2-digit',hourCycle:'h23' as const}:{day:'2-digit',month:'2-digit'})}).format(new Date(time));
  return <div className={styles.chart}><div className={styles.legend}>{series.map((item,index)=><span key={item.key}><i style={{background:item.color,borderRadius:index===0?'50%':'0'}}/>{item.label}</span>)}<small>Mốc thời gian UTC</small></div>
    <svg viewBox="0 0 720 240" role="img" aria-label={`Biểu đồ ${series.map(item=>item.label).join(', ')} theo thời gian`}>
      {[0,.25,.5,.75,1].map(tick=><g key={tick}><line x1="52" x2="692" y1={y(max*tick)} y2={y(max*tick)} stroke="var(--ops-border)" strokeDasharray="3 5"/><text x="43" y={y(max*tick)+4} textAnchor="end">{number(Math.ceil(max*tick))}</text></g>)}
      {series.map((item,index)=><g key={item.key}><polyline points={rows.map((row,i)=>`${x(i)},${y(Number(row[item.key]))}`).join(' ')} fill="none" stroke={item.color} strokeWidth="2.5" strokeDasharray={index?'5 4':undefined} strokeLinejoin="round"/>{rows.map((row,i)=><circle key={row.time} cx={x(i)} cy={y(Number(row[item.key]))} r={selected===i?5:3} fill={item.color} tabIndex={0} aria-label={`${date(row.time)}: ${item.label} ${number(Number(row[item.key]))}`} onFocus={()=>setSelected(i)} onBlur={()=>setSelected(null)} onMouseEnter={()=>setSelected(i)} onMouseLeave={()=>setSelected(null)}><title>{date(row.time)} · {item.label}: {number(Number(row[item.key]))}</title></circle>)}</g>)}
      {rows.filter((_,i)=>i===0||i===rows.length-1||i%Math.max(1,Math.ceil(rows.length/5))===0).map(row=><text key={row.time} x={x(rows.indexOf(row))} y="221" textAnchor="middle">{date(row.time)}</text>)}
    </svg>
    <div className={styles.tooltip} aria-live="polite">{selected!==null&&rows[selected]?`${date(rows[selected].time)} · ${series.map(item=>`${item.label}: ${number(Number(rows[selected][item.key]))}`).join(' · ')}`:'Di chuột hoặc dùng Tab để xem từng mốc.'}</div>
    <details className={styles.details}><summary>Xem bảng số liệu</summary><div className={styles.tableWrap}><table><thead><tr><th>Thời gian (UTC)</th>{series.map(item=><th key={item.key}>{item.label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.time}><td>{new Date(row.time).toLocaleString('vi-VN',{timeZone:'UTC'})}</td>{series.map(item=><td key={item.key}>{number(Number(row[item.key]))}</td>)}</tr>)}</tbody></table></div></details>
  </div>;
}
export function BarChart({rows,empty='Chưa có sự kiện trong khoảng thời gian này.'}:{rows:{name:string;count:number}[];empty?:string}){
  const max=Math.max(1,...rows.map(row=>row.count));
  if(!rows.length)return <p className={styles.empty}>{empty}</p>;
  return <ul className={styles.bars}>{rows.map((row,i)=><li key={`${row.name}-${i}`}><div><span>{row.name}</span><strong>{number(row.count)}</strong></div><div role="meter" aria-label={row.name} aria-valuemin={0} aria-valuemax={max} aria-valuenow={row.count} className={styles.barTrack}><span style={{width:`${row.count/max*100}%`}}/></div></li>)}</ul>;
}
