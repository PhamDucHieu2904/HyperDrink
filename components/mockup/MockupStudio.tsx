'use client';

import NextImage from 'next/image';
import { ArrowLeft, ArrowDownToLine, Box, Check, ChevronDown, Circle, Image as ImageIcon, LoaderCircle, Minus, MousePointer2, Pause, Play, Plus, RotateCcw, Rotate3D, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LanguageProvider, useLanguage } from '@/components/LanguageProvider';
import LanguageSelector from '@/components/LanguageSelector';
import { useTranslatedCatalog } from '@/components/useTranslatedCatalog';
import { getCompatibleMockupLabels, resolveMockupProduct, resolveMockupSelection, type MockupQuery } from '@/lib/catalog/mockup';
import type { Display3D, Label, Model3D } from '@/lib/catalog/contracts';
import type { MockupAnimation, MockupBackground, MockupCameraPreset, MockupStatus } from '@/lib/mockup/contracts';
import { mockupSelectionKey } from '@/lib/mockup/selection';
import { mockupCopy } from '@/lib/i18n/mockup';
import { publicUrl } from '@/lib/public-url';
import MockupCanvas, { type MockupCanvasHandle } from './MockupCanvas';
import MockupLibrary from './MockupLibrary';
import { useMockupCatalog } from './useMockupCatalog';
import styles from './mockup.module.css';

export default function MockupStudio() { return <LanguageProvider><Studio /></LanguageProvider>; }

const frames = [{ id: 'square', ratio: 1, text: '1:1' }, { id: 'portrait', ratio: 4 / 5, text: '4:5' }, { id: 'landscape', ratio: 16 / 9, text: '16:9' }] as const;

