'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, CheckCircle2, ChevronRight, CircleHelp, Copy, Droplets, ExternalLink, FileImage, FlaskConical, ImageIcon, Layers3, LayoutDashboard, Leaf, LoaderCircle, LogOut, Menu, Package, Plus, RefreshCw, RotateCcw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AdminSession, CatalogData, CatalogRecord, CollectionName, DeleteRecordHandler, DisplayDraftResult, DisplayDraftSave, Flavor, MediaAsset, MediaRole, ValidationIssue } from '@/lib/catalog/contracts';
import { issueRemedy, type DisplayIssueRemedy } from '@/lib/catalog/issue-remedies';
import { publicUrl } from '@/lib/public-url';
import { CATALOG_REFERENCES } from '@/lib/catalog/validation';
import { MEDIA_ROLE_LABELS, mediaUploadAccept } from '@/lib/catalog/media-roles';
import { resourceConfigurationContext, resourceLocation, type ResourceFilter, type ResourceCollection } from '@/lib/catalog/resources';
import ResourceWorkspace from './resources/ResourceWorkspace';
import { flavorDrinkTypeGroups, flavorMatchesDrinkType, UNCLASSIFIED_FLAVORS } from '@/lib/catalog/flavor-groups';
import { buildProductDetailFilterIndex, productDetailMatchesFilters, productDetailFilterOptions, EMPTY_PRODUCT_DETAIL_FILTERS } from '@/lib/catalog/product-detail-filters';
import ProductDetailFilters from './catalog/ProductDetailFilters';
import { mergeFlavorPoolAsset } from '@/lib/catalog/flavor-pool-library';
import OperationsStatus from './operations/OperationsStatus';
import { BarChart3, ShieldAlert } from 'lucide-react';
import FlavorSymbol from './ui/FlavorSymbol';
import EntityEditor from './catalog/EntityEditor';
import FlavorPoolUploadDialog, { type AddFlavorPoolAsset } from './catalog/FlavorPoolUploadDialog';
import DeleteRecordDialog, { type DeleteRecordTarget } from './ui/DeleteRecordDialog';
import { DisplayEditor } from './display/DisplayWorkspace';
import { definitions, newRecord, recordDetails } from './catalog/definitions';
import { MediaThumbnail } from './ui/MediaPicker';
import { imageUploadHelp, mediaSummary, uploadPendingText } from './ui/upload-info';
import styles from '@/app/admin/admin.module.css';

export type AdminModule = 'dashboard' | 'analytics' | 'security' | 'flavors' | 'productGroups' | 'packaging' | 'drinkTypes' | 'labels' | 'models3d' | 'displays3d' | 'displays2d' | 'publishing' | 'media' | 'icons' | 'productDetails';
export interface WorkspaceHelpers {
  onNavigate: (module: AdminModule) => void;
  onSave: (collection: CollectionName, record: CatalogRecord, expectedRevision: number | null) => Promise<CatalogRecord>;
  onUpload?: (file: File, role: MediaRole) => Promise<MediaAsset>;
  onRefresh?: () => Promise<void> | void;
  onOpenIssue?: (issue: ValidationIssue) => void;
  onSaveDisplay?: (input: DisplayDraftSave) => Promise<DisplayDraftResult>;
}
export interface AdminAppProps {
  initialData?: CatalogData;
  session?: AdminSession | null;
  backendReady: boolean;
  onSave?: WorkspaceHelpers['onSave'];
  onSaveDisplay?: WorkspaceHelpers['onSaveDisplay'];
  onAddFlavorAsset?: AddFlavorPoolAsset;
  onDeleteRecord?: DeleteRecordHandler;
  onArchive?: (collection: CollectionName, id: string, expectedRevision: number) => Promise<void>;
  onUpload?: WorkspaceHelpers['onUpload'];
  onReorder?: (collection: CollectionName, id: string, direction: 'up' | 'down', expectedRevisions: Record<string, number>) => Promise<CatalogData>;
  onRefresh?: WorkspaceHelpers['onRefresh'];
  onSignOut?: () => Promise<void> | void;
  renderWorkspace?: (module: AdminModule, data: CatalogData, helpers: WorkspaceHelpers) => React.ReactNode;
}

const emptyCatalog: CatalogData = { schemaVersion: 1, drinkTypes: [], packagingCategories: [], packagingVariants: [], flavors: [], flavorAssets: [], productGroups: [], productVariants: [], packagingSlots: [], media: [], labels: [], models3d: [], assets2d: [], displays3d: [], displays2d: [], productDetails: [], catalogCollections: [], catalogItems: [] };
const navigation: { group: string; items: { key: AdminModule; label: string; icon: LucideIcon }[] }[] = [
  { group: 'KHÔNG GIAN LÀM VIỆC', items: [{ key: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard }, { key:'analytics', label:'Thống kê truy cập', icon:BarChart3 }, { key:'security', label:'An ninh & log', icon:ShieldAlert }] },
  { group: 'DANH MỤC', items: [{ key: 'productGroups', label: 'Product Display', icon: Layers3 }, { key: 'packaging', label: 'Packaging List', icon: Package }, { key: 'drinkTypes', label: 'Type of Drink', icon: Droplets }, { key: 'flavors', label: 'Flavor Data', icon: Leaf }, { key: 'productDetails', label: 'Product Detail', icon: FileImage }, { key: 'models3d', label: '3D Model', icon: Box }, { key: 'labels', label: 'Label', icon: FileImage }] },
  { group: 'TÀI NGUYÊN', items: [{ key: 'media', label: 'Kho tài nguyên', icon: ImageIcon }] },
  { group: 'HIỂN THỊ & XUẤT BẢN', items: [{ key: 'displays3d', label: '3D Display', icon: Sparkles }, { key: 'displays2d', label: '2D Display', icon: FileImage }, { key: 'publishing', label: 'Phát hành', icon: Upload }] },
];

