'use client';

import { BadgeCheck, Factory, Globe2, Leaf } from 'lucide-react';
import { whyChooseCopy } from '@/lib/i18n/why-choose';
import { useLanguage } from './LanguageProvider';

export default function WhyChooseSection() {
  const { locale } = useLanguage();
  const copy = whyChooseCopy(locale);
  const reasons = [
    {
      id: 'factory',
      title: copy.factoryTitle,
      body: copy.factoryBody,
      metric: new Intl.NumberFormat(locale).format(50000),
      unit: 'm²',
      icon: Factory,
    },
    {
      id: 'quality',
      title: copy.certifiedTitle,
      body: copy.certifiedBody,
      certifications: ['FDA', 'HALAL', 'ISO 22000', 'HACCP', 'BSCI'],
      icon: BadgeCheck,
    },
    {
      id: 'ingredients',
      title: copy.naturalTitle,
      body: copy.naturalBody,
      icon: Leaf,
    },
  ] as const;
  return <section id="why-vinut" className="why-choose-section" aria-labelledby="why-choose-title">
    <div className="why-choose-heading-band">
      <header className="why-choose-heading">
        <div>
          <p className="why-choose-kicker">{copy.kicker}</p>
          <h2 id="why-choose-title"><span>{copy.titleFirst}</span>{' '}<strong>{copy.titleTrust} <em><bdi>VINUT</bdi></em></strong></h2>
        </div>
        <div className="why-choose-intro">
          <p>{copy.intro}</p>
        </div>
      </header>
    </div>
    <div className="why-choose-content">
      <div className="why-choose-inner">
      <div className="why-choose-board">
        <article className="why-choose-reach" aria-labelledby="why-choose-reach-title">
          <div className="why-choose-globe" aria-hidden="true"><Globe2 strokeWidth={.65} /><span className="why-choose-orbit" /><span className="why-choose-orbit-dot" /></div>
          <h3 id="why-choose-reach-title">{copy.reach}</h3>
          <div className="why-choose-reach-number"><span className="why-choose-world-count" aria-label={copy.countriesLabel}><bdi dir="ltr">200<span aria-hidden="true">+</span></bdi></span><span>{copy.countriesCaption}</span></div>
          <div className="why-choose-reach-footer"><span className="why-choose-continents"><bdi>5</bdi> {copy.continents}</span><p>{copy.logistics}</p></div>
        </article>
        <div className="why-choose-list">
          {reasons.map(reason => <article className="why-choose-item" key={reason.id}>
            <span className="why-choose-item-icon"><reason.icon size={26} strokeWidth={1.5} aria-hidden="true" /></span>
            <div className="why-choose-item-copy">
              <div className="why-choose-item-heading"><h3>{reason.title}</h3>{'metric' in reason && <span className="why-choose-factory-size"><bdi>{reason.metric}</bdi><span>{reason.unit}</span></span>}</div>
              {'certifications' in reason && <ul className="why-choose-certifications" aria-label={copy.certificationsLabel}>{reason.certifications.map(name => <li key={name}><bdi>{name}</bdi></li>)}</ul>}
              <p>{reason.body}</p>
            </div>
          </article>)}
        </div>
      </div>
      </div>
    </div>
  </section>;
}
