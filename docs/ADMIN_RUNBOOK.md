# VINUT Admin — Hướng dẫn chạy và vận hành demo local

Ngày: 02/10/2026. Demo chạy trên máy này, cùng repository website. Chưa deploy Cloudflare, Supabase hoặc dịch vụ bên ngoài. Trang chính `/` và trang kiểm tra catalog `/admin/live` cùng đọc public release; `/admin/live` dành cho kiểm tra cấu hình.

## 1. Chuẩn bị và mở admin

Máy đã kiểm tra bằng **Node.js 24.13.1**. Backend dùng module built-in `node:sqlite` và `DatabaseSync`; Node phải có module này. Kiểm tra trong PowerShell:

~~~powershell
node --version
node -e "console.log(typeof require('node:sqlite').DatabaseSync)"
~~~

Lệnh thứ hai cần in `function`. Node có thể in cảnh báo SQLite experimental; cảnh báo riêng này không có nghĩa demo đã lỗi. Nếu module không tồn tại, dùng Node 24 tương thích rồi kiểm tra lại. Không cần cài một package SQLite riêng để chữa thiếu runtime.

Tại thư mục project, cài dependencies từ lockfile nếu máy chưa có:

~~~powershell
npm ci
npm run dev:admin
~~~

Hoặc mở file **OPEN_VINUT_ADMIN.bat** trong thư mục project. Giữ terminal đang chạy, rồi mở:

