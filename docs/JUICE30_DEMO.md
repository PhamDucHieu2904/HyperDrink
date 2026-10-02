# Demo Juice 30% · 330 ml

Ngày thực hiện: 02/10/2026 (Asia/Bangkok).

Mở admin tại [localhost:3100/admin](http://localhost:3100/admin), đăng nhập bằng tài khoản demo đã cung cấp. Bản dữ liệu đã phát hành xem tại [localhost:3100/admin/live](http://localhost:3100/admin/live).

## Dữ liệu đã nhập

- Dòng **Juice 30%**, thứ tự 0, đang hiển thị.
- Slot **330 ml**, thứ tự 0, chế độ 3D; hương mặc định **Orange**.
- 24 Flavor, 24 Label, 24 Product Variant và 24 Display3D.
- Dùng model thật `registry-can-330`, packaging `can-330`, profile `can-wrap-v1`, material nhãn `printed-label`.
- Nguồn: 24 PNG trong thư mục `Desktop/5x/Juice 330 ml`. Không thay đổi file nguồn.
- Tên hiển thị Longan/Papaya/Rambutan được chuẩn hóa từ tên file Logan/Payaya/Rabutan; nội dung artwork giữ nguyên.
- Thumbnail lấy từ artwork nhãn. Màu/icon là dữ liệu demo có thể chỉnh trong Flavor Data. Chưa có ảnh trái cây/lá tách nền riêng.
- Poster của model là sơ đồ bao bì trung tính do `scripts/create-neutral-can-poster.cjs` tạo; không phải render SKU 2D.
- Chưa tạo Asset2D hoặc Display2D; bổ sung khi có hình.

## Upload ảnh tự tối ưu

Ảnh PNG/JPEG/WebP tải mới được giải mã, áp dụng hướng EXIF, giữ tỉ lệ và alpha, giảm kích thước theo vai trò rồi lưu WebP. Không crop, thêm khung hoặc phóng lớn ảnh nhỏ. Giới hạn cạnh dài: Label 2048 px; Thumbnail 512 px; Icon 256 px; các ảnh khác 1600 px. Label chất lượng 90; các vai trò khác 82. GLB giữ nguyên byte.

Đây là giới hạn pixel và dung lượng file; kích thước vật thể trong cảnh được quản lý riêng. Ảnh đã lưu trước nâng cấp không bị ghi đè.

| Dữ liệu | Dung lượng |
|---|---:|
| 24 PNG nguồn | 41.003.851 B |
| 24 nhãn WebP | 8.842.260 B |
| 24 thumbnail WebP | 754.748 B |
| Nhãn và thumbnail sau xử lý | 9.597.008 B |
| Giảm so với PNG nguồn | 76,6% |

Nhãn Orange sau xử lý: **2048 × 1054 px**, **408.856 B**, WebP.

## Kiểm tra và phục hồi

Preflight đã đạt trước phát hành. API public đã được kiểm tra số lượng/quan hệ, default slot, resolver của 24 cấu hình, MIME/dimensions/checksum của 49 file ảnh mới. Các file có thể đọc khi không có session vì đã thuộc release. Import lại không tạo thêm entity hoặc media: 99 record giữ nguyên, 49 media được dùng lại.

55/55 admin tests, typecheck, lint và build production admin đạt. Đã khởi động lại API và xác nhận release cùng toàn bộ file vẫn đọc được. Kiểm tra trực quan trên trình duyệt trong phiên này chưa thực hiện được vì công cụ bị chặn khi mở localhost; người vận hành cần xem `/admin/live` để duyệt hướng nhãn và UV trên model.

Bản sao trước nhập nằm tại `.tmp/admin-backups/20261002-before-juice30`. Database/upload hoạt động ở `data/admin`, bị Git ignore. Không lưu mật khẩu trong mã nguồn. Hướng dẫn backup/restore đầy đủ trong [ADMIN_RUNBOOK.md](ADMIN_RUNBOOK.md).

Nhập lại qua `scripts/import-juice-demo.cjs` cần `ADMIN_EMAIL` và `ADMIN_PASSWORD` trong environment của phiên terminal; mặc định chỉ cập nhật nháp. Cờ `--publish` mới tạo release. Cờ `--dry-run` chỉ kiểm tra file; `--source` chọn thư mục khác. Khi nhập cùng nguồn, media được nhận diện bằng checksum của WebP xử lý chung với backend.

Trang chính `/` đã được nối với public catalog theo yêu cầu ngày 02/10/2026: Juice 30% → slot 330 ml → 24 hương, Orange mặc định; mô hình lon nhận nhãn WebP thật. Nền/icon, danh sách collection, filter và search đọc cùng release. Có thể bấm card trong collection để mở đúng hương trên hero. Giữ giao diện, motion và phần đổi ngôn ngữ đang phát triển.

Snapshot cùng release đã được xuất ra `public/catalog/current.json` với 49 file ảnh WebP để build GitHub Pages hoạt động khi không có backend. Cập nhật sau này theo `npm run catalog:export` rồi build/deploy. Không có 2D product render trong bộ này; thumbnail là artwork nhãn, poster chỉ minh họa bao bì khi 3D không tải được.

Kiểm tra tích hợp main: 23 kiểm tra catalog/fetch/export/hero đạt; 55 kiểm tra admin đạt; regression background, framing, accents, environment, water và i18n đạt. Public API cùng 49 ảnh được kiểm tra qua cổng 3000 với origin của storefront; snapshot build Pages kiểm tra checksum toàn bộ 50 media gồm model. Viewer bắt buộc áp được nhãn thật; lỗi tải/slot/UV chuyển trạng thái lỗi để dùng fallback, không giữ nhãn mẫu hoặc nhãn hương cũ. Các trường hợp đổi hương nhanh, lỗi nhãn cũ và retry cũng được kiểm thử.

Các kiểm tra bằng mã render không xác nhận hình ảnh WebGL thực tế trong trình duyệt. Công cụ trình duyệt vẫn chặn localhost trong phiên này; việc duyệt trực quan hướng nhãn/UV và bố cục trên máy người dùng còn cần xem tại trang chính.

## Chỉnh trạng thái mở đầu

Đã sửa lỗi animation bắt đầu lại từ hương đầu tiên sau khi khởi tạo Orange: màu/icon được chọn giữ nguyên ngay khi các effect và frame đầu chạy. Loader của cả mã viewer và model/label dùng chỉ báo SVG nhỏ trong vùng sản phẩm đã dành sẵn, thay cho poster lon trơn phóng lớn. Fallback cho lỗi tải thực tế vẫn hoạt động.

Portrait, ô ghi chú, carousel và danh sách hương hiển thị thumbnail theo `cover` và căn giữa. Đây chỉ là cách trình bày trong khung; file nhãn đầy đủ và UV trên lon không thay đổi. Bộ demo chưa có ảnh trái cây/lá riêng.

Sau thay đổi: 26 kiểm tra catalog/fetch/export/hero, 39 kiểm tra viewer/appearance/loader và 13 kiểm tra background đạt; typecheck, lint và build Pages tại base path `/demo-catalog` đạt. Kiểm tra HTTP xác nhận trang chính và public API cổng 3000 vẫn trả 200, release không đổi. Chưa duyệt trực quan WebGL trên trình duyệt vì giới hạn công cụ nêu trên.

## Điều chỉnh năm khu vực theo phản hồi

- Banner trên navigation phục hồi đủ 10 loại nước bằng text có animation bước 3 giây. Đây là quảng cáo, không chọn dòng hoặc lọc collection.
- Vùng BEST SELLER lấy `productGroups` đang visible theo position; nút dùng buttonLabel hoặc name. Chọn dòng mở slot/default flavor hợp lệ. Juice 30% hiện là dòng đã phát hành trong demo.
- Splash giữ đúng ảnh nước gốc, transform và Hard Light; cả 24 hương chưa gán splash riêng đều dùng preset này. Pool trái cây/lá vẫn chỉ lấy ảnh đúng hương được admin gán.
- Thanh hương vị giữ vòng tròn/gradient cũ và dùng controller kéo: auto không tự chọn; kéo thường chỉ dịch thanh, chờ 1 giây sau thả rồi chạy lại. Theo cập nhật tiếp theo, kéo nhanh liên tục mới chọn hương đi qua tâm, cả lúc đang giữ và khi còn quán tính đủ nhanh. Khi chậm lại thanh tiếp tục trôi nhưng không đổi thêm hương; dừng rồi chờ 1 giây để auto. Tap/click và bàn phím vẫn chọn được hương.
- CTA, nút lối tắt đang chọn và badge dùng lại màu gradient cũ, không lấy màu nền hương để đổi màu các nút này.

Ngưỡng và vận tốc ở `lib/catalog/flavor-carousel-motion.ts`: kéo nhanh cần tổng/gần nhất ít nhất 96 px, vận tốc đo được ít nhất 1.600 CSS px/s và ít nhất hai đoạn chuyển động nhanh cùng hướng với tổng thời gian thực di chuyển 60 ms. Khoảng giữ yên từ 24 ms trở lên ngắt bằng chứng chuyển động liên tục; một spike đơn lẻ không đủ. Cửa sổ đo 140 ms, lần di chuyển cuối trước thả không quá 60 ms. Khi đã vào trạng thái nhanh, đổi hương dừng dưới 1.000 px/s nhưng quán tính vẫn trôi đến nghỉ. Controller lấy timestamp/coalesced samples thật, thay vì thời điểm dispatch, nên main thread bận không làm vận tốc tăng giả. Giữ tay sau một cú kéo nhanh không kích hoạt flick. Controller DOM quản lý pointer capture/cancel, bỏ click phát sinh sau drag, giữ cuộn dọc, dừng khi ẩn và cleanup. Chế độ giảm chuyển động giữ kéo thủ công và không auto/flick. Focus bàn phím được căn lại khi resize hoặc đổi nội dung/ngôn ngữ.

Kiểm tra cập nhật: admin 59, catalog 29, viewer 39, carousel 19 và i18n 5 kiểm tra đạt; typecheck, lint và build Pages đạt. HTTP cổng 3000 trả đúng banner, CSS slider và splash WebP; public release không đổi. Hai lỗi focus khi resize/rebind đã được một agent khác tái hiện và xác nhận sửa. Kiểm tra trực quan thao tác kéo và WebGL trên trình duyệt vẫn chưa thực hiện được vì công cụ chặn localhost.

## Bỏ cụm điều khiển và sửa đường nối nhãn

Theo phản hồi tiếp theo, cụm mũi tên/counter/pause phía dưới carousel đã bỏ khỏi UI; kéo thường, flick, auto và điều khiển bằng bàn phím vẫn giữ nguyên. Badge góc trên card đổi từ “3D” thành “Hot”; chỉ số trải nghiệm phía dưới không đổi.

Hai mảng đen ở đầu/chân lon xuất phát từ sampler clamp kéo dài cột pixel đen 1 px của mép nhãn gốc lên các tam giác seam có U > 1. Model `can-wrap-v1` và cả sáu can asset giờ dùng repeat S, clamp T. Render đối chiếu cùng GLB/WebP với nhãn emissive tái hiện đúng lỗi, và hai mảng biến mất khi chỉ đổi sampler. File nhãn, nguồn Blender, các GLB và public release giữ nguyên. Chi tiết kiểm tra UV, normals và 439.200 mẫu khoảng cách của sáu model trong [model-pipeline.md](model-pipeline.md#label-seam-audit--2026-10-02).

## Vuốt mobile và vùng chạm của lon

Lỗi kéo ngang trên mobile do capture ngầm ban đầu nằm trên button: khi chuyển sang viewport, `lostpointercapture` từ button bubble lên và code cũ hủy gesture. Controller chỉ hủy khi viewport thật sự mất capture của nó, giữ cuộn dọc qua `pan-y`, và chặn click tương thích phát sinh sau drag nhưng vẫn cho tap/bàn phím hoạt động.

Canvas 3D dùng `pan-y pinch-zoom` để vuốt ở vùng trống vẫn cuộn trang. Vùng nhận thao tác xoay được clip theo silhouette của các mesh đang hiển thị trong model; nó có `touch-action:none` trước khi người dùng chạm, và raycast kiểm tra đúng geometry trước khi bắt kéo. Splash, ice, droplets và phần model ẩn không tham gia vùng chạm. Path cập nhật theo pose/camera/resize, được xóa khi model chưa sẵn sàng, đổi bao bì hoặc gặp lỗi. Mouse và bàn phím vẫn điều khiển viewer.

Hai video người dùng cung cấp đã được đọc offline để đối chiếu nhịp kéo; video mobile thể hiện thanh chỉ tự trôi dù có kéo ngang rõ ràng. Chưa kiểm chứng bản sửa bằng trình duyệt hoặc thiết bị cảm ứng thật trong phiên này.

Kiểm tra bản sửa: 28 carousel, 53 viewer/appearance/loader và 29 catalog/fetch/export/hero đều đạt. Lint, typecheck và build Pages với base path `/demo-catalog` đạt; trang chính cổng 3000 trả HTTP 200. Các regression bao gồm timestamp/coalesced samples, capture transfer của touch, kéo nhẹ/spike/giữ tay, kéo nhanh liên tục, đường bao có lỗ, vùng trống/mesh ẩn/decoration, resize, đa chạm, hủy gesture và cleanup. Đây là kiểm tra bằng mã, chưa thay thế thao tác trên điện thoại thật.
