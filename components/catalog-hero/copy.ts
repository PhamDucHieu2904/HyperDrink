import type { Locale } from '@/lib/i18n/catalog';

const copy = {
  en: { previous: 'Previous flavor', next: 'Next flavor', pause: 'Pause flavor carousel', resume: 'Resume flavor carousel', empty: 'No product is available for this selection.', unavailable: 'The product image is unavailable.', image: 'Product image', poster: 'Packaging reference · product label unavailable', volume: 'Volume' },
  fr: { previous: 'Saveur précédente', next: 'Saveur suivante', pause: 'Mettre le carrousel en pause', resume: 'Reprendre le carrousel', empty: 'Aucun produit disponible pour cette sélection.', unavailable: 'L’image du produit est indisponible.', image: 'Image du produit', poster: 'Référence de l’emballage · étiquette du produit indisponible', volume: 'Volume' },
  zh: { previous: '上一种口味', next: '下一种口味', pause: '暂停口味轮播', resume: '继续口味轮播', empty: '此选择暂无可展示的产品。', unavailable: '产品图片暂不可用。', image: '产品图片', poster: '包装参考图 · 产品标签暂不可用', volume: '容量' },
  es: { previous: 'Sabor anterior', next: 'Sabor siguiente', pause: 'Pausar carrusel de sabores', resume: 'Reanudar carrusel de sabores', empty: 'No hay productos disponibles para esta selección.', unavailable: 'La imagen del producto no está disponible.', image: 'Imagen del producto', poster: 'Referencia del envase · etiqueta del producto no disponible', volume: 'Volumen' },
  ar: { previous: 'النكهة السابقة', next: 'النكهة التالية', pause: 'إيقاف عرض النكهات مؤقتًا', resume: 'استئناف عرض النكهات', empty: 'لا يوجد منتج متاح لهذا الاختيار.', unavailable: 'صورة المنتج غير متاحة.', image: 'صورة المنتج', poster: 'مرجع العبوة · ملصق المنتج غير متاح', volume: 'الحجم' },
  ru: { previous: 'Предыдущий вкус', next: 'Следующий вкус', pause: 'Остановить карусель вкусов', resume: 'Продолжить карусель вкусов', empty: 'Для этого выбора нет доступного продукта.', unavailable: 'Изображение продукта недоступно.', image: 'Изображение продукта', poster: 'Образец упаковки · этикетка продукта недоступна', volume: 'Объём' },
  ko: { previous: '이전 맛', next: '다음 맛', pause: '맛 캐러셀 일시 정지', resume: '맛 캐러셀 다시 재생', empty: '이 선택에 표시할 제품이 없습니다.', unavailable: '제품 이미지를 표시할 수 없습니다.', image: '제품 이미지', poster: '포장 참고 이미지 · 제품 라벨을 표시할 수 없음', volume: '용량' },
  de: { previous: 'Vorherige Sorte', next: 'Nächste Sorte', pause: 'Sortenkarussell pausieren', resume: 'Sortenkarussell fortsetzen', empty: 'Für diese Auswahl ist kein Produkt verfügbar.', unavailable: 'Das Produktbild ist nicht verfügbar.', image: 'Produktbild', poster: 'Verpackungsreferenz · Produktetikett nicht verfügbar', volume: 'Volumen' },
} as const;

/** System UI stays localized; catalog names and descriptions are editorial content. */
export function heroCopy(locale: Locale) { return copy[locale]; }
