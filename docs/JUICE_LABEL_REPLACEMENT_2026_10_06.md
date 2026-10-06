# Juice 330 ml: thay bộ nhãn ngày 06/10/2026

Nguồn: `D:\Vinut-TK\Downloads\resized-images (17)` — 24 ảnh WebP.

Đã thay toàn bộ 24 nhãn Juice 330 ml và 24 ảnh thu nhỏ liên quan. Giữ nguyên ID nhãn, hương vị, liên kết display, model, UV/material slots và các công tắc hiển thị. Bản public tiếp tục có 15 hương Juice đang bật; 9 hương đang tắt cũng đã nhận artwork mới trong bản nháp. Bốn nhãn Popping Boba 320 ml thuộc dòng sản phẩm khác được giữ nguyên.

| File nguồn | Hương trong catalog |
| --- | --- |
| Apple-resized.webp | Apple |
| Avocado-resized.webp | Avocado |
| Banana-resized.webp | Banana |
| Guava-resized.webp | Guava |
| Lime-resized.webp | Lime |
| Logan-resized.webp | Longan |
| Lychee-resized.webp | Lychee |
| Mango-resized.webp | Mango |
| Mangosteen-resized.webp | Mangosteen |
| Mixed-resized.webp | Mixed Fruit |
| Noni-resized.webp | Noni |
| Orange-resized.webp | Orange |
| Passion fruit-resized.webp | Passion Fruit |
| Payaya-resized.webp | Papaya |
| Peach-resized.webp | Peach |
| Pineapple-resized.webp | Pineapple |
| Pomegranate-resized.webp | Pomegranate |
| Rabutan-resized.webp | Rambutan |
| Red Grape-resized.webp | Red Grape |
| Sapodilla-resized.webp | Sapodilla |
| Soursop-resized.webp | Soursop |
| Strawberry-resized.webp | Strawberry |
| Tamarind-resized.webp | Tamarind |
| Watermelon-resized.webp | Watermelon |

Tên hương được xác nhận bằng chữ và trái cây trên artwork, bao gồm ba tên file viết lệch Logan/Payaya/Rabutan. Upload sử dụng bộ xử lý media hiện tại, giữ tỷ lệ và chiều ảnh, không cắt hoặc phóng lớn; nhãn mới rộng 974–1000 px, cao 513 px theo nguồn đã resize.

## Kiểm chứng

- Đối chiếu 24 chuỗi label → flavor → display → model `registry-can-330`; xác nhận đúng texture URL và checksum từ nguồn qua optimizer tới file được phục vụ.
- Chọn lần lượt đủ 24 hương trên Studio kiểm thử riêng; mỗi hương đạt trạng thái Ready to export và xuất thành công PNG 1024 × 1024. Kiểm tra hình trái cây, tên hương, chiều chữ và vị trí artwork trên lon. Không có cảnh báo/lỗi console.
- Kiểm tra mặt trước và mặt sau Guava trên bản public local sau cập nhật; ảnh nhãn trong thư viện tải đủ. Bố cục desktop vẫn 3:4, không cuộn trang tại 1440 × 900.
- Preflight sau dọn dữ liệu: 0 lỗi. `npm run test:catalog`, `npm run test:mockup` (34 kiểm thử Mockup) và build static `/HyperDrink` đạt.
- Ảnh kiểm chứng 24 hương: `docs/screenshots/juice-330-new-labels-24-qa.jpg`. Ảnh Studio sau cập nhật: `docs/screenshots/juice-330-new-labels-studio.jpg`.

## Dọn nhãn cũ

48 bản ghi media cũ đã bị xóa khỏi catalog. Sáu bản phát hành local cũ chứa bộ artwork cũ đã được gỡ khỏi lịch sử khôi phục; metadata retained của 48 tài nguyên này cũng đã được xóa. 144 bản sao file cũ đã được xóa khỏi `data/admin/media`, `public/catalog/media` và `.next-pages/catalog/media` sau khi xác nhận không còn tham chiếu sử dụng.

Bản sao phục hồi business data và artwork cũ được giữ riêng ở `data/admin/juice-label-replacement-20261006/`; thư mục này không được xuất public hoặc cung cấp cho bộ chọn nhãn. `manifest.json` và `verification.json` trong đó ghi checksum, ánh xạ từng hương và kết quả đối chiếu. Ảnh nguồn ở thư mục Downloads được giữ nguyên.

Bản local mới: `b2b4a31f-14bc-48e5-ba41-8f15fee4dfb7`. Đã đồng bộ `public/catalog/current.json` và build `.next-pages`; chưa triển khai lên hosting bên ngoài.
