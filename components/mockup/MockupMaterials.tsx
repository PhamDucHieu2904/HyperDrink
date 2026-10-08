'use client';

import { useId, useState } from 'react';
import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { ProductAsset } from '@/lib/viewer-config';
import type { LiveMaterialOverrides, LiveMaterialValues } from '@/lib/viewer/material-adjustments';
import type { MockupMaterialCopy } from '@/lib/i18n/mockup-materials';
import { mockupGlassStyle } from './glass';
import styles from './mockup.module.css';

function Range({ title, name, value, min = 0, max = 100, disabled, hint, onChange }: {
  title: string; name: string; value: number; min?: number; max?: number; disabled: boolean; hint?: string; onChange(value: number): void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return <div className={styles.materialRange}>
    <label htmlFor={id}>{title}</label>
    <div className={styles.rangeInputs} dir="ltr">
      <input id={id} type="range" min={min} max={max} step={0.1} value={value} disabled={disabled} aria-label={name} aria-describedby={hint ? `${id}-hint` : undefined} onChange={event => { setDraft(null); onChange(Number(event.target.value)); }} />
      <div className={styles.rangeNumber}><input type="number" aria-label={`${name} (%)`} min={min} max={max} step={0.1} value={draft ?? Number(value.toFixed(1))} disabled={disabled} onBlur={() => { if (draft !== null && draft.trim() && Number.isFinite(Number(draft))) onChange(Math.max(min, Math.min(max, Number(draft)))); setDraft(null); }} onChange={event => {
        setDraft(event.target.value); const next = Number(event.target.value);
        if (event.target.value.trim() && Number.isFinite(next) && next >= min && next <= max) onChange(next);
      }} /><span aria-hidden="true">%</span></div>
    </div>
    {hint && <p id={`${id}-hint`} className={styles.materialHint}>{hint}</p>}
  </div>;
}

function Color({ title, value, disabled, onChange }: { title: string; value: string; disabled: boolean; onChange(value: string): void }) {
  const id = useId();
  return <div className={styles.materialColor}><label htmlFor={id}>{title}</label><div><code dir="ltr">{value.toUpperCase()}</code><input id={id} type="color" value={value} disabled={disabled} onInput={event => onChange(event.currentTarget.value)} onChange={event => onChange(event.target.value)} /></div></div>;
}

export default function MockupMaterials({ asset, hasLabel, defaults, overrides, disabled, copy, onChange }: {
  asset: ProductAsset; hasLabel: boolean; defaults: LiveMaterialOverrides; overrides: LiveMaterialOverrides; disabled: boolean;
  copy: MockupMaterialCopy; onChange(overrides: LiveMaterialOverrides): void;
}) {
  const lid = asset.materialSlots?.cap?.length ? 'cap' : asset.materialSlots?.lid?.length ? 'lid' : null;
  const values = (slot: string): LiveMaterialValues => ({ ...defaults[slot], ...overrides[slot] });
  const change = (slot: string, edit: LiveMaterialValues) => onChange({ ...overrides, [slot]: { ...overrides[slot], ...edit } });
  const finish = (slot: string, title: string, color = false) => {
    const supported = !!asset.materialSlots?.[slot]?.length && (slot !== 'label' || hasLabel);
    const locked = disabled || !supported;
    const v = values(slot);
    return <details className={styles.materialGroup}>
      <summary><span>{title}</span><ChevronDown size={15} aria-hidden="true" /></summary>
      <div className={styles.materialGroupContent}>
        {!supported && <p className={styles.materialHint}>{copy.unavailable}</p>}
        {color && <Color title={`${title} · ${copy.color}`} value={v.color ?? '#ffffff'} disabled={locked} onChange={color => change(slot, { color })} />}
        <Range title={copy.metallic} name={`${title} · ${copy.metallic}`} value={(v.metalness ?? 0) * 100} disabled={locked} onChange={value => change(slot, { metalness: value / 100 })} />
        <Range title={copy.smoothness} name={`${title} · ${copy.smoothness}`} value={(1 - (v.roughness ?? 0.5)) * 100} disabled={locked} onChange={value => change(slot, { roughness: 1 - value / 100 })} />
      </div>
    </details>;
  };
  return <section className={`${styles.exportPanel} ${styles.materialPanel}`} style={mockupGlassStyle} aria-labelledby="mockup-material-title">
    <div className={styles.materialHeading}><SlidersHorizontal size={17} aria-hidden="true" /><h2 id="mockup-material-title">{copy.title}</h2><button type="button" aria-label={copy.reset} title={copy.reset} disabled={disabled || !Object.keys(overrides).length} onClick={() => onChange({})}><RotateCcw size={16} aria-hidden="true" /></button></div>
    <Range title={copy.offset} name={copy.offset} hint={copy.offsetHint} value={(values('label').textureOffsetX ?? 0) * 100} min={-50} max={50} disabled={disabled || !hasLabel} onChange={value => change('label', { textureOffsetX: value / 100 })} />
    {finish(lid ?? 'cap', copy.lid, true)}
    <div className={styles.waterControl}><Color title={copy.water} value={values('liquid').color ?? '#ffffff'} disabled={disabled || !asset.materialSlots?.liquid?.length} onChange={color => change('liquid', { color })} /></div>
    {finish('body', copy.body)}
    {finish('label', copy.label)}
  </section>;
}
