'use client';

import NextImage from 'next/image';
import { useId, useState } from 'react';
import { useLanguage } from '@/components/LanguageProvider';
import { Check, ChevronLeft, ChevronRight, Layers3, Package, Search, Tag, X } from 'lucide-react';
import type { CatalogData, Display3D, Label, Model3D } from '@/lib/catalog/contracts';
import { getCompatibleMockupLabels, getMockupLibrary } from '@/lib/catalog/mockup';
import { mediaUrl } from '@/lib/catalog/resolve';
import { normalizeSearch } from '@/lib/i18n/catalog';
import type { MockupCopy } from '@/lib/i18n/mockup';
import { mockupGlassStyle } from './glass';
import styles from './mockup.module.css';

type Tab = 'models' | 'presets' | 'labels';
interface Props {
  data: CatalogData; source: CatalogData; copy: MockupCopy; modelId?: string; labelId?: string; displayId?: string; disabled: boolean;
  onModel: (item: Model3D) => void; onLabel: (item: Label | null) => void; onDisplay: (item: Display3D) => void;
}

export default function MockupLibrary({ data, source, copy, modelId, labelId, displayId, disabled, onModel, onLabel, onDisplay }: Props) {
  const { locale } = useLanguage();
  const id = useId();
  const [tab, setTab] = useState<Tab>('models');
  const [query, setQuery] = useState('');
  const [packaging, setPackaging] = useState('');
  const [volume, setVolume] = useState('');
  const [drink, setDrink] = useState('');
  const [page, setPage] = useState(0);
  const library = getMockupLibrary(data);
  const labels = modelId ? getCompatibleMockupLabels(data, modelId) : [];
  const findModel = (item: Display3D) => library.models.find(model => model.id === item.modelId);
  const findLabel = (item: Display3D) => library.labels.find(label => label.id === item.labelId);
  const modelPackage = (model?: Model3D) => data.packagingVariants.find(item => item.id === model?.packagingVariantId);
  const labelType = (label?: Label) => data.drinkTypes.find(item => item.id === label?.drinkTypeId);
  const flavorName = (label?: Label) => data.flavors.find(item => item.id === label?.flavorId)?.name || '';
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const matchesSearch = (values: (string | undefined)[]) => terms.every(term => normalizeSearch(values.filter(Boolean).join(' ')).includes(term));
  const sourceName = (collection: 'models3d' | 'labels' | 'displays3d', itemId: string) => source[collection].find(item => item.id === itemId)?.name;
  const modelMatches = (item: Model3D) => {
    const variant = modelPackage(item);
    return (!packaging || variant?.categoryId === packaging) && (!volume || String(variant?.volumeMl) === volume) && matchesSearch([item.name, sourceName('models3d', item.id), variant?.name, variant?.shape]);
  };
  const labelMatches = (item: Label) => (!drink || item.drinkTypeId === drink) && matchesSearch([item.name, sourceName('labels', item.id), flavorName(item), labelType(item)?.name]);
  const filteredModels = library.models.filter(modelMatches);
  const filteredLabels = labels.filter(labelMatches);
  const filteredDisplays = library.displays.filter(item => {
    const model = findModel(item), label = findLabel(item), variant = modelPackage(model);
    return (!drink || label?.drinkTypeId === drink) && (!volume || String(variant?.volumeMl) === volume) && matchesSearch([item.name, sourceName('displays3d', item.id), label?.name, model?.name, variant?.name, flavorName(label)]);
  });
  const items = tab === 'models' ? filteredModels : tab === 'labels' ? filteredLabels : filteredDisplays;
  const pageSize = 4, pages = Math.max(1, Math.ceil(items.length / pageSize)), actualPage = Math.min(page, pages - 1);
  const visible = items.slice(actualPage * pageSize, (actualPage + 1) * pageSize);
  const usedCategories = new Set(library.models.map(model => modelPackage(model)?.categoryId));
  const volumes = [...new Set(library.models.map(model => modelPackage(model)?.volumeMl).filter((value): value is number => typeof value === 'number'))].sort((a, b) => a - b);
  const typeIds = new Set((tab === 'labels' ? labels : library.displays.map(item => findLabel(item)).filter((item): item is Label => !!item)).map(item => item.drinkTypeId));
  const clear = () => { setQuery(''); setPackaging(''); setVolume(''); setDrink(''); setPage(0); };
  const hasFilters = !!(query || packaging || volume || drink);
  const changeTab = (next: Tab) => { setTab(next); clear(); };
  const thumbnail = (item: Model3D | Label | Display3D) => {
    if ('materialSlots' in item) return mediaUrl(data.media.find(media => media.id === item.posterId));
    if ('compatibilities' in item) return mediaUrl(data.media.find(media => media.id === item.mediaId));
    const detail = data.productDetails.find(detail => detail.labelId === item.labelId && detail.enabled && detail.lifecycle === 'active');
    const presetLabel = findLabel(item), presetModel = findModel(item);
    const artwork = data.assets2d.find(asset => asset.lifecycle === 'active' && asset.packagingVariantId === presetModel?.packagingVariantId && asset.drinkTypeId === presetLabel?.drinkTypeId && asset.flavorId === presetLabel?.flavorId);
    return mediaUrl(data.media.find(media => media.id === detail?.posterId)) || mediaUrl(data.media.find(media => media.id === artwork?.mediaId)) || mediaUrl(data.media.find(media => media.id === presetLabel?.mediaId)) || mediaUrl(data.media.find(media => media.id === presetModel?.posterId));
  };
  const card = (item: Model3D | Label | Display3D) => {
    const isModel = 'materialSlots' in item, isLabel = 'compatibilities' in item;
    const model = isModel ? item as Model3D : !isLabel ? findModel(item as Display3D) : undefined;
    const label = isLabel ? item as Label : !isModel ? findLabel(item as Display3D) : undefined;
    const variant = modelPackage(model);
    const selected = isModel ? item.id === modelId : isLabel ? item.id === labelId : item.id === displayId;
    const img = thumbnail(item);
    return <button type="button" key={item.id} title={item.name} className={`${styles.libraryCard} ${isLabel ? styles.labelCard : ''}`} aria-pressed={selected} disabled={disabled}
      onClick={() => { if (isModel) onModel(item as Model3D); else if (isLabel) onLabel(item as Label); else onDisplay(item as Display3D); }}>
      <span className={styles.thumbnail}>{img ? <NextImage src={img} alt="" fill sizes="(min-width: 1200px) 180px, 140px" loading="lazy" decoding="async" unoptimized /> : <Package size={32} aria-hidden="true" />}
        {selected && <span className={styles.cardCheck}><Check size={14} aria-hidden="true" /><span className={styles.srOnly}>{copy.selected}</span></span>}
      </span>
      <span className={styles.cardName}>{item.name}</span>
      <span className={styles.cardMeta}>{isLabel ? flavorName(label) || labelType(label)?.name : [variant?.volumeMl ? `${variant.volumeMl} ml` : null, variant?.shape].filter(Boolean).join(' · ')}</span>
    </button>;
  };
  const icon = { models: Package, presets: Layers3, labels: Tag };
  return <section className={styles.library} style={mockupGlassStyle} aria-labelledby={`${id}-title`}>
    <div className={styles.libraryHeading}><h2 id={`${id}-title`}>{copy.library}</h2><span>{library.models.length}<Package size={14} aria-hidden="true" /></span></div>
    <div className={styles.tabs} role="tablist" aria-label={copy.library} onKeyDown={event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      const options: Tab[] = ['models','presets','labels'];
      const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (locale === 'ar' ? -1 : 1);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (options.indexOf(tab) + delta + 3) % 3;
      event.preventDefault(); changeTab(options[index]); document.getElementById(`${id}-${options[index]}`)?.focus();
    }}>
      {(['models','presets','labels'] as Tab[]).map(item => { const Icon = icon[item]; return <button id={`${id}-${item}`} key={item} type="button" role="tab" aria-selected={tab === item} aria-controls={`${id}-panel`} tabIndex={tab === item ? 0 : -1} onClick={() => changeTab(item)}><Icon size={16} aria-hidden="true" />{copy[item]}</button>; })}
    </div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} className={styles.libraryPanel}>
      <label className={styles.search} htmlFor={`${id}-search`}><Search size={16} aria-hidden="true" /><span className={styles.srOnly}>{copy.search}</span><input id={`${id}-search`} type="search" value={query} placeholder={copy.searchPlaceholder} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <div className={styles.filters}>
        {tab === 'models' ? <label>{copy.packaging}<select value={packaging} onChange={event => { setPackaging(event.target.value); setPage(0); }}><option value="">{copy.all}</option>{data.packagingCategories.filter(item => usedCategories.has(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <label>{copy.drink}<select value={drink} onChange={event => { setDrink(event.target.value); setPage(0); }}><option value="">{copy.all}</option>{data.drinkTypes.filter(item => typeIds.has(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {tab !== 'labels' && <label>{copy.volume}<select value={volume} onChange={event => { setVolume(event.target.value); setPage(0); }}><option value="">{copy.all}</option>{volumes.map(value => <option key={value} value={value}>{value} ml</option>)}</select></label>}
      </div>
      <div className={styles.librarySummary}>
        <div className={styles.results}><span aria-live="polite">{items.length} {copy.results}</span>{hasFilters && <button type="button" onClick={clear}><X size={13} aria-hidden="true" />{copy.clear}</button>}</div>
        {tab === 'labels' && <div className={styles.labelInfo}><Tag size={15} aria-hidden="true" /><span>{copy.compatible} · {labels.length}</span>{labelId && <button type="button" disabled={disabled} onClick={() => onLabel(null)} title={copy.removeLabel} aria-label={copy.removeLabel}><X size={16} aria-hidden="true" /></button>}</div>}
      </div>
      <div className={styles.libraryList}>
        {tab === 'labels' && !labels.length ? <div className={styles.empty}><Tag size={28} aria-hidden="true" /><h3>{copy.noLabels}</h3><p>{copy.noLabelsCopy}</p><button type="button" onClick={() => changeTab('models')}>{copy.models}<ChevronRight size={16} aria-hidden="true" /></button></div>
          : !items.length ? <div className={styles.empty}><Search size={28} aria-hidden="true" /><h3>{copy.noResults}</h3><p>{copy.tryFilters}</p>{hasFilters && <button type="button" onClick={clear}>{copy.clear}</button>}</div>
          : tab === 'labels' ? data.drinkTypes.filter(type => visible.some(item => (item as Label).drinkTypeId === type.id)).map(type => <div key={type.id} className={styles.labelGroup}><h3>{type.name}<span>{filteredLabels.filter(item => item.drinkTypeId === type.id).length}</span></h3><div className={styles.cardGrid}>{visible.filter(item => (item as Label).drinkTypeId === type.id).map(card)}</div></div>) : <div className={styles.cardGrid}>{visible.map(card)}</div>}
      </div>
      {pages > 1 && <nav className={styles.pagination} aria-label={copy.library}><button type="button" disabled={actualPage === 0} onClick={() => setPage(actualPage - 1)} aria-label={copy.previous}><ChevronLeft size={17} aria-hidden="true" /></button><span>{copy.page} {actualPage + 1} {copy.of} {pages}</span><button type="button" disabled={actualPage >= pages - 1} onClick={() => setPage(actualPage + 1)} aria-label={copy.next}><ChevronRight size={17} aria-hidden="true" /></button></nav>}
    </div>
  </section>;
}
