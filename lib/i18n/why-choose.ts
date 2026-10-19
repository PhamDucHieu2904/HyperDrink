import type { Locale } from './catalog';

interface WhyChooseCopy {
  kicker: string;
  titleFirst: string;
  titleTrust: string;
  intro: string;
  reach: string;
  countriesLabel: string;
  countriesCaption: string;
  continents: string;
  logistics: string;
  factoryTitle: string;
  factoryBody: string;
  certifiedTitle: string;
  certifiedBody: string;
  certificationsLabel: string;
  naturalTitle: string;
  naturalBody: string;
}

/** Curated company copy follows the selected UI language without browser translation. */
const copies: Record<Locale, WhyChooseCopy> = {
  en: {
    kicker: 'WHY CHOOSE US', titleFirst: 'Global brands', titleTrust: 'trust',
    intro: 'World-class quality, competitive pricing and a reliable supply chain from Vietnam to the world.',
    reach: 'Global reach', countriesLabel: 'More than 200 countries', countriesCaption: 'export destinations', continents: 'continents',
    logistics: 'Reliable logistics and support.',
    factoryTitle: 'Modern factory', factoryBody: 'Automated production lines and rigorous quality control systems.',
    certifiedTitle: 'Certified quality', certifiedBody: 'Meeting the highest international standards.', certificationsLabel: 'Certifications',
    naturalTitle: 'Natural ingredients', naturalBody: 'Premium fruit from Vietnam’s finest farms, with full traceability.',
  },
  fr: {
    kicker: 'POURQUOI NOUS CHOISIR', titleFirst: 'Les marques du monde entier', titleTrust: 'font confiance à',
    intro: 'Une qualité de premier ordre, des prix compétitifs et une chaîne d’approvisionnement fiable, du Vietnam au monde entier.',
    reach: 'Une présence mondiale', countriesLabel: 'Plus de 200 pays', countriesCaption: 'pays d’exportation', continents: 'continents',
    logistics: 'Une logistique et un accompagnement fiables.',
    factoryTitle: 'Une usine moderne', factoryBody: 'Des lignes de production automatisées et des systèmes de contrôle qualité rigoureux.',
    certifiedTitle: 'Une qualité certifiée', certifiedBody: 'Le respect des normes internationales les plus exigeantes.', certificationsLabel: 'Certifications',
    naturalTitle: 'Des ingrédients naturels', naturalBody: 'Des fruits de qualité supérieure issus des meilleures fermes du Vietnam, avec une traçabilité complète.',
  },
  zh: {
    kicker: '为什么选择我们', titleFirst: '全球品牌', titleTrust: '信赖',
    intro: '世界级品质、具有竞争力的价格，以及从越南连接全球的可靠供应链。',
    reach: '全球覆盖', countriesLabel: '超过200个国家', countriesCaption: '个出口目的国', continents: '大洲',
    logistics: '可靠的物流与支持。',
    factoryTitle: '现代化工厂', factoryBody: '自动化生产线与严格的质量控制体系。',
    certifiedTitle: '品质认证', certifiedBody: '符合严苛的国际标准。', certificationsLabel: '认证',
    naturalTitle: '天然原料', naturalBody: '精选越南优质农场的上乘水果，全程可追溯。',
  },
  es: {
    kicker: 'POR QUÉ ELEGIRNOS', titleFirst: 'Las marcas globales', titleTrust: 'confían en',
    intro: 'Calidad de primer nivel, precios competitivos y una cadena de suministro fiable desde Vietnam al mundo.',
    reach: 'Alcance global', countriesLabel: 'Más de 200 países', countriesCaption: 'países de exportación', continents: 'continentes',
    logistics: 'Logística y asistencia fiables.',
    factoryTitle: 'Fábrica moderna', factoryBody: 'Líneas de producción automatizadas y rigurosos sistemas de control de calidad.',
    certifiedTitle: 'Calidad certificada', certifiedBody: 'Cumplimos las normas internacionales más exigentes.', certificationsLabel: 'Certificaciones',
    naturalTitle: 'Ingredientes naturales', naturalBody: 'Fruta de primera calidad de las mejores fincas de Vietnam, con trazabilidad completa.',
  },
  ar: {
    kicker: 'لماذا تختارنا', titleFirst: 'العلامات التجارية العالمية', titleTrust: 'تثق بـ',
    intro: 'جودة عالمية وأسعار تنافسية وسلسلة توريد موثوقة من فيتنام إلى العالم.',
    reach: 'حضور عالمي', countriesLabel: 'أكثر من 200 دولة', countriesCaption: 'دولة نصدر إليها', continents: 'قارات',
    logistics: 'خدمات لوجستية ودعم موثوقان.',
    factoryTitle: 'مصنع حديث', factoryBody: 'خطوط إنتاج آلية وأنظمة صارمة لمراقبة الجودة.',
    certifiedTitle: 'جودة معتمدة', certifiedBody: 'نلتزم بأعلى المعايير الدولية.', certificationsLabel: 'الشهادات',
    naturalTitle: 'مكونات طبيعية', naturalBody: 'فواكه ممتازة من أفضل مزارع فيتنام مع إمكانية التتبع الكامل.',
  },
  ru: {
    kicker: 'ПОЧЕМУ ВЫБИРАЮТ НАС', titleFirst: 'Мировые бренды', titleTrust: 'доверяют',
    intro: 'Качество мирового уровня, конкурентные цены и надёжные поставки из Вьетнама по всему миру.',
    reach: 'Глобальное присутствие', countriesLabel: 'Более 200 стран', countriesCaption: 'стран экспорта', continents: 'континентов',
    logistics: 'Надёжная логистика и поддержка.',
    factoryTitle: 'Современное производство', factoryBody: 'Автоматизированные производственные линии и строгий контроль качества.',
    certifiedTitle: 'Сертифицированное качество', certifiedBody: 'Соответствие самым высоким международным стандартам.', certificationsLabel: 'Сертификаты',
    naturalTitle: 'Натуральные ингредиенты', naturalBody: 'Отборные фрукты с лучших ферм Вьетнама с полной прослеживаемостью происхождения.',
  },
  ko: {
    kicker: '우리를 선택하는 이유', titleFirst: '글로벌 브랜드가', titleTrust: '신뢰하는',
    intro: '세계적 수준의 품질, 경쟁력 있는 가격, 베트남에서 세계로 이어지는 신뢰할 수 있는 공급망.',
    reach: '세계로 뻗는 네트워크', countriesLabel: '200개국 이상', countriesCaption: '수출 대상국', continents: '대륙',
    logistics: '믿을 수 있는 물류와 지원.',
    factoryTitle: '현대적인 공장', factoryBody: '자동화된 생산 라인과 엄격한 품질 관리 시스템.',
    certifiedTitle: '인증된 품질', certifiedBody: '최고 수준의 국제 기준을 충족합니다.', certificationsLabel: '인증',
    naturalTitle: '천연 원료', naturalBody: '베트남 최고의 농장에서 재배한 고품질 과일과 완전한 이력 추적.',
  },
  de: {
    kicker: 'WARUM SIE UNS WÄHLEN', titleFirst: 'Globale Marken', titleTrust: 'vertrauen',
    intro: 'Erstklassige Qualität, wettbewerbsfähige Preise und eine zuverlässige Lieferkette aus Vietnam in die ganze Welt.',
    reach: 'Weltweite Präsenz', countriesLabel: 'Mehr als 200 Länder', countriesCaption: 'Exportländer', continents: 'Kontinente',
    logistics: 'Zuverlässige Logistik und Betreuung.',
    factoryTitle: 'Moderne Fabrik', factoryBody: 'Automatisierte Produktionslinien und strenge Qualitätskontrollsysteme.',
    certifiedTitle: 'Zertifizierte Qualität', certifiedBody: 'Wir erfüllen höchste internationale Standards.', certificationsLabel: 'Zertifizierungen',
    naturalTitle: 'Natürliche Zutaten', naturalBody: 'Erstklassige Früchte von Vietnams besten Farmen mit lückenloser Rückverfolgbarkeit.',
  },
  vi: {
    kicker: 'TẠI SAO CHỌN CHÚNG TÔI', titleFirst: 'Thương hiệu toàn cầu', titleTrust: 'tin cậy',
    intro: 'Chất lượng đẳng cấp, giá cả cạnh tranh và chuỗi cung ứng đáng tin cậy từ Việt Nam ra thế giới.',
    reach: 'Phạm vi toàn cầu', countriesLabel: 'Hơn 200 quốc gia', countriesCaption: 'quốc gia xuất khẩu', continents: 'châu lục',
    logistics: 'Hậu cần và hỗ trợ đáng tin cậy.',
    factoryTitle: 'Nhà máy hiện đại', factoryBody: 'Dây chuyền sản xuất tự động và hệ thống kiểm soát chất lượng nghiêm ngặt.',
    certifiedTitle: 'Chất lượng chứng nhận', certifiedBody: 'Đáp ứng các tiêu chuẩn quốc tế cao nhất.', certificationsLabel: 'Các chứng nhận',
    naturalTitle: 'Nguyên liệu tự nhiên', naturalBody: 'Trái cây cao cấp từ các trang trại tốt nhất Việt Nam với khả năng truy xuất đầy đủ.',
  },
};

export const whyChooseCopy = (locale: Locale) => copies[locale];
