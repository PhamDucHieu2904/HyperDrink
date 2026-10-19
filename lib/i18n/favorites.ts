import type { Locale } from './catalog';

interface FavoritesCopy {
  title: string; open: string; close: string; add: string; remove: string;
  emptyTitle: string; emptyBody: string; browse: string; saved: string; unavailable: string;
}

const copies: Record<Locale, FavoritesCopy> = {
  en: { title: 'Your favorites', open: 'Open favorites', close: 'Close favorites', add: 'Add to favorites', remove: 'Remove from favorites', emptyTitle: 'Find something you love', emptyBody: 'Tap the heart on a product to save it here.', browse: 'Explore products', saved: 'Your favorites are saved in this browser.', unavailable: 'This product is no longer available.' },
  fr: { title: 'Vos favoris', open: 'Ouvrir les favoris', close: 'Fermer les favoris', add: 'Ajouter aux favoris', remove: 'Retirer des favoris', emptyTitle: 'Trouvez votre coup de cœur', emptyBody: 'Appuyez sur le cœur d’un produit pour le retrouver ici.', browse: 'Découvrir les produits', saved: 'Vos favoris sont enregistrés dans ce navigateur.', unavailable: 'Ce produit n’est plus disponible.' },
  zh: { title: '我的收藏', open: '打开收藏', close: '关闭收藏', add: '加入收藏', remove: '取消收藏', emptyTitle: '发现心仪的产品', emptyBody: '点击产品上的爱心，即可将其收藏在这里。', browse: '探索产品', saved: '您的收藏保存在此浏览器中。', unavailable: '此产品已下架。' },
  es: { title: 'Tus favoritos', open: 'Abrir favoritos', close: 'Cerrar favoritos', add: 'Añadir a favoritos', remove: 'Quitar de favoritos', emptyTitle: 'Encuentra algo que te encante', emptyBody: 'Pulsa el corazón de un producto para guardarlo aquí.', browse: 'Explorar productos', saved: 'Tus favoritos se guardan en este navegador.', unavailable: 'Este producto ya no está disponible.' },
  ar: { title: 'مفضلتك', open: 'فتح المفضلة', close: 'إغلاق المفضلة', add: 'إضافة إلى المفضلة', remove: 'إزالة من المفضلة', emptyTitle: 'اعثر على ما تحب', emptyBody: 'اضغط على قلب المنتج لحفظه هنا.', browse: 'استكشف المنتجات', saved: 'تُحفظ مفضلتك في هذا المتصفح.', unavailable: 'هذا المنتج لم يعد متاحًا.' },
  ru: { title: 'Ваше избранное', open: 'Открыть избранное', close: 'Закрыть избранное', add: 'Добавить в избранное', remove: 'Удалить из избранного', emptyTitle: 'Найдите то, что вам нравится', emptyBody: 'Нажмите на сердечко товара, чтобы сохранить его здесь.', browse: 'Смотреть продукты', saved: 'Избранное сохраняется в этом браузере.', unavailable: 'Этот товар больше недоступен.' },
  ko: { title: '찜한 상품', open: '찜 목록 열기', close: '찜 목록 닫기', add: '찜하기', remove: '찜 해제', emptyTitle: '마음에 드는 상품을 찾아보세요', emptyBody: '상품의 하트를 누르면 여기에 저장됩니다.', browse: '상품 둘러보기', saved: '찜한 상품은 이 브라우저에 저장됩니다.', unavailable: '이 상품은 더 이상 제공되지 않습니다.' },
  de: { title: 'Deine Favoriten', open: 'Favoriten öffnen', close: 'Favoriten schließen', add: 'Zu Favoriten hinzufügen', remove: 'Aus Favoriten entfernen', emptyTitle: 'Finde deine Lieblingsprodukte', emptyBody: 'Tippe auf das Herz eines Produkts, um es hier zu speichern.', browse: 'Produkte entdecken', saved: 'Deine Favoriten werden in diesem Browser gespeichert.', unavailable: 'Dieses Produkt ist nicht mehr verfügbar.' },
  vi: { title: 'Danh sách yêu thích', open: 'Mở danh sách yêu thích', close: 'Đóng danh sách yêu thích', add: 'Thêm vào yêu thích', remove: 'Bỏ yêu thích', emptyTitle: 'Tìm hương vị bạn yêu thích', emptyBody: 'Bấm vào trái tim trên thẻ sản phẩm để lưu vào đây.', browse: 'Khám phá sản phẩm', saved: 'Danh sách được lưu trên trình duyệt này.', unavailable: 'Sản phẩm này hiện không còn được cung cấp.' },
};

export const favoritesCopy = (locale: Locale) => copies[locale];
