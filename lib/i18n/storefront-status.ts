import type { Locale } from './catalog';

/** UI status copy only. Catalog names and descriptions remain authored in admin. */
export const storefrontStatus: Record<Locale, { loading: string; unavailable: string; retry: string; empty: string; refreshFailed: string; artwork: string }> = {
  en: { loading: 'Loading the collection…', unavailable: 'The collection is currently unavailable.', retry: 'Try again', empty: 'No products have been published yet.', refreshFailed: 'The latest update could not be loaded. You can still explore the loaded collection.', artwork: 'Label artwork' },
  fr: { loading: 'Chargement de la collection…', unavailable: 'La collection est momentanément indisponible.', retry: 'Réessayer', empty: 'Aucun produit n’a encore été publié.', refreshFailed: 'La dernière mise à jour n’a pas pu être chargée. La collection déjà chargée reste disponible.', artwork: 'Visuel de l’étiquette' },
  zh: { loading: '正在加载产品系列…', unavailable: '产品系列暂时无法加载。', retry: '重试', empty: '尚未发布任何产品。', refreshFailed: '无法加载最新更新。您仍可浏览已加载的产品系列。', artwork: '标签图稿' },
  es: { loading: 'Cargando la colección…', unavailable: 'La colección no está disponible en este momento.', retry: 'Reintentar', empty: 'Todavía no se han publicado productos.', refreshFailed: 'No se pudo cargar la última actualización. Puedes seguir explorando la colección cargada.', artwork: 'Diseño de etiqueta' },
  ar: { loading: 'جارٍ تحميل المجموعة…', unavailable: 'المجموعة غير متاحة حاليًا.', retry: 'حاول مجددًا', empty: 'لم يتم نشر أي منتجات بعد.', refreshFailed: 'تعذّر تحميل التحديث الأخير. لا يزال بإمكانك استعراض المجموعة المحمّلة.', artwork: 'تصميم الملصق' },
  ru: { loading: 'Загрузка коллекции…', unavailable: 'Коллекция временно недоступна.', retry: 'Повторить', empty: 'Пока нет опубликованных товаров.', refreshFailed: 'Не удалось загрузить обновление. Загруженная коллекция по-прежнему доступна.', artwork: 'Макет этикетки' },
  ko: { loading: '컬렉션을 불러오는 중…', unavailable: '현재 컬렉션을 불러올 수 없습니다.', retry: '다시 시도', empty: '아직 게시된 제품이 없습니다.', refreshFailed: '최신 업데이트를 불러오지 못했습니다. 기존 컬렉션은 계속 볼 수 있습니다.', artwork: '라벨 디자인' },
  de: { loading: 'Kollektion wird geladen…', unavailable: 'Die Kollektion ist derzeit nicht verfügbar.', retry: 'Erneut versuchen', empty: 'Es wurden noch keine Produkte veröffentlicht.', refreshFailed: 'Das neueste Update konnte nicht geladen werden. Die geladene Kollektion bleibt verfügbar.', artwork: 'Etikettenmotiv' },
};