function referenceCount(data: CatalogData, id: string): number {
  const records = new Set<string>();
  for (const reference of CATALOG_REFERENCES) {
    for (const record of data[reference.collection] ?? []) {
      if ((record as unknown as Record<string, unknown>)[reference.field] === id) records.add(`${reference.collection}:${record.id}`);
    }
  }
  for (const label of data.labels) if (label.compatibilities.some(item => item.packagingVariantId === id)) records.add(`labels:${label.id}`);
  for (const asset of data.assets2d) if (asset.galleryIds.includes(id)) records.add(`assets2d:${asset.id}`);
  return records.size;
}

export default function AdminApp({ initialData, session, backendReady, onSave, onSaveDisplay, onAddFlavorAsset, onArchive, onDeleteRecord, onUpload, onReorder, onRefresh, onSignOut, renderWorkspace }: AdminAppProps) {
  const [catalog, setCatalog] = useState(initialData ?? emptyCatalog);
  const [sourceData, setSourceData] = useState(initialData);
  const [module, setModule] = useState<AdminModule>('dashboard');
  const [subCollection, setSubCollection] = useState<CollectionName | null>(null);
  const [context, setContext] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [category, setCategory] = useState('');
  const [flavorCategory, setFlavorCategory] = useState('');
  const [detailFilters, setDetailFilters] = useState(EMPTY_PRODUCT_DETAIL_FILTERS);
  const detailIndex = useMemo(() => buildProductDetailFilterIndex(catalog), [catalog]);
  const detailFilterOptions = useMemo(() => productDetailFilterOptions(catalog, detailIndex, detailFilters, status as 'active' | 'archived' | 'all'), [catalog, detailIndex, detailFilters, status]);
  const hasDetailFilters = Object.values(detailFilters).some(Boolean);
  const flavorGroups = useMemo(() => flavorDrinkTypeGroups(catalog, status as 'active' | 'archived' | 'all'), [catalog, status]);
  const [page, setPage] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editor, setEditor] = useState<{ collection: CollectionName; record: CatalogRecord; isNew: boolean; initialIssue?: { field: string; message: string } } | null>(null);
  const [deletion, setDeletion] = useState<DeleteRecordTarget | null>(null);
  const [issueDisplay, setIssueDisplay] = useState<DisplayIssueRemedy | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mediaRole, setMediaRole] = useState<MediaRole>('thumbnail');
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>('all');
  const uploadRef = useRef<HTMLInputElement>(null);
  const disabled = !backendReady || !onSave;
  if (sourceData !== initialData) { setSourceData(initialData); setCatalog(initialData ?? emptyCatalog); }

  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get('module') || 'dashboard';
      const location = resourceLocation(requested, params.get('type'));
      if (navigation.some(group => group.items.some(item => item.key === location.module))) {
        setModule(location.module as AdminModule); setDetailFilters(EMPTY_PRODUCT_DETAIL_FILTERS); setFlavorCategory(''); setResourceFilter(location.filter); setSubCollection(null); setContext({}); setQuery(''); setCategory(''); setPage(1); setStatus('active');
        if (requested !== location.module) { const url = new URL(window.location.href); url.searchParams.set('module', location.module); url.searchParams.set('type', location.filter); window.history.replaceState({}, '', url); }
      }
    };
    const timer = window.setTimeout(sync, 0);
    window.addEventListener('popstate', sync);
    return () => { window.clearTimeout(timer); window.removeEventListener('popstate', sync); };
  }, []);

  function navigate(next: AdminModule) {
    const location = resourceLocation(next);
    setModule(location.module as AdminModule); setDetailFilters(EMPTY_PRODUCT_DETAIL_FILTERS); setFlavorCategory(''); setResourceFilter(location.filter); setSubCollection(null); setContext({}); setQuery(''); setCategory(''); setPage(1); setStatus('active'); setSidebarOpen(false); setNotification(null);
    const url = new URL(window.location.href); url.searchParams.set('module', location.module); if (location.filter === 'all') url.searchParams.delete('type'); else url.searchParams.set('type', location.filter); window.history.pushState({}, '', url);
  }
  function selectResourceFilter(filter: ResourceFilter) {
    setResourceFilter(filter);
    const url = new URL(window.location.href); if (filter === 'all') url.searchParams.delete('type'); else url.searchParams.set('type', filter); window.history.pushState({}, '', url);
  }
  function createResource(collection: ResourceCollection, media?: MediaAsset) {
    setEditor({ collection, record: newRecord(collection, media ? resourceConfigurationContext(catalog, collection, media) : {}), isNew: true });
  }
  async function saveRecord(collection: CollectionName, record: CatalogRecord, revision: number | null) {
    if (!backendReady || !onSave) throw new Error('Backend chưa được kết nối. Dữ liệu chưa được lưu.');
    const saved = await onSave(collection, record, revision);
    setCatalog(current => ({ ...current, [collection]: current[collection].some(item => item.id === saved.id) ? current[collection].map(item => item.id === saved.id ? saved : item) : [...current[collection], saved] }));
    setNotification({ type: 'success', message: `Đã lưu bản nháp “${saved.name}”. Catalog công khai chỉ đổi sau khi phát hành.` });
    return saved;
  }
  async function upload(file: File, role: MediaRole) {
    if (!onUpload || !backendReady) throw new Error('Kho lưu trữ chưa được kết nối.');
    const media = await onUpload(file, role);
    setCatalog(current => ({ ...current, media: current.media.some(item => item.id === media.id) ? current.media.map(item => item.id === media.id ? media : item) : [...current.media, media] }));
    return media;
  }
  async function saveDisplay(input: DisplayDraftSave) {
    if (!backendReady || !onSaveDisplay) throw new Error('Backend chưa được kết nối. Cấu hình chưa được lưu.');
    const result = await onSaveDisplay(input);
    setCatalog(result.catalog);
    setNotification({ type: 'success', message: `Đã lưu cấu hình “${result.display.name}” vào bản nháp.` });
    return result;
  }
  async function archiveRecord(collection: CollectionName, record: CatalogRecord) {
    if (!onArchive || !backendReady) return;
    const count = referenceCount(catalog, record.id);
    if (!window.confirm(`Lưu trữ “${record.name}”?${count ? ` Có ${count} bản nháp đang tham chiếu record này. Bạn cần xử lý liên kết trước khi phát hành.` : ''} Bản website đã phát hành được giữ nguyên.`)) return;
    setBusy(record.id);
    try {
      await onArchive(collection, record.id, record.revision);
      setCatalog(current => ({ ...current, [collection]: current[collection].map(item => item.id === record.id && item.revision === record.revision ? { ...item, lifecycle: 'archived', revision: item.revision + 1 } : item) }));
      setNotification({ type: 'success', message: `Đã lưu trữ “${record.name}”.` });
    } catch (cause) { setNotification({ type: 'error', message: cause instanceof Error ? cause.message : 'Không thể lưu trữ. Kiểm tra các liên kết đang sử dụng.' }); }
    finally { setBusy(null); }
  }
  async function reorder(collection: CollectionName, record: CatalogRecord, direction: 'up' | 'down') {
    if (!onReorder || !backendReady) return;
    setBusy(record.id);
    const expectedRevisions = Object.fromEntries(catalog[collection].filter(item => item.lifecycle === 'active').map(item => [item.id, item.revision]));
    try { setCatalog(await onReorder(collection, record.id, direction, expectedRevisions)); }
    catch (cause) { setNotification({ type: 'error', message: cause instanceof Error ? cause.message : 'Không thể đổi thứ tự.' }); }
    finally { setBusy(null); }
  }
  async function restore(collection: CollectionName, record: CatalogRecord) {
    if (!backendReady || !onSave) return;
    setBusy(record.id);
    try { await saveRecord(collection, { ...record, lifecycle: 'active' }, record.revision); }
    catch (cause) { setNotification({ type: 'error', message: cause instanceof Error ? cause.message : 'Không thể khôi phục record.' }); }
    finally { setBusy(null); }
  }
  async function signOut() {
    if (!onSignOut) return;
    setBusy('signout');
    try { await onSignOut(); }
    catch (cause) { setNotification({ type: 'error', message: cause instanceof Error ? cause.message : 'Không thể đăng xuất. Thử lại.' }); }
    finally { setBusy(null); }
  }
  async function refreshCatalog() {
    if (!onRefresh) return;
    setBusy('refresh');
    try { await onRefresh(); setNotification(null); }
    catch (cause) { setNotification({ type: 'error', message: cause instanceof Error ? cause.message : 'Không thể tải danh mục mới. Bản dữ liệu hiện tại được giữ lại.' }); }
    finally { setBusy(null); }
  }

  const collection: CollectionName | null = subCollection ?? ({ flavors: 'flavors', productGroups: 'productGroups', packaging: 'packagingVariants', drinkTypes: 'drinkTypes', productDetails: 'productDetails', labels: 'labels', models3d: 'models3d', media: 'media', icons: 'media' } as Partial<Record<AdminModule, CollectionName>>)[module] ?? null;
  const definition = collection ? definitions[collection] : null;
  const title = module === 'media' && !subCollection ? 'Kho tài nguyên' : definition?.title ?? navigation.flatMap(group => group.items).find(item => item.key === module)?.label ?? 'Tổng quan';
  const records = collection ? (catalog[collection] ?? []).filter(record => {
    const details = recordDetails(collection, record, catalog);
    const value = record as unknown as Record<string, unknown>;
    return (module !== 'icons' || value.role === 'icon') && (status === 'all' || record.lifecycle === status) && `${record.name} ${record.slug} ${details}`.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')) && Object.entries(context).every(([key, expected]) => value[key] === expected) && (!category || value.categoryId === category) && (collection !== 'flavors' || flavorMatchesDrinkType(flavorGroups.memberships, record.id, flavorCategory)) && (collection !== 'productDetails' || productDetailMatchesFilters(detailIndex, record.id, detailFilters));
  }).sort((a, b) => ('position' in a && 'position' in b ? Number(a.position) - Number(b.position) : 0) || a.name.localeCompare(b.name, 'vi')) : [];
  const pageCount = Math.max(1, Math.ceil(records.length / 20));
  const currentPage = Math.min(page, pageCount);
  const pagedRecords = records.slice((currentPage - 1) * 20, currentPage * 20);
  const active = (name: CollectionName) => (catalog[name] ?? []).filter(item => item.lifecycle === 'active').length;
  const mediaFor = (record: CatalogRecord) => {
    const value = record as unknown as Record<string, unknown>;
    return catalog.media.find(item => item.id === (value.thumbnailId ?? value.posterId ?? value.mediaId));
  };
  function create() {
    if (!collection || collection === 'media') return;
    if (collection === 'flavorAssets' && !catalog.flavors.some(item => item.id === context.flavorId && item.lifecycle === 'active')) { setNotification({ type: 'error', message: 'Mở Pool ảnh của một hương vị đang hoạt động để thêm ảnh.' }); return; }
    const hasPosition = definitions[collection]?.fields.some(field => field.key === 'position');
    const nextPosition = (catalog[collection] ?? []).filter(item => 'position' in item && Object.entries(context).every(([key, value]) => (item as unknown as Record<string, unknown>)[key] === value)).reduce((max, item) => Math.max(max, Number((item as unknown as { position: number }).position)), -1) + 1;
    setEditor({ collection, record: newRecord(collection, { ...context, ...(hasPosition ? { position: nextPosition } : {}), ...(category && collection === 'packagingVariants' ? { categoryId: category } : {}) }), isNew: true });
  }
  function related(next: CollectionName, filters: Record<string, string>) {
    setSubCollection(next); setContext(filters); setQuery(''); setCategory(''); setPage(1); setStatus('active'); setNotification(null);
  }
  function duplicate(record: CatalogRecord) {
    if (!collection) return;
    const copy = newRecord(collection, { ...record, id: crypto.randomUUID(), name: `${record.name} · bản sao`, slug: `${record.slug}-copy-${Date.now().toString(36)}`, revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lifecycle: 'active' });
    setEditor({ collection, record: copy, isNew: true });
  }

  function openIssue(issue: ValidationIssue) {
    const remedy = issueRemedy(catalog, issue);
    if (!remedy) return;
    if (remedy.kind === 'display') { setIssueDisplay(remedy); return; }
    const record = catalog[remedy.collection].find(item => item.id === remedy.recordId);
    if (record) setEditor({ collection: remedy.collection, record, isNew: false, initialIssue: { field: remedy.field, message: remedy.message } });
  }
  const workspace = module === 'media' && !subCollection ? <ResourceWorkspace catalog={catalog} filter={resourceFilter} onFilter={selectResourceFilter} disabled={disabled} busy={busy}
    onEdit={(collection, record) => setEditor({ collection, record, isNew: false })} onCreate={createResource}
    onDelete={backendReady && onDeleteRecord ? setDeletion : undefined} onArchive={backendReady && onArchive ? archiveRecord : undefined} onRestore={restore}
    onUpload={backendReady && onUpload ? upload : undefined} onRefresh={onRefresh ? refreshCatalog : undefined} /> : renderWorkspace?.(module, catalog, { onNavigate:navigate, onSave: saveRecord, onSaveDisplay: onSaveDisplay ? saveDisplay : undefined, onUpload: onUpload ? upload : undefined, onRefresh, onOpenIssue: openIssue });
  const poolFlavor = editor && 'flavorId' in editor.record ? catalog.flavors.find(flavor => flavor.id === ('flavorId' in editor.record ? editor.record.flavorId : '')) : undefined;
  return <div className={styles.adminShell}>
    <a href="#admin-main" className={styles.skipLink}>Đến nội dung quản trị</a>
    {sidebarOpen && <button className={styles.sidebarScrim} aria-label="Đóng menu" onClick={() => setSidebarOpen(false)} />}
    <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpened : ''}`} aria-label="Menu quản trị">
      <div className={styles.brand}><span className={styles.brandSymbol}><Leaf size={24} /></span><div><strong>VINUT</strong><span>PRODUCT STUDIO</span></div><button className={`${styles.iconButton} ${styles.mobileOnly}`} aria-label="Đóng menu" onClick={() => setSidebarOpen(false)}><X size={20} /></button></div>
      <div className={styles.workspaceLabel}><span className={styles.statusDot} /> Quản trị sản phẩm <span>V1</span></div>
      <nav>{navigation.map(group => <div className={styles.navGroup} key={group.group}><p>{group.group}</p>{group.items.map(item => <button key={item.key} className={`${styles.navItem} ${module === item.key ? styles.navActive : ''}`} aria-current={module === item.key ? 'page' : undefined} onClick={() => navigate(item.key)}><item.icon size={19} /><span>{item.label}</span>{item.key === 'productGroups' && active('productGroups') > 0 && <small>{active('productGroups')}</small>}</button>)}</div>)}</nav>
      <div className={styles.sidebarBottom}><div className={styles.helpCard}><CircleHelp size={19} /><div><strong>Từ dữ liệu đến website</strong><p>Lưu nháp → xem trước → phát hành.</p></div></div><a href={publicUrl('/')} className={styles.websiteLink} target="_blank" rel="noreferrer"><ExternalLink size={17} /> Mở trang chính <ArrowRight size={16} /></a></div>
    </aside>
    <div className={styles.mainShell}>
      <header className={styles.topbar}><div className={styles.breadcrumb}><button className={`${styles.iconButton} ${styles.mobileOnly}`} aria-label="Mở menu quản trị" onClick={() => setSidebarOpen(true)}><Menu size={21} /></button><span>Product Studio</span><ChevronRight size={14} /><strong>{title}</strong></div><div className={styles.topbarActions}>{backendReady && <OperationsStatus onOpen={() => navigate('security')} />}<span className={styles.avatar}>{session?.email.slice(0, 1).toUpperCase() ?? 'V'}</span><div className={styles.userInfo}><strong>{session?.email ?? 'Chưa kết nối tài khoản'}</strong><small>{session?.role === 'owner' ? 'Chủ quản trị' : session?.role === 'editor' ? 'Biên tập viên' : 'Chờ thiết lập'}</small></div>{onSignOut && <button type="button" className={styles.iconButton} aria-label="Đăng xuất" disabled={busy === 'signout'} onClick={() => void signOut()}><LogOut size={18} /></button>}</div></header>
      <main className={styles.main} id="admin-main">
        {!backendReady && <div className={styles.setupNotice} role="status"><div className={styles.setupIcon}><Settings2 size={24} /></div><div><strong>Đang chờ kết nối backend</strong><p>Giao diện quản trị đã sẵn sàng để thiết lập. Cần kết nối API, tài khoản và kho lưu trữ trước khi nhập, upload hoặc phát hành dữ liệu.</p></div><span className={styles.pendingBadge}>Chưa thể lưu</span></div>}
        {notification && <div className={notification.type === 'error' ? styles.errorBanner : styles.successBanner} role={notification.type === 'error' ? 'alert' : 'status'}><span>{notification.message}</span><button className={styles.iconButton} aria-label="Đóng thông báo" onClick={() => setNotification(null)}><X size={17} /></button></div>}
        {module === 'dashboard' ? <>
          <div className={styles.pageHeading}><div><p className={styles.eyebrow}>DỮ LIỆU · TÀI NGUYÊN · HIỂN THỊ</p><h1>Tổng quan website</h1><p>Theo dõi truy cập, an ninh và quản lý trải nghiệm sản phẩm.</p></div><button className={styles.primaryButton} onClick={() => navigate('productGroups')}><Plus size={18} /> Quản lý dòng sản phẩm</button></div>
          {workspace}
          <div className={styles.statsGrid}>{([{ label: 'Dòng sản phẩm', collection: 'productGroups', icon: Layers3, target: 'productGroups', detail: `${catalog.productGroups.filter(item => item.lifecycle === 'active' && item.visible).length} dòng bật hiển thị` }, { label: 'Hương vị', collection: 'flavors', icon: Leaf, target: 'flavors', detail: `${active('flavorAssets')} ảnh trang trí` }, { label: 'Model 3D', collection: 'models3d', icon: Box, target: 'models3d', detail: `${active('packagingVariants')} quy cách bao bì` }, { label: 'Artwork nhãn', collection: 'labels', icon: FileImage, target: 'labels', detail: 'Tương thích theo UV profile' }] as const).map(card => <button key={card.collection} className={styles.statCard} onClick={() => navigate(card.target)}><div><span>{card.label}</span><card.icon size={20} /></div><strong>{active(card.collection).toString().padStart(2, '0')}</strong><small>{card.detail}<ArrowRight size={15} /></small></button>)}</div>
          <div className={styles.dashboardGrid}><section className={styles.workflowCard}><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>QUY TRÌNH VẬN HÀNH</p><h2>Tạo một trải nghiệm sản phẩm</h2></div><span className={styles.softBadge}>5 bước</span></div>{([{ title: 'Chuẩn bị danh mục', copy: 'Loại nước, quy cách bao bì và bộ hương vị.', icon: FlaskConical, target: 'drinkTypes' }, { title: 'Thêm nhãn & mô hình', copy: 'Artwork và GLB có cùng bao bì, layout profile.', icon: Box, target: 'models3d' }, { title: 'Tạo dòng & sắp xếp button', copy: 'Tên dòng riêng, slot bao bì theo thứ tự mong muốn.', icon: Layers3, target: 'productGroups' }, { title: 'Ghép cấu hình 3D / 2D', copy: 'Chọn tổ hợp và xem trước giao diện sản phẩm.', icon: Sparkles, target: 'displays3d' }, { title: 'Kiểm tra & phát hành', copy: 'Chỉ bản phát hành hoàn chỉnh xuất hiện trên website.', icon: ShieldCheck, target: 'publishing' }] as const).map((step, index) => <button key={step.title} className={styles.workflowStep} onClick={() => navigate(step.target)}><span className={styles.stepNumber}>{index + 1}</span><step.icon size={20} /><div><strong>{step.title}</strong><p>{step.copy}</p></div><ChevronRight size={17} /></button>)}</section><div className={styles.dashboardSide}><section className={styles.readinessCard}><div className={styles.sectionHeading}><h2>Trạng thái tài nguyên</h2><CheckCircle2 size={20} /></div><div className={styles.readinessTotal}><strong>{catalog.media.filter(item => item.lifecycle === 'active' && item.status === 'ready').length}</strong><span>file sẵn sàng sử dụng</span></div><div className={styles.readinessRow}><span>Đang xử lý</span><strong>{catalog.media.filter(item => item.status === 'processing' || item.status === 'uploaded').length}</strong></div><div className={styles.readinessRow}><span>Cần kiểm tra lại</span><strong>{catalog.media.filter(item => item.status === 'failed').length}</strong></div><button className={styles.textButton} onClick={() => navigate('media')}>Mở kho tài nguyên <ArrowRight size={16} /></button></section><section className={styles.guidanceCard}><span className={styles.guidanceIcon}><Leaf size={25} /></span><h2>Một hương vị, nhiều trải nghiệm</h2><p>Màu nền, icon và ảnh trái cây / lá / splash / đá viên được quản lý trong Flavor Data, dùng lại cho mọi bao bì.</p><button className={styles.textButton} onClick={() => navigate('flavors')}>Xây dựng bộ Flavor <ArrowRight size={16} /></button></section></div></div>
        </> : workspace ?? (collection ? <>
          <div className={styles.pageHeading}><div>{subCollection && <button className={styles.textButton} onClick={() => { setSubCollection(null); setContext({}); setCategory(''); setPage(1); setStatus('active'); }}><ArrowLeft size={16} /> Quay lại {navigation.flatMap(group => group.items).find(item => item.key === module)?.label}</button>}<p className={styles.eyebrow}>{collection === 'media' ? 'TÀI NGUYÊN DÙNG CHUNG' : 'QUẢN LÝ DỮ LIỆU'}</p><h1>{title}</h1><p>{definition?.description ?? (module === 'icons' ? 'Biểu tượng ảnh và SVG dùng chung cho nền website và Flavor Data. Tải một lần, chọn lại trong nhiều hương vị.' : 'File ảnh và mô hình được kiểm tra trước khi dùng trong cấu hình hiển thị.')}</p></div><div className={styles.headingActions}>{onRefresh && <button type="button" className={styles.iconButton} aria-label="Tải lại danh mục" disabled={!backendReady || busy === 'refresh'} onClick={() => void refreshCatalog()}><RefreshCw size={18} className={busy === 'refresh' ? styles.spin : undefined} /></button>}{module === 'packaging' && !subCollection && <button className={styles.secondaryButton} onClick={() => related('packagingCategories', {})}>Quản lý nhóm</button>}{collection === 'media' ? <button className={styles.primaryButton} disabled={!backendReady || !onUpload || busy === 'upload'} onClick={() => uploadRef.current?.click()}>{busy === 'upload' ? <LoaderCircle size={17} className={styles.spin} /> : <Upload size={17} />} {busy === 'upload' ? uploadPendingText(mediaRole) : 'Tải file mới'}</button> : <button className={styles.primaryButton} disabled={disabled} onClick={create}><Plus size={18} /> Thêm {definition?.singular}</button>}</div></div>
          {collection === 'productDetails' && <ProductDetailFilters value={detailFilters} options={detailFilterOptions} active={hasDetailFilters || !!query || status !== 'active'} onChange={value => { setDetailFilters(value); setPage(1); }} onClear={() => { setDetailFilters(EMPTY_PRODUCT_DETAIL_FILTERS); setQuery(''); setStatus('active'); setPage(1); }} />}
          {collection === 'flavors' && <div className={styles.flavorGrouping}>
            <div className={styles.categoryTabs} role="group" aria-label="Lọc hương vị theo loại nước">
              <button type="button" aria-pressed={!flavorCategory} className={!flavorCategory ? styles.categoryActive : ''} onClick={() => { setFlavorCategory(''); setPage(1); }}>Tất cả hương vị <span>{flavorGroups.total}</span></button>
              {flavorGroups.groups.filter(group => group.count > 0 || group.id === flavorCategory).map(group => <button key={group.id} type="button" aria-pressed={flavorCategory === group.id} className={flavorCategory === group.id ? styles.categoryActive : ''} onClick={() => { setFlavorCategory(group.id); setPage(1); }}>{group.name}<span>{group.count}</span></button>)}
            </div>
            <p>Phân nhóm tự động theo loại nước của nhãn và sản phẩm liên kết. Hương dùng chung xuất hiện trong các nhóm tương ứng.</p>
          </div>}
          {module === 'packaging' && collection === 'packagingVariants' && <div className={styles.categoryTabs}><button className={!category ? styles.categoryActive : ''} onClick={() => setCategory('')}>Tất cả bao bì <span>{active('packagingVariants')}</span></button>{catalog.packagingCategories.filter(item => item.lifecycle === 'active').sort((a, b) => a.position - b.position).map(item => <button key={item.id} className={category === item.id ? styles.categoryActive : ''} onClick={() => setCategory(item.id)}>{item.name}<span>{catalog.packagingVariants.filter(variant => variant.categoryId === item.id && variant.lifecycle === 'active').length}</span></button>)}</div>}
          {context.groupId && <div className={styles.contextBanner}><Layers3 size={18} /><span>Dòng sản phẩm: <strong>{catalog.productGroups.find(item => item.id === context.groupId)?.name}</strong></span><p>Thứ tự từ trái sang phải, sau đó trên xuống dưới.</p></div>}
          {context.flavorId && <div className={styles.contextBanner}><Leaf size={18} /><span>Pool ảnh của <strong>{catalog.flavors.find(item => item.id === context.flavorId)?.name}</strong></span><p>Chỉ ảnh đúng vai trò được bốc ngẫu nhiên.</p></div>}
          <section className={styles.dataPanel}>{collection === 'media' && <div className={styles.uploadPolicy}><p>{imageUploadHelp(mediaRole)}</p>{busy === 'upload' && <p role="status">{uploadPendingText(mediaRole)} Chỉ báo thành công sau khi kiểm tra và lưu xong.</p>}</div>}<div className={styles.tableToolbar}><label className={styles.search}><Search size={18} /><input aria-label={`Tìm ${title}`} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Tìm theo tên, mã hoặc thông tin…" /></label><div className={styles.filterControls}><SlidersHorizontal size={17} /><label className={styles.visuallyHidden} htmlFor="lifecycle-filter">Lọc trạng thái</label><select id="lifecycle-filter" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="active">Đang sử dụng</option><option value="archived">Đã lưu trữ</option><option value="all">Tất cả trạng thái</option></select>{collection === 'media' && module !== 'icons' && <><label className={styles.visuallyHidden} htmlFor="upload-role">Loại file mới</label><select id="upload-role" disabled={busy === 'upload'} value={mediaRole} onChange={event => setMediaRole(event.target.value as MediaRole)}>{[{ key: 'thumbnail', label: 'Ảnh đại diện' }, { key: 'icon', label: 'Icon' }, { key: 'fruit', label: 'Trái cây' }, { key: 'leaf', label: 'Lá cây' }, { key: 'splash', label: 'Splash' }, { key: 'ice', label: 'Đá viên' }, { key: 'label', label: 'Artwork nhãn' }, { key: 'model', label: 'GLB model' }, { key: 'poster', label: 'Poster' }, { key: 'image-2d', label: 'Hình bao bì 2D' }].map(role => <option key={role.key} value={role.key}>{role.label}</option>)}</select></>}<span className={styles.resultCount}>{records.length} mục</span></div></div>
          {records.length ? <div className={styles.tableScroller}><table className={styles.dataTable}><thead><tr><th>TÊN / THÔNG TIN</th><th>{collection === 'media' ? 'TRẠNG THÁI FILE' : 'THỨ TỰ'}</th><th>PHIÊN BẢN</th><th>TRẠNG THÁI</th><th><span className={styles.visuallyHidden}>Thao tác</span></th></tr></thead><tbody>{pagedRecords.map(record => { const value = record as unknown as Record<string, unknown>; return <tr key={record.id}><td><div className={styles.recordIdentity}>{collection === 'flavors' ? <span className={styles.flavorSwatch} style={{ background: String(value.backgroundColor), color: String(value.textColor) }}><FlavorSymbol data={catalog} flavor={record as Flavor} color={String(value.textColor)} /></span> : <MediaThumbnail media={collection === 'media' ? record as MediaAsset : mediaFor(record)} />}<div><button className={styles.recordName} disabled={collection === 'media'} onClick={() => setEditor({ collection, record, isNew: false })}>{record.name}</button>{collection === 'flavors' && <div className={styles.flavorTypeBadges}>{flavorGroups.groups.filter(group => group.id === UNCLASSIFIED_FLAVORS ? !flavorGroups.memberships.get(record.id)?.size : flavorGroups.memberships.get(record.id)?.has(group.id)).map(group => <span key={group.id}>{group.name}</span>)}</div>}<small>{collection === 'media' ? `${MEDIA_ROLE_LABELS[(record as MediaAsset).role]} · ${mediaSummary(record as MediaAsset)}` : recordDetails(collection, record, catalog)}</small><span className={styles.recordSlug}>{record.slug} · {referenceCount(catalog, record.id)} liên kết</span></div></div></td><td>{collection === 'media' ? <span className={`${styles.statusBadge} ${(record as MediaAsset).status === 'ready' ? styles.statusActive : (record as MediaAsset).status === 'failed' ? styles.statusFailed : styles.statusPending}`}>{(record as MediaAsset).status === 'ready' ? 'Sẵn sàng' : (record as MediaAsset).status === 'failed' ? 'Thất bại' : 'Đang xử lý'}</span> : typeof value.position === 'number' ? <div className={styles.orderControls}><span>{value.position}</span><button type="button" className={styles.iconButton} disabled={!onReorder || disabled || busy === record.id} aria-label={`Đưa ${record.name} lên trước`} onClick={() => void reorder(collection, record, 'up')}><ArrowUp size={15} /></button><button type="button" className={styles.iconButton} disabled={!onReorder || disabled || busy === record.id} aria-label={`Đưa ${record.name} xuống sau`} onClick={() => void reorder(collection, record, 'down')}><ArrowDown size={15} /></button></div> : <span className={styles.muted}>—</span>}</td><td><span className={styles.revision}>r{record.revision}</span><small className={styles.updatedAt}>{new Date(record.updatedAt).toLocaleDateString('vi-VN')}</small></td><td><span className={`${styles.statusBadge} ${record.lifecycle === 'active' ? styles.statusActive : styles.statusArchived}`}><span />{record.lifecycle === 'active' ? 'Đang dùng' : 'Đã lưu trữ'}</span></td><td><div className={styles.rowActions}>{onDeleteRecord && <button type="button" className={`${styles.smallButton} ${styles.deleteButton}`} disabled={!backendReady || !!busy} aria-label={`Xóa ${record.name}`} onClick={() => setDeletion({ collection, id: record.id })}><Trash2 size={15} aria-hidden="true" />Xóa</button>}{collection === 'productGroups' && <button className={styles.smallButton} onClick={() => related('packagingSlots', { groupId: record.id })}>Slot bao bì <ChevronRight size={13} /></button>}{collection === 'flavors' && <button className={styles.smallButton} onClick={() => related('flavorAssets', { flavorId: record.id })}>Pool ảnh <ChevronRight size={13} /></button>}{collection !== 'media' && collection !== 'flavorAssets' && <button className={styles.iconButton} disabled={disabled} aria-label={`Nhân bản ${record.name}`} onClick={() => duplicate(record)}><Copy size={16} /></button>}<button className={styles.iconButton} disabled={!onArchive || !backendReady || record.lifecycle === 'archived' || busy === record.id} aria-label={`Lưu trữ ${record.name}`} onClick={() => void archiveRecord(collection, record)}>{busy === record.id ? <LoaderCircle size={16} className={styles.spin} /> : <Archive size={16} />}</button>{record.lifecycle === 'archived' && <button className={styles.iconButton} disabled={disabled || busy === record.id} aria-label={`Khôi phục ${record.name}`} onClick={() => void restore(collection, record)}><RotateCcw size={16} /></button>}</div></td></tr>; })}</tbody></table></div> : <div className={styles.emptyState}><div className={styles.emptyIcon}>{collection === 'media' ? <ImageIcon size={30} /> : <Package size={30} />}</div><h2>{query || status !== 'active' || (collection === 'flavors' && flavorCategory) || (collection === 'productDetails' && hasDetailFilters) ? 'Không có kết quả phù hợp' : `Chưa có ${definition?.singular ?? 'tài nguyên'}`}</h2><p>{query || (collection === 'productDetails' && hasDetailFilters) ? 'Thử từ khóa khác hoặc xóa bộ lọc.' : backendReady ? 'Tạo dữ liệu đầu tiên hoặc chọn danh mục khác để tiếp tục.' : 'Kết nối backend để tải danh mục và bắt đầu làm việc.'}</p>{(query || (collection === 'flavors' && flavorCategory) || (collection === 'productDetails' && hasDetailFilters)) && <button className={styles.secondaryButton} onClick={() => { setQuery(''); setStatus('active'); setFlavorCategory(''); setDetailFilters(EMPTY_PRODUCT_DETAIL_FILTERS); setPage(1); }}>Xóa bộ lọc</button>}{!query && collection !== 'media' && <button className={styles.primaryButton} disabled={disabled} onClick={create}><Plus size={16} /> Thêm {definition?.singular}</button>}</div>}
          <div className={styles.tableFooter}><span><ShieldCheck size={15} /> Dữ liệu đang ở không gian nháp</span><div className={styles.pagination}><span>{records.length ? `${(currentPage - 1) * 20 + 1}–${Math.min(currentPage * 20, records.length)} / ${records.length}` : '0 mục'}</span><button className={styles.iconButton} aria-label="Trang trước" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ArrowLeft size={16} /></button><span>Trang {currentPage}/{pageCount}</span><button className={styles.iconButton} aria-label="Trang sau" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}><ArrowRight size={16} /></button></div></div></section>
          <input ref={uploadRef} type="file" className={styles.visuallyHidden} accept={mediaUploadAccept(mediaRole)} onChange={event => { const file = event.target.files?.[0]; if (!file) return; setBusy('upload'); void upload(file, mediaRole).then(media => setNotification({ type: 'success', message: media.status === 'ready' ? `Đã lưu “${media.name}”: ${mediaSummary(media)}.` : `Đã gửi “${media.name}”. File đang chờ xử lý.` })).catch(cause => setNotification({ type: 'error', message: cause instanceof Error ? cause.message : 'Upload thất bại.' })).finally(() => { setBusy(null); if (uploadRef.current) uploadRef.current.value = ''; }); }} />
        </> : <div className={styles.emptyState}><Sparkles size={36} /><h1>{title}</h1><p>{backendReady ? 'Không gian làm việc này đang được tích hợp.' : 'Kết nối backend để ghép, xem trước và phát hành sản phẩm.'}</p></div>)}
        <footer className={styles.pageFooter}><span>VINUT Product Studio</span><span>Danh mục có cấu trúc · Tài nguyên dùng chung · Phát hành có kiểm tra</span></footer>
      </main>
    </div>
    {deletion && onDeleteRecord && <DeleteRecordDialog key={`${deletion.collection}:${deletion.id}`} catalog={catalog} target={deletion} onDelete={onDeleteRecord} onClose={() => setDeletion(null)} onDeleted={(result, name) => { setCatalog(result.catalog); setNotification({ type: 'success', message: `Đã gỡ “${name}” khỏi bản nháp. ${result.issues.some(issue => issue.severity === 'error') ? 'Kiểm tra dữ liệu trong mục Phát hành để bổ sung phần còn thiếu.' : 'Bản đã phát hành được giữ nguyên.'}` }); }} />}
    {editor && (editor.collection === 'flavorAssets' && editor.isNew && onAddFlavorAsset && onUpload && poolFlavor ? <FlavorPoolUploadDialog key={editor.record.id} flavor={poolFlavor} data={catalog} onUpload={upload} onAdd={async input => {
      const saved = await onAddFlavorAsset(input);
      setCatalog(current => mergeFlavorPoolAsset(current, saved));
      return saved;
    }} onClose={() => setEditor(null)} /> : <EntityEditor key={`${editor.collection}:${editor.record.id}`} {...editor} data={catalog} disabled={disabled} onClose={() => setEditor(null)} onSave={saveRecord} onUpload={onUpload ? upload : undefined} />)}
    {issueDisplay && <DisplayEditor catalog={catalog} mode={issueDisplay.mode} selectedId={issueDisplay.displayId} initialVariantId={issueDisplay.variantId} focusField={issueDisplay.field} issueMessage={issueDisplay.message} onSave={saveRecord} onSaveDisplay={onSaveDisplay ? saveDisplay : undefined} onUpload={upload} onRefresh={onRefresh || (() => {})} onClose={() => setIssueDisplay(null)} onSaved={() => setIssueDisplay(null)} />}
  </div>;
}