function Studio() {
  const { locale } = useLanguage();
  const copy = mockupCopy[locale];
  const { published, available, loading, error, refresh, adopt } = useMockupCatalog();
  const data = useTranslatedCatalog(published?.catalog, true);
  const [request, setRequest] = useState<MockupQuery>({});
  const [languageOpen, setLanguageOpen] = useState(false);
  const [background, setBackground] = useState<MockupBackground>({ type: 'white', color: '#dbe9ce', colorEnd: '#fbefd9' });
  const [camera, setCamera] = useState<MockupCameraPreset | null>('front');
  const [animation, setAnimation] = useState<MockupAnimation>({ mode: 'off', playing: false, speed: 1 });
  const [frame, setFrame] = useState<(typeof frames)[number]>(frames[0]);
  const [resolution, setResolution] = useState<1024 | 2048>(2048);
  const [status, setStatus] = useState<MockupStatus | null>(null);
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [notification, setNotification] = useState<'downloaded' | 'exportError' | null>(null);
  const [lastExport, setLastExport] = useState<{ url: string; filename: string } | null>(null);
  const canvas = useRef<MockupCanvasHandle>(null);
  const exportRequest = useRef<AbortController | null>(null);
  const exportBusy = useRef(false);
  const pendingNavigation = useRef<MockupQuery | null>(null);
  const urls = useRef(new Set<string>());
  const selection = useMemo(() => published ? resolveMockupSelection(published.catalog, request) : null, [published, request]);
  const product = useMemo(() => published && selection ? resolveMockupProduct(published.catalog, selection) : null, [published, selection]);
  const selectedModel = data?.models3d.find(item => item.id === selection?.model?.id);
  const selectedLabel = data?.labels.find(item => item.id === selection?.label?.id);
  const packaging = data?.packagingVariants.find(item => item.id === selectedModel?.packagingVariantId);
  const currentScene = !!product && status?.selectionKey === mockupSelectionKey(product.asset, product.appearance, selection?.model?.mockupFrontYaw);
  const phase = exporting ? 'exporting' : status?.phase === 'ready' && !currentScene ? 'preparing' : status?.phase ?? 'preparing';
  const ready = currentScene && phase === 'ready';
  const locked = exporting || phase === 'exporting';
  const manualInteraction = useCallback(() => { setAnimation(value => ({ ...value, playing: false })); setCamera(null); }, []);
  const receiveStatus = useCallback((next: MockupStatus) => setStatus(next), []);
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(window.location.search);
      const next = { display: params.get('display'), model: params.get('model'), label: params.get('label') };
      if (exportBusy.current) pendingNavigation.current = next;
      else setRequest(next);
    };
    const timer = setTimeout(() => { read(); if (window.matchMedia('(max-width: 767px)').matches) setResolution(1024); }, 0);
    window.addEventListener('popstate', read);
    return () => { clearTimeout(timer); window.removeEventListener('popstate', read); };
  }, []);
  useEffect(() => {
    const pool = urls.current;
    return () => { exportRequest.current?.abort(); for (const url of pool) URL.revokeObjectURL(url); pool.clear(); };
  }, []);
  const choose = (next: MockupQuery) => {
    if (locked || exportBusy.current) return;
    setStatus(null); setNotification(null); setRequest(next); setAnimation(value => ({ ...value, playing: false }));
    const resolved = published ? resolveMockupSelection(published.catalog, next) : null;
    if (resolved?.model?.id !== selection?.model?.id) setCamera('front');
    const url = new URL(window.location.href); url.search = '';
    for (const [key, value] of Object.entries(next)) if (value) url.searchParams.set(key, value);
    window.history.replaceState(null, '', url);
  };
  const chooseModel = (model: Model3D) => {
    const old = selection?.label;
    const valid = old && published && getCompatibleMockupLabels(published.catalog, model.id).some(label => label.id === old.id);
    choose({ model: model.id, label: valid ? old.id : null });
  };
  const chooseLabel = (label: Label | null) => { if (selection?.model) choose({ model: selection.model.id, label: label?.id }); };
  const chooseDisplay = (display: Display3D) => choose({ display: display.id });
  const setView = (preset: MockupCameraPreset) => { canvas.current?.camera(preset); setCamera(preset); setAnimation(value => ({ ...value, playing: false })); };
  const exportImage = async () => {
    if (!ready || !canvas.current || locked || exportBusy.current || !selection?.model) return;
    exportBusy.current = true; setExporting(true); setNotification(null);
    const request = new AbortController(); exportRequest.current = request;
    try {
      const blob = await canvas.current.capture({ longEdge: resolution, aspect: frame.ratio, signal: request.signal });
      if (request.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      for (const previous of urls.current) URL.revokeObjectURL(previous);
      urls.current.clear(); urls.current.add(url);
      const name = [selection.label?.slug || selection.model.slug, packaging?.volumeMl ? `${packaging.volumeMl}ml` : ''].filter(Boolean).join('-').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 90) || 'mockup';
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/[^0-9]/g, '');
      const filename = `vinut-${name}-${date}.png`;
      setLastExport({ url, filename });
      const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
      setNotification('downloaded');
    } catch { if (!request.signal.aborted) setNotification('exportError'); }
    finally {
      exportBusy.current = false;
      if (!request.signal.aborted) {
        setExporting(false);
        if (pendingNavigation.current) { setStatus(null); setRequest(pendingNavigation.current); pendingNavigation.current = null; }
      }
      if (exportRequest.current === request) exportRequest.current = null;
    }
  };
  const statusText = phase === 'loading-model' ? copy.loadingModel : phase === 'loading-label' ? copy.loadingLabel : phase === 'ready' ? copy.ready : phase === 'exporting' ? copy.exporting : phase === 'error' ? status?.error === 'webgl' ? copy.webglError : copy.sceneError : copy.preparing;
  const previewStyle: CSSProperties = { '--frame-aspect': frame.ratio } as CSSProperties;
  const backgroundTypes = ['white','gray','dark','color','gradient','transparent'] as const;
  const downloadButton = (className: string) => <button type="button" className={className} disabled={!ready || locked} onClick={() => void exportImage()}>{locked ? <LoaderCircle size={18} className={styles.spinner} aria-hidden="true" /> : <ArrowDownToLine size={18} aria-hidden="true" />}{locked ? copy.exporting : copy.download}</button>;
  return <main className={styles.studio} data-language={locale}>
    <a href="#mockup-workspace" className={styles.skip}>{copy.open}</a>
    <header className={styles.header}>
      <a className={styles.backLink} href={publicUrl('/')} aria-label={copy.back} title={copy.back}><ArrowLeft size={18} aria-hidden="true" /><span>{copy.back}</span></a>
      <div className={styles.brand}><span>VINUT</span><i aria-hidden="true" /><h1>{copy.title}</h1></div>
      <div className={styles.headerActions}><LanguageSelector open={languageOpen} onOpenChange={setLanguageOpen} />{downloadButton(styles.headerDownload)}</div>
    </header>
    <div className={styles.intro}><div><p><Sparkles size={15} aria-hidden="true" />{copy.eyebrow}</p><span>{copy.intro}</span></div><span className={styles.studioBadge}><Box size={16} aria-hidden="true" />3D</span></div>
    {available && <div className={styles.notice} role="status"><span>{copy.newRelease}</span><button type="button" disabled={locked} onClick={() => { setStatus(null); adopt(); }}>{copy.reload}</button></div>}
    {selection?.warning && <div className={styles.notice} role="status">{selection.warning === 'incompatible-label' ? copy.incompatible : copy.unavailable}</div>}
    {loading && !published ? <div className={styles.fullState} role="status"><LoaderCircle size={32} className={styles.spinner} aria-hidden="true" /><p>{copy.preparing}</p></div>
      : error && !published ? <div className={styles.fullState} role="alert"><p>{copy.loadError}</p><button type="button" onClick={() => void refresh()}>{copy.retry}</button></div>
      : !product || !data || !published ? <div className={styles.fullState}><Box size={38} aria-hidden="true" /><h2>{copy.empty}</h2><p>{copy.emptyCopy}</p><a href={publicUrl('/')}>{copy.back}</a></div>
      : <div id="mockup-workspace" className={styles.workspace}>
        <section className={styles.previewPanel} aria-label={copy.title}>
          <div className={styles.sceneArea}>
            <div className={styles.stage} style={previewStyle}><div className={`${styles.frame} ${background.type === 'transparent' ? styles.checkerboard : ''}`}>
              <MockupCanvas ref={canvas} asset={product.asset} appearance={product.appearance} frontYaw={selection?.model?.mockupFrontYaw} background={background} animation={animation} aspect={frame.ratio} label={`${copy.title}. ${copy.keyboard}`} onStatus={receiveStatus} onInteraction={manualInteraction} retry={retry} locked={locked} />
              {phase !== 'ready' && phase !== 'error' && <div className={styles.sceneLoading} role="status"><LoaderCircle size={19} className={styles.spinner} aria-hidden="true" />{statusText}</div>}
              {phase === 'error' && <div className={styles.sceneError} role="alert"><p>{statusText}</p><button type="button" disabled={locked} onClick={() => { setStatus(null); setRetry(value => value + 1); }}>{copy.retry}</button></div>}
              <span className={styles.frameTag} aria-hidden="true">{frame.text}</span>
            </div></div>
          </div>
          <div className={styles.previewBottom}><span className={styles.dragHint}><MousePointer2 size={15} aria-hidden="true" />{copy.hint}</span><div className={styles.zoomTools}><button type="button" disabled={locked || !status?.hasProduct} aria-label={copy.zoomOut} onClick={() => canvas.current?.zoom(1 / 1.15)}><Minus size={18} aria-hidden="true" /></button><button type="button" disabled={locked || !status?.hasProduct} aria-label={copy.zoomIn} onClick={() => canvas.current?.zoom(1.15)}><Plus size={18} aria-hidden="true" /></button><span aria-hidden="true" /><button type="button" disabled={locked || !status?.hasProduct} onClick={() => { canvas.current?.reset(); setCamera('front'); }}><RotateCcw size={16} aria-hidden="true" />{copy.reset}</button></div></div>
          <div className={styles.sceneCaption}><div><strong>{selectedModel?.name}</strong><span>{packaging?.volumeMl ? `${packaging.volumeMl} ml · ` : ''}{selectedLabel?.name || copy.blank}</span></div><span className={`${styles.readiness} ${ready ? styles.isReady : ''}`} role="status">{ready ? <Check size={14} aria-hidden="true" /> : <span className={styles.statusDot} />}{statusText}</span></div>
          {(notification || lastExport) && <div className={styles.previewExport}>
            {notification && <p className={notification === 'exportError' ? styles.exportError : styles.exportSuccess} role={notification === 'exportError' ? 'alert' : 'status'}>{copy[notification]}</p>}
            {lastExport && <div className={styles.exportResult}>
              <a className={styles.exportThumbnail} href={lastExport.url} target="_blank" rel="noopener noreferrer" aria-label={copy.viewImage} title={copy.viewImage}><NextImage src={lastExport.url} alt="" width={76} height={76} unoptimized /></a>
              <div><strong>{copy.lastImage}</strong><span className={styles.exportFilename} dir="ltr" title={lastExport.filename}>{lastExport.filename}</span><a className={styles.exportAgain} href={lastExport.url} download={lastExport.filename} data-export-download><ArrowDownToLine size={15} aria-hidden="true" />{copy.downloadAgain}</a></div>
            </div>}
          </div>}
        </section>
        <aside className={styles.sidebar}>
          <MockupLibrary data={data} source={published.catalog} copy={copy} modelId={selection?.model?.id} labelId={selection?.label?.id} displayId={selection?.display?.id} disabled={locked} onModel={chooseModel} onLabel={chooseLabel} onDisplay={chooseDisplay} />
          <div className={styles.editingTools}>
            <div className={styles.backgroundBar}><span className={styles.toolLabel}><ImageIcon size={16} aria-hidden="true" />{copy.background}</span><div className={styles.backgroundChoices}>{backgroundTypes.map(type => <button type="button" key={type} aria-pressed={background.type === type} disabled={locked} onClick={() => setBackground(value => ({ ...value, type }))}><span className={`${styles.swatch} ${styles[type]}`} style={type === 'color' ? { background: background.color } : type === 'gradient' ? { background: `linear-gradient(135deg,${background.color},${background.colorEnd})` } : undefined}>{background.type === type && <Check size={11} aria-hidden="true" />}</span>{copy[type]}</button>)}</div>
              {(background.type === 'color' || background.type === 'gradient') && <div className={styles.colorFields}><label title={copy.colorStart}>{copy.colorStart}<input type="color" aria-label={copy.colorStart} value={background.color} disabled={locked} onChange={event => setBackground(value => ({ ...value, color: event.target.value }))} /></label>{background.type === 'gradient' && <label title={copy.colorEnd}>{copy.colorEnd}<input type="color" aria-label={copy.colorEnd} value={background.colorEnd} disabled={locked} onChange={event => setBackground(value => ({ ...value, colorEnd: event.target.value }))} /></label>}</div>}
            </div>
            <div className={styles.cameraTools} role="group" aria-label={copy.camera}><span className={styles.toolLabel}>{copy.camera}</span>{(['front','three-quarter','left','right','back','top'] as MockupCameraPreset[]).map(preset => <button type="button" key={preset} aria-pressed={camera === preset} disabled={locked || !status?.hasProduct} onClick={() => setView(preset)}><Rotate3D size={17} aria-hidden="true" />{preset === 'three-quarter' ? copy.threeQuarter : preset === 'back' ? copy.backView : copy[preset]}</button>)}</div>
            <div className={styles.motionTools} role="group" aria-label={copy.animation}><span className={styles.toolLabel}>{copy.animation}</span>{(['off','turntable','camera-orbit'] as const).map(mode => <button type="button" key={mode} aria-pressed={animation.mode === mode} disabled={locked} onClick={() => setAnimation(value => ({ ...value, mode, playing: false }))}>{mode === 'off' ? <Circle size={17} aria-hidden="true" /> : <Rotate3D size={17} aria-hidden="true" />}{mode === 'camera-orbit' ? copy.orbit : copy[mode]}</button>)}
              <button type="button" className={styles.playButton} disabled={locked || animation.mode === 'off' || !ready} aria-label={animation.playing ? copy.pause : copy.play} aria-pressed={animation.playing} onClick={() => { setCamera(null); setAnimation(value => ({ ...value, playing: !value.playing })); }}>{animation.playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}</button>
              <label className={styles.speed}>{copy.speed}<select value={animation.speed} disabled={locked || animation.mode === 'off'} onChange={event => setAnimation(value => ({ ...value, speed: Number(event.target.value) }))}>{[0.5,1,1.5,2].map(value => <option key={value} value={value}>{value}×</option>)}</select><ChevronDown size={12} aria-hidden="true" /></label>
            </div>
            <section className={styles.exportPanel} aria-labelledby="mockup-export-title"><div className={styles.exportHeading}><SlidersHorizontal size={17} aria-hidden="true" /><h2 id="mockup-export-title">{copy.export}</h2><span>PNG</span></div><p>{copy.exportCopy}</p>
              <fieldset className={styles.frameChoices} disabled={locked}><legend>{copy.frame}</legend>{frames.map(item => <button key={item.id} type="button" aria-pressed={frame.id === item.id} onClick={() => setFrame(item)}><span className={`${styles.ratioIcon} ${styles[item.id]}`} />{item.text}<small>{copy[item.id]}</small></button>)}</fieldset>
              <fieldset className={styles.resolutionChoices} disabled={locked}><legend>{copy.resolution}</legend>{([1024,2048] as const).map(value => <button key={value} type="button" aria-pressed={resolution === value} onClick={() => setResolution(value)}>{value} px{resolution === value && <Check size={13} aria-hidden="true" />}</button>)}</fieldset>
              {background.type === 'transparent' && <p className={styles.transparentNote}>{copy.transparentCopy}</p>}{downloadButton(styles.downloadButton)}
            </section>
          </div>
        </aside>
      </div>}
    <footer className={styles.footer}><span>VINUT <span aria-hidden="true">·</span> {copy.title}</span>{published && <span>{copy.release} · <time dateTime={published.publishedAt}>{new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(published.publishedAt))}</time></span>}</footer>
  </main>;
}
