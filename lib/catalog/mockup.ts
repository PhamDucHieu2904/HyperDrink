import type { CatalogData, Display3D, Label, MediaAsset, Model3D } from './contracts';
import type { ProductAppearance, ProductAsset } from '@/lib/viewer-config';
import { checkDisplay3DCompatibility, checkModelLabelCompatibility, collectSalesCatalogRoots } from './compatibility';
import { resolveLabelAppearance, resolveModelAsset } from './resolve';

export interface MockupLibrary { models: Model3D[]; labels: Label[]; displays: Display3D[] }
export interface MockupQuery { display?: string | null; model?: string | null; label?: string | null }
export type MockupSelectionWarning = 'unavailable-display' | 'unavailable-model' | 'unavailable-label' | 'incompatible-label';
export interface MockupSelection { model: Model3D | null; label: Label | null; display: Display3D | null; warning: MockupSelectionWarning | null }
const order = <T extends Model3D | Label>(a: T, b: T) => (a.mockupPosition ?? 0) - (b.mockupPosition ?? 0) || a.id.localeCompare(b.id);
const readyMedia = (data: CatalogData, id: string | null, role: MediaAsset['role']) => data.media.find(item => item.id === id && item.lifecycle === 'active' && item.status === 'ready' && item.role === role && !!item.url && (role === 'model' ? item.mime === 'model/gltf-binary' : ['image/png', 'image/webp', 'image/jpeg'].includes(item.mime)));

/** The only permission selector for cards, presets, hero context and URL IDs.
 * Existence in an expanded release is never permission for a legacy record. */
export function getMockupLibrary(data: CatalogData): MockupLibrary {
  const sales = collectSalesCatalogRoots(data);
  const salesModelIds = new Set(sales.displays3d.map(item => item.modelId));
  const salesLabelIds = new Set(sales.displays3d.map(item => item.labelId));
  const visible = (item: Model3D | Label, ids: Set<string | null>) => item.lifecycle === 'active' && (item.mockupVisible === true || item.mockupVisible === undefined && ids.has(item.id));
  const models = data.models3d.filter(model => {
    if (!visible(model, salesModelIds) || !readyMedia(data, model.mediaId, 'model') || !readyMedia(data, model.posterId, 'poster') || !model.layoutProfile.trim() || !model.materialSlots.label?.length || model.materialSlots.label.some(name => !name.trim())) return false;
    const packaging = data.packagingVariants.find(item => item.id === model.packagingVariantId && item.lifecycle === 'active');
    return !!packaging && data.packagingCategories.some(item => item.id === packaging.categoryId && item.lifecycle === 'active');
  }).sort(order);
  const labels = data.labels.filter(label => visible(label, salesLabelIds) && !!readyMedia(data, label.mediaId, 'label') && data.drinkTypes.some(item => item.id === label.drinkTypeId && item.lifecycle === 'active') && (!label.flavorId || data.flavors.some(item => item.id === label.flavorId && item.lifecycle === 'active')) && label.compatibilities.some(entry => !!entry.layoutProfile.trim() && data.packagingVariants.some(item => item.id === entry.packagingVariantId && item.lifecycle === 'active'))).sort(order);
  const modelIds = new Set(models.map(item => item.id));
  const labelIds = new Set(labels.map(item => item.id));
  const displays = sales.displays3d.filter(display => !!display.modelId && !!display.labelId && modelIds.has(display.modelId) && labelIds.has(display.labelId) && checkDisplay3DCompatibility(data, display).length === 0).sort((a, b) => a.id.localeCompare(b.id));
  return { models, labels, displays };
}

export function getCompatibleMockupLabels(data: CatalogData, modelId: string): Label[] {
  const library = getMockupLibrary(data);
  const model = library.models.find(item => item.id === modelId);
  return model ? library.labels.filter(label => checkModelLabelCompatibility(data, model, label).length === 0) : [];
}

/** Invalid links retain a useful permitted scene and an explicit reason to choose again. */
export function resolveMockupSelection(data: CatalogData, query: MockupQuery = {}): MockupSelection {
  const library = getMockupLibrary(data);
  const fromDisplay = (display: Display3D): MockupSelection => ({ model: library.models.find(item => item.id === display.modelId) ?? null, label: library.labels.find(item => item.id === display.labelId) ?? null, display, warning: null });
  const fallback = library.displays[0] ? fromDisplay(library.displays[0]) : { model: library.models[0] ?? null, label: null, display: null, warning: null };
  if (query.display) {
    const display = library.displays.find(item => item.id === query.display);
    return display ? fromDisplay(display) : { ...fallback, warning: 'unavailable-display' };
  }
  if (query.model) {
    const model = library.models.find(item => item.id === query.model);
    if (!model) return { ...fallback, warning: 'unavailable-model' };
    const label = query.label ? library.labels.find(item => item.id === query.label) : undefined;
    if (query.label && !label) return { model, label: null, display: null, warning: 'unavailable-label' };
    if (label && checkModelLabelCompatibility(data, model, label).length) return { model, label: null, display: null, warning: 'incompatible-label' };
    const display = label ? library.displays.find(item => item.modelId === model.id && item.labelId === label.id) ?? null : null;
    return { model, label: label ?? null, display, warning: null };
  }
  if (query.label) return { ...fallback, warning: 'unavailable-model' };
  return fallback;
}

/** No SKU creation: the existing media/material resolver supplies a free pairing.
 * Resolve again through IDs so callers cannot pass hidden/stale record objects. */
export function resolveMockupProduct(data: CatalogData, selection: Pick<MockupSelection, 'model' | 'label'>): { asset: ProductAsset; appearance: ProductAppearance } | null {
  if (!selection.model) return null;
  const resolved = resolveMockupSelection(data, { model: selection.model.id, label: selection.label?.id });
  if (resolved.warning || !resolved.model) return null;
  const asset = resolveModelAsset(data, resolved.model);
  const appearance = resolved.label ? resolveLabelAppearance(data, resolved.label) : { id: `mockup-bare:${resolved.model.id}:${resolved.model.revision}`, slots: {} };
  return asset && appearance ? { asset, appearance } : null;
}
