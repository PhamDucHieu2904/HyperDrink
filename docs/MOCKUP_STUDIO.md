# VINUT 3D Mockup Studio

Triển khai ngày 06/10/2026 theo [master plan](MASTER_PLAN_3D_MOCKUP.md). Trang `/mockup/` dùng cùng catalog đã phát hành với website chính. Ô 360° chuyển đúng Display đang xem bằng ID; mở trực tiếp chọn một cấu hình được phép dùng. Link không nhận URL GLB hoặc ảnh tùy ý.

## Sử dụng

1. Mở ô **360° / Explore freely** trên homepage hoặc `/mockup/`.
2. Chọn **Mô hình**, **Preset 3D** hoặc **Nhãn** trong thư viện bên phải. Nhãn phải khớp chính xác packaging và UV profile của model; dung tích chỉ là bộ lọc.
3. Chọn camera, nền và chuyển động trong cột công cụ bên phải. Animation mặc định tắt; thao tác camera dừng animation.
4. Chọn khung **1:1**, **4:5**, **16:9** và cạnh dài **1024/2048 px**, rồi tải PNG. Preview dùng cùng tỷ lệ ảnh xuất; nền caro chỉ để xem transparency và không có trong PNG.
5. Sau export có thumbnail **Last exported image** và link **Download PNG again**. Đây là ảnh vừa tạo, giữ nguyên tên file dù bạn tiếp tục chỉnh cảnh; phiên chỉ giữ một ảnh export gần nhất.

## Bố cục 3:4 — cập nhật theo yêu cầu ngày 06/10/2026

Desktop từ 1200 px dùng tỷ lệ **preview trái : khu chỉnh sửa phải = 3:4**. Khu chỉnh sửa chia thành thư viện và cột công cụ nền/camera/chuyển động/xuất PNG; toàn bộ nhóm chức năng nằm trong chiều cao viewport. Canvas giữ đúng tỷ lệ ảnh xuất và tự co theo khoảng trống còn lại. Kết quả export nằm dưới preview để không đẩy nút tải ảnh khỏi màn hình.

Thư viện có 4 thẻ/trang. Màn hình thấp dùng thẻ dạng hàng gọn, giữ phân trang bên ngoài vùng danh sách. Tablet/mobile dùng bố cục cuộn tự nhiên để giữ kích thước nút và khả năng zoom chữ.

QA refactor xác nhận tỷ lệ 0,75, không cuộn trang và các nút/ô chỉnh sửa không nằm ngoài viewport ở **1920×1080, 1440×900, 1366×768, 1280×720, 1200×680**, kể cả gradient/transparent. RTL ở 1366×768 không tràn; mobile 375 px không tràn ngang. PNG portrait 1024 px xuất đúng 819×1024 sau thay đổi bố cục. Typecheck, ESLint và 34 test Mockup đều đạt.

Ảnh bố cục mới: [desktop](screenshots/mockup-studio-3-4-desktop.jpg), [laptop](screenshots/mockup-studio-3-4-laptop.jpg).

## Quyền hiển thị và phát hành

Model 3D và Label có `mockupVisible`, `mockupPosition`; model thêm `mockupFrontYaw` theo radian. Admin có nhãn giải thích ngay cạnh trường:

- `true`: tài nguyên được đưa riêng vào public release và thư viện Mockup, dù không dùng trên storefront.
- `false`: ẩn khỏi Mockup; Display bán hàng vẫn hoạt động theo cấu hình của nó.
- Vắng trường: chỉ kế thừa tài nguyên mà Display bán hàng đã phát hành dùng. Bản ghi trong draft không tạo quyền hiển thị public.

Model cần GLB ready, poster 2D, tên material/mesh nhãn thật và layout profile. Label cần artwork ready, loại nước và khai báo compatibility. Preflight kiểm tra cả những tài nguyên chỉ dùng trong Mockup. Thư viện, URL và preset dùng cùng selector; phiên làm việc ghim một immutable release và chỉ đổi release khi người dùng chủ động nạp lại.

Thay đổi mã nguồn không tự phát hành dữ liệu nháp. Bản public hiện tại có 2 model và 19 nhãn; bốn model còn lại trong draft thiếu poster/nhãn tương thích vẫn cần được chuẩn bị qua admin trước khi phát hành.

## Runtime và xuất ảnh

`lib/mockup/runtime.ts` quản lý camera/chuyển động riêng và dùng lại appearance pool, resource prefetch và environment từ viewer hiện có. Scene có một sản phẩm đứng thẳng, không có fruit/splash/ice hay chuyển động hero. Route tải runtime riêng sau khi vào Studio.

Preview và export dùng cùng pass tone mapping/sRGB, nền và xử lý alpha. PNG được render ở render target riêng, đọc pixel bất đồng bộ, lật Y rồi encode bằng `canvas.toBlob`. Không bật `preserveDrawingBuffer`, không resize preview lên độ phân giải xuất và không gửi ảnh về server. Mỗi lần chỉ có một export; camera/motion/viewport được phục hồi trong `finally`.

