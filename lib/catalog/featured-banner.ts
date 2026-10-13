import type { CatalogData, MediaAsset } from './contracts';
import type { CollectionSection } from './collection';
import type { StorefrontProduct } from './storefront';
import { mediaUrl } from './resolve';
import { publicUrl } from '../public-url';

// Still renders exported from Studio. Match the artwork revision before reusing a render.
const portraits = [
  ['guava', '#fbd8dd', 'b03af0b4ed4e78fa17a062549b457b228a7c7cc162e48e045c3c98a91d7060ce'],
  ['mango', '#ffe3aa', '98f1ec5cb7f5127020ee29e078e6456cc1f782a021e7d51430c17450214dbb59'],
  ['strawberry', '#ffd2dd', '9e04af4fb6f39ce8235a50da63048a2d75a10846c961e80178bfc0179ce510ce'],
  ['passion-fruit', '#f2dcf1', '1902b6c71ce13dca692a50fe5de8f0dae88bcd3ceb88d428680853ff4b1cb225'],
  ['pineapple', '#f5edb3', 'f75c9fb4aa44714a15ac127b3ba09cb685ecba852bcb7f03dcf319c3aab59376'],
] as const;

export interface FeaturedSlide {
  product: StorefrontProduct;
  image: string;
  cutout: boolean;
  color: string;
  fruit: MediaAsset[];
  leaves: MediaAsset[];
  ice?: MediaAsset;
  href: string;
}

/** Only promote products in collections the admin has made visible on the homepage. */
export function featuredBannerSlides(catalog: CatalogData, sections: CollectionSection[]): FeaturedSlide[] {
  const products = sections.flatMap(section => section.products);
  const preferred = portraits.flatMap(([flavor]) => products.filter(product => product.label?.id === `juice30-can330-${flavor}-label`).slice(0, 1));
  const ordered = [...preferred, ...products.filter(product => !preferred.includes(product))];
  const seen = new Set<string>();
  return ordered.flatMap(product => {
    if (seen.has(product.flavor.id)) return [];
    const artwork = catalog.media.find(media => media.id === product.label?.mediaId);
    const portrait = portraits.find(([flavor, , hash]) => product.label?.id === `juice30-can330-${flavor}-label` && artwork?.sha256 === hash);
    const image = portrait ? publicUrl(`/assets/featured/${portrait[0]}-can.webp`) : mediaUrl(product.image2d);
    if (!image) return [];
    seen.add(product.flavor.id);
    const pool = (role: 'fruit' | 'leaf' | 'ice') => catalog.flavorAssets
      .filter(asset => asset.flavorId === product.flavor.id && asset.role === role && asset.enabled && asset.lifecycle === 'active')
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .flatMap(asset => {
        const media = catalog.media.find(media => media.id === asset.mediaId && media.role === role && media.lifecycle === 'active' && media.status === 'ready' && media.mime.startsWith('image/') && media.url);
        return media ? [media] : [];
      });
    const fruit = pool('fruit');
    return [{ product, image, cutout: Boolean(portrait), color: portrait?.[1] || product.flavor.accentColor,
      fruit: fruit.length > 2 ? [fruit[0], fruit[fruit.length - 1], fruit[2]] : fruit,
      leaves: pool('leaf').slice(0, 2), ice: pool('ice')[0],
      href: `${publicUrl('/products/')}?group=${encodeURIComponent(product.group.id)}&product=${encodeURIComponent(product.variant.id)}` }];
  }).slice(0, 5);
}

export const FEATURED_SLIDE_INTERVAL = 3000;
export const featuredSlideIndex = (position: number, count: number) => count > 0 ? ((position % count) + count) % count : 0;
