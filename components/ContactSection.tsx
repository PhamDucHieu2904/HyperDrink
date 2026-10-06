'use client';

import { ArrowUpRight, Leaf, Mail, MapPin } from 'lucide-react';
import type { CatalogData } from '@/lib/catalog/contracts';
import { storefrontMarketingCopy } from '@/lib/i18n/storefront-marketing';
import { publicUrl } from '@/lib/public-url';
import { useLanguage } from './LanguageProvider';

export default function ContactSection({ catalog }: { catalog?: CatalogData }) {
  const { locale } = useLanguage();
  const copy = storefrontMarketingCopy(locale);
  const company = catalog?.productDetails?.find(detail => detail.lifecycle === 'active' && detail.enabled && detail.companyName.trim());
  return <section id="contact" className="section contact-section" aria-labelledby="contact-title">
    <div className="contact-intro">
      <p className="section-kicker">{copy.contactKicker}</p>
      <h2 id="contact-title">{copy.contactTitle}</h2>
      <p className="contact-description">{copy.contactIntro}</p>
      <a className="contact-products" href={publicUrl('/products/')}>{copy.productCta}<ArrowUpRight size={18} aria-hidden="true" /></a>
      <div className="contact-signature"><Leaf size={24} strokeWidth={1.4} aria-hidden="true" /><span>{copy.contactNote}</span></div>
    </div>
    <div className="contact-details">
      <div className="contact-email-card">
        <span className="contact-symbol" aria-hidden="true"><Mail size={24} strokeWidth={1.5} /></span>
        <p className="contact-label">{copy.emailLabel}</p>
        <a className="contact-email" href="mailto:hello@vinut.com" dir="ltr">hello@vinut.com</a>
        <p>{copy.emailHint}</p>
        <a className="contact-write" href="mailto:hello@vinut.com">{copy.emailCta}<ArrowUpRight size={20} aria-hidden="true" /></a>
      </div>
      <div className="contact-company-card">
        <span className="contact-symbol" aria-hidden="true"><MapPin size={24} strokeWidth={1.5} /></span>
        <p className="contact-label">{copy.companyLabel}</p>
        <h3><bdi>{company?.companyName || 'VINUT'}</bdi></h3>
        <p className="contact-label contact-address-label">{copy.addressLabel}</p>
        <address><bdi>{company?.companyAddress || copy.country}</bdi></address>
      </div>
    </div>
  </section>;
}