- Admin: [http://localhost:3100/admin](http://localhost:3100/admin)
- Trang kiểm tra dữ liệu đã phát hành: [http://localhost:3100/admin/live](http://localhost:3100/admin/live)

Launcher chạy Next.js cổng **3100** và API Node cổng **3010**, chỉ bind loopback. Next dùng `.next-admin` và proxy cùng origin `/api/*`, giúp cookie/private media hoạt động trong preview. Cổng 3000 của website đang làm ở chat khác có thể chạy song song. Nhấn **Ctrl+C** để dừng launcher và hai process; chờ process kết thúc trước khi sao lưu.

Nếu cổng đang được dùng, đặt đủ web port, API port và API URL cho một phiên PowerShell:

~~~powershell
$env:ADMIN_WEB_PORT = '3101'
$env:ADMIN_API_PORT = '3011'
$env:ADMIN_API_URL = 'http://127.0.0.1:3011'
npm run dev:admin
~~~

Launcher tự đặt origin allowlist theo web port khi chưa được cấu hình. Nếu tự đặt `ADMIN_ALLOWED_ORIGINS`, các origin phải khớp URL dùng trong browser. Demo local thường không cần `NEXT_PUBLIC_ADMIN_API_URL`; giữ proxy cùng origin để session và texture private dùng đúng cookie.

## 2. Thiết lập tài khoản

Lần đầu database chưa có user, `/admin` hiện màn thiết lập owner. Nhập email và mật khẩu từ **12 đến 256 ký tự**. Không có mật khẩu mặc định. Owner có quyền chỉnh sửa, upload, phát hành và khôi phục phiên bản.

Các lần chạy sau đăng nhập bằng tài khoản đó; dữ liệu giữ sau restart. Session có thời hạn 8 giờ, có nút đăng xuất. Đăng nhập sai nhiều lần bị giới hạn; chờ theo thông báo rồi thử lại.

Demo chưa có giao diện mời Editor, đổi/reset mật khẩu hoặc MFA. Nếu quên mật khẩu, cần thao tác quản trị offline có sao lưu; không xóa database để “reset” vì sẽ mất catalog và lịch sử. Không chia sẻ database/backup chứa tài khoản và session cho người không cần quyền quản trị.

## 3. Hiểu dữ liệu khởi tạo

Database mới có các nhóm Alu can, Glass bottle, PP bottle, PET bottle, Other; sáu quy cách lon 180 ml, 250 ml short, 250 ml sleek, 320 ml, 330 ml, 500 ml; loại nước gồm các danh mục đang có và Aloe Vera; bốn Flavor demo và sáu model lon thật đã nhập registry.

Dòng **Juice 30%** ban đầu đang ẩn. Model seed chưa có poster và chưa có label artwork được gán; chưa có sản phẩm public. Vì vậy lần đầu `/admin/live` báo chưa có bản phát hành là đúng. Không tự phát hành tất cả model × hương hoặc coi demo là sản phẩm đã duyệt.

Seed chỉ chạy khi database còn trống. Chạy lại chương trình không ghi đè dữ liệu đã nhập; dữ liệu website CSS demo cũ không tự migrate.

## 4. Tạo sản phẩm qua tám module

### Type of Drink

Tạo/chọn loại nước như Juice, Energy Drink, Aloe Vera. Đây là danh mục, không phải tên button dòng sản phẩm. Có thể thêm, đổi tên và thứ tự.

### Packaging List

Chọn nhóm rồi thêm quy cách. Nhập dung tích số riêng với kiểu dáng; 250 ml short và sleek là hai record khác nhau. Thêm Glass/PP/PET/Other không tự tạo hình hoặc model; upload tài nguyên tương ứng ở bước sau.

### Flavor Data

Nhập tên/ngắn, mô tả, màu nền/nhấn/chữ, mã icon hỗ trợ và thumbnail. Ảnh đại diện dùng vai trò thumbnail. Mở kho ảnh trang trí của flavor để thêm nhiều record fruit, leaf hoặc splash; vai trò asset phải đúng với role của pool.

Pool đủ ảnh chọn không lặp; ít ảnh được tái dùng; pool fruit/leaf rỗng bỏ phần trang trí đó. Nếu chưa gán splash riêng, preset nước gốc `water-splash-user.webp` vẫn được giữ. Ảnh giữ nguyên màu gốc, không tự xóa nền; ưu tiên PNG/WebP trong suốt cho trái cây/lá/splash.

### Product Display

Tạo dòng sản phẩm, Type of Drink, tên button và thứ tự. Ví dụ Juice 30% khác với dung tích 330 ml. Mỗi dòng có các slot bao bì; chỉnh tên nút, thứ tự, chế độ 3D/2D/auto, hương mặc định và bật/tắt. Vị trí nhỏ đứng trước, xếp trái sang phải rồi xuống hàng.

Giữ dòng ẩn trong khi nhập thiếu dữ liệu, hoặc bật rồi chạy preflight để xem phần cần bổ sung. Một loại nước có thể chứa nhiều dòng sản phẩm.

### Label Library

Upload artwork vai trò label; chọn Type of Drink và hương nếu nhãn chỉ dùng cho một hương. Thêm các quy cách tương thích cùng layout/UV profile, ví dụ **can-wrap-v1** cho sáu lon hiện có. Cùng dung tích không có nghĩa dùng chung nhãn được. Nhãn thật phải được kiểm tra trên model trước khi phát hành.

### 3D Packaging

Chọn GLB và quy cách; upload **poster vai trò poster**; nhập profile và semantic material slots theo tên mesh/material có thật trong GLB. Model seed đã có mapping body/tab/label. Orientation dùng radian. Khai báo tên material sai bị chặn; preview vẫn cần kiểm tra mặt trước, chiều nhãn, UV/seam và tỉ lệ.

Poster được upload thủ công; hệ thống chưa tự chụp poster hoặc convert `.blend`. Xuất nguồn thành GLB tối ưu bằng pipeline offline trước khi tải lên.

### 3D Display

Chọn dòng → bao bì → flavor → model → label. Danh sách lọc theo bao bì, Type of Drink, hương và profile. Nhập tên/mã/mô tả, chọn bật cấu hình và có tạo/cập nhật nút bao bì hay không. Preview desktop/mobile, xoay model và dùng **Đổi bộ ảnh** để kiểm tra pool flavor. Lưu nháp.

Lưu composer gồm nhiều bước variant → display → slot. Nếu có lỗi giữa chừng, UI báo phần dữ liệu đã lưu; tải lại, kiểm tra catalog rồi chỉnh tiếp. Khi đổi tổ hợp của một display cũ, kiểm tra variant/slot/default cũ có còn cần dùng hay nên tắt để không gây lỗi preflight.

### 2D Display

Ở tab **Kho hình / render 2D**, nhập tên, bao bì, Type of Drink, hương tùy chọn, ảnh chính vai trò image-2d, gallery và mô tả. Ảnh là render/artwork hoàn thiện; hệ thống không tự ghép label vào ảnh.

Quay lại tab cấu hình, chọn dòng/bao bì/flavor và ảnh đúng sản phẩm; nhập alt text. Chọn chế độ slot 2D nếu sản phẩm chưa có 3D. Luồng này không yêu cầu model GLB hoặc label texture 3D.

## 5. Upload và tài nguyên

Upload phải thực sự lưu file và metadata mới báo thành công. Ảnh được kiểm tra, giải mã, tự giảm kích thước pixel theo vai trò và chuyển sang WebP trước khi lưu theo checksum bất biến. Giao diện báo “Đang tải và tối ưu ảnh” trong quá trình này; khi xong sẽ hiện định dạng, chiều rộng × chiều cao và dung lượng của file đã tối ưu.

| File | Giới hạn v1 |
|---|---|
| PNG/JPEG/WebP tĩnh | 20 MB, mỗi chiều tối đa 8192 px, tối đa 32 triệu pixel |
| GLB 2.0 tự chứa | 30 MB, tối đa 250.000 tam giác, JSON 4 MB; meshes tĩnh |

| Vai trò ảnh | Cạnh dài tối đa sau tối ưu |
|---|---|
| Artwork nhãn (`label`) | 2.048 px |
| Ảnh đại diện (`thumbnail`) | 512 px |
| Icon | 256 px |
| Trái cây, lá, splash, poster, ảnh/render 2D | 1.600 px |

Các giới hạn nguồn ở bảng đầu vẫn được kiểm tra trước khi chuyển đổi. Ảnh giữ tỷ lệ và vùng trong suốt, không bị cắt, thêm viền hoặc phóng lớn nếu nhỏ hơn giới hạn; hướng ảnh theo EXIF được chuẩn hóa. Đây là thay đổi số pixel của file, không thay tỷ lệ hay kích thước vật thể trong cảnh 3D. Ví dụ ảnh trái cây 3.000 × 2.000 px trở thành khoảng 1.600 × 1.067 px; ảnh 800 × 600 px giữ nguyên số pixel và được mã hóa WebP. Kích thước có thể lệch một pixel do làm tròn tỷ lệ.

Ảnh tải mới được lưu là WebP; MIME, dimensions, bytes và checksum đều mô tả file WebP được phục vụ. Record/file đã có không tự bị chuyển đổi. Hãy giữ bản nguồn chất lượng cao riêng nếu cần dùng lại; kho demo lưu bản đã tối ưu. Ảnh fruit/leaf/splash có alpha được tính `imageBounds` để hỗ trợ framing, nhưng file vẫn giữ toàn bộ canvas và không tự xóa nền.

Không nhận SVG/AVIF/ảnh động, animation GLB, sparse accessor, glTF external texture, KTX2 hoặc source `.blend`/OBJ. GLB giữ nguyên nội dung, không tự giảm polygon hay tạo poster. File ready nghĩa là ảnh đã giải mã/chuyển đổi thành công hoặc GLB đã qua kiểm tra cấu trúc bounded; không chứng nhận artwork/UV. Cần preview để duyệt nội dung. Nếu ảnh lỗi giải mã/tối ưu, upload trả lỗi và không tạo record ready.

Không sửa hoặc ghi đè file trong `data/admin/media` bằng tay. Muốn thay artwork, upload phiên bản mới và chọn lại liên kết. Hai lần upload cùng nội dung có thể dùng cùng checksum file nhưng vẫn là các media record riêng. Các file nguồn Blender nằm ngoài namespace public.

## 6. Lưu nháp, phát hành, khôi phục

1. Lưu dữ liệu ở từng module. Chưa thay đổi active release.
2. Bật dòng, slot và variant cần hiển thị; chọn default đúng slot/mode.
3. Mở **Phát hành → Kiểm tra dữ liệu**. Sửa lỗi chặn; kiểm tra các cảnh báo/artwork.
4. Nhập ghi chú rồi owner chọn **Xuất bản bản nháp** và xác nhận.
5. Mở trang chính `/`, thử nút dòng trong BEST SELLER và các hương; kiểm tra slot/bao bì chi tiết trên `/admin/live`. Trang tự kiểm tra public release mỗi 30 giây khi đang hiển thị, hoặc khi quay lại tab; reload cũng lấy bản mới.
6. Nếu cần, chọn release cũ trong lịch sử rồi **Dùng lại phiên bản này**. Rollback giữ nguyên bản nháp hiện tại.

Nếu dữ liệu đổi sau preflight hoặc có người khác chỉnh sửa, server có thể trả conflict; tải lại và kiểm tra trước khi retry. Publish kiểm tra cả file/hash trên disk; lỗi không chuyển con trỏ khỏi release cũ. Snapshot public chỉ chứa graph reachable đã được kiểm tra; kho nháp chưa dùng không tự xuất hiện public.

Trang chính đọc `/api/public/v1/catalog` và media của release qua proxy cùng origin. BEST SELLER hiển thị dòng đang bật `visible` theo thứ tự của Product Display; chọn dòng mở bao bì/hương mặc định hợp lệ. Banner text quảng cáo trên navigation hoạt động độc lập. Mô hình/nhãn, màu/icon và collection/search lấy từ cùng catalog. Lưu nháp chưa đổi trang chính. Khi đổi release, các ID lựa chọn còn hợp lệ được giữ; ID bị gỡ sẽ về slot/default hợp lệ. Lỗi refresh giữ bản đã tải và hiện thông báo.

**GitHub Pages:** chạy `npm run catalog:export` sau khi xuất bản, rồi build/deploy theo pipeline hiện có. Export đọc SQLite ở chế độ read-only, chỉ lấy active release và media reachable; không xuất nháp/tài khoản/session. `public/catalog/current.json` và `public/catalog/media/` là dữ liệu công khai, cần đưa cùng mã nguồn vào bản deploy. Snapshot này không phải backup database. Không tự export hay deploy khi bấm publish local; site Pages đang chạy chỉ đổi khi deploy snapshot mới.

Nếu dùng backend khác (ví dụ Cloudflare), cấu hình `NEXT_PUBLIC_ADMIN_API_URL` và origin/CORS tương ứng. Biến GitHub Actions cùng tên được nhận từ repository variables; khi để trống, build Pages dùng snapshot tĩnh. Nếu backend local chưa chạy lúc tải lần đầu, trang có thể dùng snapshot public; refresh lỗi sau đó giữ dữ liệu đang xem. API trả 4xx hoặc schema sai không được che bằng snapshot cũ. Xuất bản trong admin chưa có nghĩa triển khai hosting ngoài máy.

## 7. Sao lưu và khôi phục

Dữ liệu mặc định:

~~~text
data/admin/
  catalog.sqlite          # nháp, release, tài khoản/session/audit
  catalog.sqlite-wal      # có thể có khi dùng WAL
  catalog.sqlite-shm      # có thể có
  media/<checksum>.<ext>  # file đã upload
~~~

Thư mục này bị Git ignore; Git commit/push mã nguồn không sao lưu catalog. Nếu đặt `ADMIN_DATA_DIR`, sao lưu thư mục đó thay cho đường dẫn mặc định.

**Sao lưu offline:** dừng cả Next/admin API, chờ process kết thúc, copy toàn bộ thư mục data/admin vào thư mục backup có ngày giờ. Bao gồm mọi file SQLite/WAL/SHM còn tồn tại và toàn bộ media; không copy riêng catalog.sqlite trong khi API đang ghi. Giữ kèm bản mã nguồn/dependencies lockfile và asset seed `public/models`, `public/assets`, môi trường/decoder đang dùng. Media seed trỏ vào public nên chỉ backup data/admin chưa đủ cho một máy hoàn toàn mới.

**Khôi phục:** dừng demo, sao lưu thêm trạng thái hiện tại, khôi phục toàn bộ folder từ cùng một thời điểm và dùng phiên bản mã nguồn tương ứng. Khởi động lại, đăng nhập, kiểm tra nháp/active release/file và chạy preflight. Không trộn DB của một backup với media của backup khác. Chưa có nút restore/import/export hoặc công cụ migration tự động trong UI.

Backup có dữ liệu tài khoản/session; lưu trong nơi được bảo vệ. Demo chưa có backup tự động, lịch retention hoặc kiểm thử disaster recovery production; cần tổ chức việc này trước khi vận hành nhiều người.

## 8. Chuyển hosting hoặc database về sau

CatalogRepository và schemaVersion là điểm thay adapter. SQLite hiện lưu catalog nháp/release dưới dạng JSON graph đã validate, không có SQL table/FK riêng cho mỗi entity. Chưa có exporter/importer/migrations provider; không xem việc copy JSON vào database khác là chuyển đổi đã hoàn thành.

Khi chọn Cloudflare hoặc host khác, cần quyết định runtime, DB/object storage, auth/session, URLs/CORS/cache, migration IDs/revisions/snapshots/file hashes và rollback; thử trên staging cùng bản backup. Nếu host không có disk bền vững, không lưu upload vào filesystem tạm. File seed và retained release phải còn đọc được sau migration. Provider chưa được chọn, không có hành động deploy ngoài máy trong demo hiện tại.

## 9. Xử lý lỗi thường gặp

- **Không kết nối backend:** kiểm tra terminal launcher còn chạy, cổng/origin đúng và Node có node:sqlite. Chỉ chạy `npm run dev` trang chính không tự chạy API.
- **Module SQLite không có:** kiểm tra runtime bằng lệnh ở mục 1; dùng Node 24 đã xác minh tương thích.
- **Port đang dùng:** dừng instance cũ hoặc đổi cả web/API port + ADMIN_API_URL như mục 1.
- **Nhãn/model không có trong selector:** kiểm tra lifecycle, bao bì, drink/flavor và layout profile; selector chỉ hiện tổ hợp phù hợp.
- **Upload bị từ chối:** kiểm tra format thật, vai trò, dung lượng/kích thước; GLB phải self-contained và tối ưu. Đổi đuôi file không chuyển format.
- **Nhãn lệch/không hiện:** kiểm tra semantic slot đúng tên mesh/material và artwork UV profile; xem trước xoay 360°.
- **Preflight thiếu poster/thumbnail:** upload đúng vai trò rồi chọn vào record. Model poster cần vai trò poster; flavor thumbnail cần thumbnail.
- **Lỗi revision hoặc publish conflict:** tải lại dữ liệu, xem thay đổi rồi lưu/kiểm tra lại; không ghi đè bản người khác âm thầm.
- **File/checksum không còn đúng:** upload lại phiên bản mới; nếu rollback không được, khôi phục asset từ backup tương ứng. Không ghi đè file release bằng tay.
- **/admin/live chưa có dữ liệu:** seed group đang ẩn/chưa publish hoặc chưa có slot/render hoàn chỉnh; đi theo workflow trên.

Kiểm tra kỹ thuật khi đổi code:

~~~powershell
npm run test:admin
npm run test:catalog
npm run typecheck
npm run lint
npm run build
~~~

Các suite viewer/background/accents/environment/water được chạy khi thay tích hợp có liên quan. Launcher `dev:admin` cho phép origin của admin (mặc định 3100) và trang chính (3000); có thể đổi cổng trang chính bằng `STOREFRONT_WEB_PORT`. Đối chiếu kết quả browser/build cuối cùng trong báo cáo bàn giao; manual artwork preview vẫn cần người vận hành duyệt.
