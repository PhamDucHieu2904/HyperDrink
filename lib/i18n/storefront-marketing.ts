import type { Locale } from './catalog';
import type { ProductGroup } from '@/lib/catalog/contracts';
import { HERO_PRODUCT_DEFAULTS, heroProductMessages } from '@/lib/catalog/hero-marketing';

interface MarketingCopy {
  volume: string; flavors: string; origin: string;
  contactKicker: string; contactTitle: string; contactIntro: string;
  emailLabel: string; emailCta: string; emailHint: string;
  companyLabel: string; addressLabel: string; country: string;
  productCta: string; contactNote: string;
}

const copy: Record<Locale, MarketingCopy> = {
  en: {
    volume: 'Net content', flavors: 'Many flavor choices', origin: 'Real fruit from Vietnam',
    contactKicker: 'CONTACT VINUT', contactTitle: 'Good conversations. Great flavors.',
    contactIntro: 'Looking for your next favorite drink or exploring a business partnership? Let’s start a conversation.',
    emailLabel: 'LET’S CONNECT', emailCta: 'Write to us', emailHint: 'Tell us about the products you’re interested in.',
    companyLabel: 'OUR COMPANY', addressLabel: 'FIND US', country: 'Vietnam',
    productCta: 'Explore our products', contactNote: 'From Vietnam, with flavor.',
  },
  fr: {
    volume: 'Contenance nette', flavors: 'Un large choix de saveurs', origin: 'De vrais fruits du Vietnam',
    contactKicker: 'CONTACTEZ VINUT', contactTitle: 'De belles rencontres. De grandes saveurs.',
    contactIntro: 'Vous cherchez votre prochaine boisson préférée ou un partenariat commercial ? Parlons-en.',
    emailLabel: 'ÉCHANGEONS', emailCta: 'Écrivez-nous', emailHint: 'Parlez-nous des produits qui vous intéressent.',
    companyLabel: 'NOTRE ENTREPRISE', addressLabel: 'NOTRE ADRESSE', country: 'Vietnam',
    productCta: 'Découvrez nos produits', contactNote: 'Du Vietnam, avec saveur.',
  },
  zh: {
    volume: '净含量', flavors: '丰富口味任您选择', origin: '来自越南的真实水果',
    contactKicker: '联系 VINUT', contactTitle: '畅聊美好。品味精彩。',
    contactIntro: '寻找喜爱的饮品，或探索商业合作？欢迎与我们交流。',
    emailLabel: '与我们联系', emailCta: '发送邮件', emailHint: '告诉我们您感兴趣的产品。',
    companyLabel: '我们的公司', addressLabel: '公司地址', country: '越南',
    productCta: '探索我们的产品', contactNote: '越南风味，与你分享。',
  },
  es: {
    volume: 'Contenido neto', flavors: 'Muchas opciones de sabor', origin: 'Fruta real de Vietnam',
    contactKicker: 'CONTACTA CON VINUT', contactTitle: 'Buenas conversaciones. Grandes sabores.',
    contactIntro: '¿Buscas tu próxima bebida favorita o una alianza comercial? Hablemos.',
    emailLabel: 'CONECTEMOS', emailCta: 'Escríbenos', emailHint: 'Cuéntanos qué productos te interesan.',
    companyLabel: 'NUESTRA EMPRESA', addressLabel: 'ENCUÉNTRANOS', country: 'Vietnam',
    productCta: 'Explora nuestros productos', contactNote: 'Desde Vietnam, con sabor.',
  },
  ar: {
    volume: 'الحجم الصافي', flavors: 'خيارات عديدة من النكهات', origin: 'فاكهة حقيقية من فيتنام',
    contactKicker: 'تواصل مع VINUT', contactTitle: 'حوارات جميلة. نكهات رائعة.',
    contactIntro: 'هل تبحث عن مشروبك المفضل القادم أو شراكة تجارية؟ لنتحدث.',
    emailLabel: 'لنتواصل', emailCta: 'راسلنا', emailHint: 'أخبرنا عن المنتجات التي تهمك.',
    companyLabel: 'شركتنا', addressLabel: 'عنواننا', country: 'فيتنام',
    productCta: 'اكتشف منتجاتنا', contactNote: 'من فيتنام، بكل نكهة.',
  },
  ru: {
    volume: 'Объём нетто', flavors: 'Большой выбор вкусов', origin: 'Настоящие фрукты из Вьетнама',
    contactKicker: 'СВЯЖИТЕСЬ С VINUT', contactTitle: 'Приятное общение. Прекрасные вкусы.',
    contactIntro: 'Ищете новый любимый напиток или делового партнёра? Давайте обсудим.',
    emailLabel: 'ДАВАЙТЕ ОБЩАТЬСЯ', emailCta: 'Напишите нам', emailHint: 'Расскажите, какие продукты вас интересуют.',
    companyLabel: 'НАША КОМПАНИЯ', addressLabel: 'НАШ АДРЕС', country: 'Вьетнам',
    productCta: 'Посмотрите наши продукты', contactNote: 'Из Вьетнама, со вкусом.',
  },
  ko: {
    volume: '내용량', flavors: '다양한 맛의 선택', origin: '베트남에서 온 진짜 과일',
    contactKicker: 'VINUT에 문의하기', contactTitle: '좋은 대화. 풍부한 맛.',
    contactIntro: '새로운 음료를 찾거나 비즈니스 파트너십을 생각하고 계신가요? 함께 이야기해요.',
    emailLabel: '연락해 주세요', emailCta: '이메일 보내기', emailHint: '관심 있는 제품에 대해 알려 주세요.',
    companyLabel: '회사 소개', addressLabel: '회사 주소', country: '베트남',
    productCta: '제품 살펴보기', contactNote: '베트남의 맛을 담아.',
  },
  de: {
    volume: 'Nettoinhalt', flavors: 'Viele Geschmacksrichtungen', origin: 'Echte Früchte aus Vietnam',
    contactKicker: 'KONTAKT ZU VINUT', contactTitle: 'Gute Gespräche. Großer Geschmack.',
    contactIntro: 'Suchen Sie Ihr nächstes Lieblingsgetränk oder eine Geschäftspartnerschaft? Sprechen wir darüber.',
    emailLabel: 'KONTAKT AUFNEHMEN', emailCta: 'Schreiben Sie uns', emailHint: 'Erzählen Sie uns, welche Produkte Sie interessieren.',
    companyLabel: 'UNSER UNTERNEHMEN', addressLabel: 'UNSERE ADRESSE', country: 'Vietnam',
    productCta: 'Unsere Produkte entdecken', contactNote: 'Aus Vietnam, mit Geschmack.',
  },
};

export const storefrontMarketingCopy = (locale: Locale) => copy[locale];

export function localizedHeroMessages(group: ProductGroup, locale: Locale) {
  const messages = heroProductMessages(group);
  const defaults = copy[locale];
  return {
    volume: messages.heroVolumeCaption === HERO_PRODUCT_DEFAULTS.heroVolumeCaption ? defaults.volume : messages.heroVolumeCaption,
    flavors: messages.heroFlavorText === HERO_PRODUCT_DEFAULTS.heroFlavorText ? defaults.flavors : messages.heroFlavorText,
    origin: messages.heroOriginText === HERO_PRODUCT_DEFAULTS.heroOriginText ? defaults.origin : messages.heroOriginText,
  };
}