Giới hạn preview DPR là 1.5 desktop / 1.25 mobile. Khi đứng yên runtime render theo thay đổi; animation dùng delta time và giới hạn 60/30 FPS. Desktop giữ tối đa một model cũ bên cạnh model hiện tại; mobile không giữ model cũ. Appearance pool tối đa 5/3. Save-Data và tab ẩn được xử lý bởi cache có giới hạn. Thiết bị thiếu half-float render attachment dùng pass tương thích 8 bit cho cả preview và PNG.

Các thuộc tính `data-*` trên host canvas ghi phase, số tài nguyên và thời gian đổi nhãn; diagnostics animation được lấy mẫu tối đa một lần/giây. `data-frame-ms` là thời gian CPU gửi lệnh render, không phải phép đo FPS/GPU trên thiết bị thực.

## Kiểm tra

```powershell
npm run test:mockup
npm run test:catalog
npm run test:viewer
npm run test:admin
npm run test:translation
npm run typecheck
npm run lint
npm run build
$env:GITHUB_PAGES='true'
$env:NEXT_PUBLIC_BASE_PATH='/HyperDrink'
npm run build
```

## Kết quả bàn giao — 06/10/2026

Ba phần việc catalog/admin, runtime và UI đã được thực hiện song song, sau đó tích hợp và rà soát chéo. UI UX Pro Max được áp dụng cho tương tác, accessibility và responsive; màu xanh/kem, typography, bo góc và ngôn ngữ hình ảnh giữ theo website VINUT hiện có.

| Kiểm tra | Kết quả |
| --- | --- |
| Typecheck, full ESLint | Đạt; không có lỗi hoặc warning ESLint |
| Production build local và Pages `/HyperDrink` | Đạt trên cùng mã nguồn cuối cùng |
| Mockup | 34/34 test: 11 catalog + 23 runtime |
| Regression | Catalog/hero 50, viewer 76, admin 119, resources 7, translation 15, framing 4 đều đạt |
| Các suite còn lại trong Pages CI | Background 16, accents 39, environment 3, water 13 đều đạt |
| Browser static | GLB, artwork và poster tải bằng hashed media dưới đúng base path; không có console warning/error |
| Entry/deep link | Ô 360° giữ Display đang xem; preset/model/label giữ khi refresh trực tiếp Studio |
| Responsive | 375×812, 390×844, 768×1024, 1024×768, 844×390 và 1440×900 không tràn ngang; mobile có vùng chạm ít nhất 44 px |
| Keyboard/RTL | Arrow orbit, reset và camera state hoạt động; Arabic RTL desktop/mobile không tràn; back link mobile có tên truy cập |
| Stress tài nguyên | Đổi 15 nhãn lon 330 ml: appearance pool giữ 5, geometry 15, texture 8; export tiếp theo giữ nguyên geometry/texture; chỉ một thumbnail Blob kết quả. Đổi hai model desktop giữ tối đa 2 model, mở mobile rồi đổi model giữ 1 |

### PNG thực tế

| Ảnh lưu để kiểm chứng | Kích thước và pixel |
| --- | --- |
| [White square](screenshots/mockup-white-square.png) | 1024×1024; toàn bộ opaque, bốn góc trắng RGBA `[255,255,255,255]` |
| [Transparent portrait](screenshots/mockup-transparent-portrait.png) | 1638×2048; bốn góc alpha 0, 2.228.656 pixel trong suốt và 3.044 pixel alpha khử răng cưa; sản phẩm nằm trọn trong khung |
| [Gradient landscape](screenshots/mockup-gradient-landscape.png) | 1024×576; góc 3/4 đúng, toàn bộ opaque; đầu gradient `[219,233,206]`, cuối `[251,239,217]` đúng màu chọn |

Cả ba ảnh đã được kiểm tra độc lập: chữ/nhãn không bị lật hoặc phản chiếu, lon đứng thẳng, đủ mép/nắp/đáy, không có toolbar hoặc caro trong PNG. 1638 px là kết quả làm tròn cạnh ngắn của khung 4:5 với cạnh dài 2048 px.

Browser tích hợp không cung cấp native Blob download event/path. File PNG ở trên được lưu từ chính Blob ảnh export qua một QA sink chỉ chạy tại localhost, nằm trong `.tmp`, sau đó tắt sink và trả server về bản static nguyên vẹn. Đây là kiểm chứng ảnh thành phẩm; thao tác lưu file native trên Chrome/Edge của người dùng vẫn cần kiểm tra. App có link tải lại và mở PNG dự phòng, không khẳng định file đã được lưu khi chỉ mới bắt đầu download.

Ảnh giao diện: [desktop](screenshots/mockup-studio-desktop.jpg), [mobile](screenshots/mockup-studio-mobile.jpg), [Arabic RTL](screenshots/mockup-studio-rtl.jpg).

Chưa có benchmark FPS/GPU hoặc thao tác touch trên điện thoại vật lý/máy văn phòng, cũng chưa thử phục hồi context/network trên nhiều trình duyệt thật. Giới hạn cache/DPR/frame scheduler và các đường lỗi đã có kiểm thử tự động; cần thêm phép đo thiết bị trước khi đưa ra cam kết hiệu năng. Website chưa được push/deploy và release catalog thật được giữ nguyên.

## Nguồn kỹ thuật

- [Three.js screenshot guidance](https://threejs.org/manual/pages/tips.html)
- [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
- [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
- [MDN canvas.toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)
