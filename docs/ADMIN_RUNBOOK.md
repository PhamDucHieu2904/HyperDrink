# VINUT Admin — Hướng dẫn chạy và vận hành demo local

Ngày: 02/10/2026. Demo chạy trên máy này, cùng repository website. Chưa deploy Cloudflare, Supabase hoặc dịch vụ bên ngoài. Trang chính `/` và trang kiểm tra catalog `/admin/live` cùng đọc public release; `/admin/live` dành cho kiểm tra cấu hình.

### Các hàng sản phẩm trong Collection

Trong **Product Display**, mỗi dòng sản phẩm có thiết lập **Hiển thị hàng trong Collection**, **Tên nhóm Collection** và **Thứ tự hàng Collection**. Tên nhóm để trống sẽ lấy tên loại nước. Thiết lập này độc lập với button Best seller; dữ liệu cũ tiếp tục hiện theo thứ tự và trạng thái cũ. Lưu nháp rồi phát hành để cập nhật trang chính. Nhóm chưa có sản phẩm đang bật sẽ chưa xuất hiện.

Collection trình bày một hàng mỗi nhóm, có nút Previous/Next riêng; số thẻ mỗi lượt tự giảm theo chiều rộng màn hình. **See all products** mở `/products/`, với bộ lọc loại nước, dòng sản phẩm, bao bì và tìm kiếm. Thẻ dùng ảnh 2D hoàn chỉnh nếu có; các cấu hình 3D tạo ảnh lon từ model và nhãn đã ghép trong trình duyệt. Nếu WebGL hoặc model không tải được, thẻ dùng ảnh trái cây tương ứng, không hiển thị nhãn trải phẳng. Ảnh 3D được tạo khi thẻ gần màn hình, dùng chung một renderer và cache có giới hạn.

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

### Kho tài nguyên → Label

Upload artwork vai trò label; chọn Type of Drink và hương nếu nhãn chỉ dùng cho một hương. Thêm các quy cách tương thích cùng layout/UV profile, ví dụ **can-wrap-v1** cho sáu lon hiện có. Cùng dung tích không có nghĩa dùng chung nhãn được. Nhãn thật phải được kiểm tra trên model trước khi phát hành.

### Kho tài nguyên → 3D model

Chọn GLB và quy cách; upload **poster vai trò poster**; nhập profile và semantic material slots theo tên mesh/material có thật trong GLB. Model seed đã có mapping body/tab/label. Orientation dùng radian. Khai báo tên material sai bị chặn; preview vẫn cần kiểm tra mặt trước, chiều nhãn, UV/seam và tỉ lệ.

Poster được upload thủ công; hệ thống chưa tự chụp poster hoặc convert `.blend`. Xuất nguồn thành GLB tối ưu bằng pipeline offline trước khi tải lên.

### 3D Display

Danh sách chia khu vực theo tên nút Best Seller (`buttonLabel` của Product Display), với bộ lọc Best Seller, Active On/Off và tìm kiếm theo tên, hương, bao bì hoặc mã sản phẩm. Mỗi thẻ có công tắc Active, nút **Sửa** và **Xóa**; bật/tắt được lưu ngay vào bản nháp. Xóa cần xác nhận và chỉ gỡ cấu hình đang chọn; model, nhãn, ảnh, pool hương và cấu hình 2D/3D còn lại được giữ nguyên.

Chọn **Tạo hiển thị 3D** hoặc **Sửa** để mở panel. Chọn dòng → bao bì → flavor → model → label; nhãn trong panel được lọc theo bao bì, Type of Drink, hương và profile. Nhập tên/mã/mô tả, chọn bật cấu hình và có tạo/cập nhật nút bao bì hay không. Preview desktop/mobile, xoay model và dùng **Đổi bộ ảnh** để kiểm tra pool flavor. Variant, display và slot được lưu trong một transaction; nếu lỗi, toàn bộ thao tác được hoàn tác và nội dung nhập vẫn giữ trong panel.

Khi sửa flavor và chuyển cấu hình sang một tổ hợp sản phẩm khác, hệ thống cập nhật cả tổ hợp cũ và mới. Tổ hợp cũ được giữ trong bản nháp nhưng tự tắt nếu không còn cấu hình phù hợp với chế độ slot; hương mặc định được cập nhật nếu cần. Nếu còn cấu hình 2D/3D phù hợp, tổ hợp cũ vẫn được giữ bật. Các bản phát hành trong lịch sử không thay đổi.

Khi tắt/xóa, sản phẩm được ẩn nếu không còn cấu hình bật phù hợp với chế độ slot; chế độ auto giữ fallback 2D. Default tự chuyển sang hương còn bật, ưu tiên cấu hình hợp lệ. Nếu tắt hết hương, default về rỗng và khu vực đó được bỏ khỏi bản công khai; bật lại sẽ khôi phục lựa chọn trong slot/dòng cũ. Tổ hợp sản phẩm được giữ để có thể tạo lại cấu hình. Website chỉ đổi sau khi phát hành; vẫn cần ít nhất một dòng có nội dung để phát hành. Bật/tắt/xóa kiểm tra toàn bộ phiên bản bản nháp và ghi audit trong transaction để tránh ghi đè thay đổi từ tab khác. Khi đổi tổ hợp của một display cũ, kiểm tra variant/slot/default cũ có còn cần dùng hay nên tắt.

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

Các danh mục, slot bao bì, pool ảnh và kho hình 2D có nút **Xóa** bên cạnh thao tác lưu trữ. Xóa gỡ mục khỏi bản nháp; hộp xác nhận liệt kê các mục sở hữu bị xóa kèm và những liên kết sẽ được bỏ chọn. Xóa Product Display gỡ các slot, tổ hợp sản phẩm và display của dòng đó; xóa tổ hợp gỡ display của tổ hợp; xóa hương/ảnh pool gỡ các assignment tương ứng. Các model, nhãn và file dùng chung không bị xóa dây chuyền. Liên kết còn lại được bỏ chọn, tăng revision và ghi audit cùng transaction; không lưu ID trỏ tới bản ghi đã mất. Bản nháp thiếu dữ liệu vẫn xóa được, nhưng preflight chặn phát hành cho đến khi các cấu hình còn sử dụng được hoàn thiện.

Lịch sử giữ tối đa **10 bản phát hành, tính cả bản đang sử dụng**. Khi đủ 10 (hoặc dữ liệu cũ đã vượt 10), owner cần chủ động xóa các bản cũ không cần thiết để còn dưới 10 trước khi phát hành thêm. Không tự xóa phiên bản để lấy chỗ. Giới hạn được kiểm tra trong transaction ở backend; retry của lần phát hành đã thành công và rollback không tạo thêm bản. UI hiển thị số bản/10 và chỉ cho xóa bản không đang sử dụng. Xóa lịch sử gỡ snapshot đó và khả năng rollback về nó; draft, active release và các tài nguyên vẫn được giữ.

Lịch sử là backup cho **dữ liệu đã được đưa vào bản phát hành**, không sao lưu toàn bộ kho nháp. Mục chưa từng phát hành không có bản sao trong lịch sử; không dùng Xóa thay cho Lưu trữ nếu còn muốn giữ bản nháp của mục đó. Dùng lại phiên bản cũ khôi phục website từ snapshot, giữ nguyên bản nháp hiện tại; sao lưu toàn bộ DB và media theo mục 7 để bảo vệ dữ liệu quản trị chưa phát hành.

1. Lưu dữ liệu ở từng module. Chưa thay đổi active release.
2. Bật dòng, slot và variant cần hiển thị; chọn default đúng slot/mode.
3. Mở **Phát hành → Kiểm tra dữ liệu**. Sửa lỗi chặn; kiểm tra các cảnh báo/artwork.
4. Nhập ghi chú rồi owner chọn **Xuất bản bản nháp** và xác nhận.
5. Mở trang chính `/`, thử nút dòng trong BEST SELLER và các hương; kiểm tra slot/bao bì chi tiết trên `/admin/live`. Trang tự kiểm tra public release mỗi 30 giây khi đang hiển thị, hoặc khi quay lại tab; reload cũng lấy bản mới.
6. Nếu cần, chọn release cũ trong lịch sử rồi **Dùng lại phiên bản này**. Rollback giữ nguyên bản nháp hiện tại.

Sau lần kiểm tra đầu tiên, lưu thay đổi từ panel sửa lỗi trong màn hình **Phát hành** sẽ tự chạy lại preflight. Kết quả của bản nháp cũ được bỏ qua; nút phát hành chờ kết quả của dữ liệu mới. Nếu kiểm tra thất bại vì kết nối, bấm **Kiểm tra dữ liệu** để thử lại. Hương vị có ảnh trái cây hợp lệ trong pool không cần chọn thêm thumbnail chỉ để hết cảnh báo; pool chỉ có lá, ảnh tắt hoặc file chưa sẵn sàng vẫn được kiểm tra như bình thường.

Nếu dữ liệu đổi sau preflight hoặc có người khác chỉnh sửa, server có thể trả conflict; tải lại và kiểm tra trước khi retry. Publish kiểm tra cả file/hash trên disk; lỗi không chuyển con trỏ khỏi release cũ. Snapshot public chỉ chứa graph reachable đã được kiểm tra; kho nháp chưa dùng không tự xuất hiện public.

Trang chính mặc định đọc `/catalog/current.json` và các ảnh công khai cùng origin, nên chạy độc lập khi API admin tắt hoặc chưa đăng nhập. Server admin tự đồng bộ bản tĩnh khi khởi động với active release, sau khi xuất bản và sau khi khôi phục phiên bản. BEST SELLER hiển thị dòng đang bật `visible` theo thứ tự của Product Display; chọn dòng mở bao bì/hương mặc định hợp lệ. Mô hình/nhãn, trái cây/lá, màu/icon và collection/search lấy từ cùng catalog. Lưu nháp chưa đổi trang chính. Khi đổi release, các ID lựa chọn còn hợp lệ được giữ; ID bị gỡ sẽ về slot/default hợp lệ. Lỗi refresh giữ bản đã tải và hiện thông báo.

**GitHub Pages:** sau khi xuất bản/khôi phục, commit cả `public/catalog/current.json` và mọi file mới trong `public/catalog/media/`, rồi push/build/deploy theo pipeline hiện có. Publish local tự chuẩn bị hai phần này; Pages chỉ đổi khi deploy bản Git mới. `npm run catalog:export` vẫn dùng được để xuất thủ công hoặc khắc phục cảnh báo đồng bộ. Export đọc SQLite ở chế độ read-only, chỉ lấy active release và media reachable; không xuất nháp/tài khoản/session. Snapshot này không phải backup database. Nếu xuất file thất bại, UI báo bản DB đã cập nhật nhưng bản độc lập chưa sẵn sàng; sửa file tài nguyên rồi export lại trước khi push. Kiểm thử catalog trong CI kiểm tra checksum và file của mọi ảnh được tham chiếu, kể cả pool trái cây/lá.

Nếu dùng backend khác (ví dụ Cloudflare), cấu hình `NEXT_PUBLIC_ADMIN_API_URL` và origin/CORS tương ứng. Biến GitHub Actions cùng tên được nhận từ repository variables; khi để trống, cả build local và Pages dùng snapshot tĩnh. Khi đã cấu hình API, refresh lỗi giữ dữ liệu đang xem; API trả 4xx hoặc schema sai không bị che bằng snapshot cũ. Xuất bản trong admin chưa có nghĩa triển khai hosting ngoài máy.

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

Backup có dữ liệu tài khoản/session; lưu trong nơi được bảo vệ. Giới hạn 10 snapshot phát hành không thay thế backup toàn bộ dữ liệu. Demo chưa có backup offline tự động hoặc kiểm thử disaster recovery production; cần tổ chức việc này trước khi vận hành nhiều người.

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
- **Preflight thiếu poster/thumbnail:** upload đúng vai trò rồi chọn vào record. Model poster cần vai trò poster; ảnh đại diện hương vị có thể dùng mọi loại ảnh, trừ file GLB.
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


## 10. Kho tài nguyên chung, ảnh đại diện và icon

- **Màu nhấn** vẫn được dùng cho ánh sáng, viền và các bề mặt/thẻ sản phẩm. Màu nền và màu chữ có nhiệm vụ riêng.
- **Flavor Data → Ảnh đại diện → Chọn file** cho phép chọn mọi loại ảnh sẵn sàng: Label, Fruit, Leaf, Splash, Icon, Poster hoặc 2D model. Dùng bộ lọc loại ảnh và tìm tên; GLB không phải ảnh đại diện. Khi tải file mới, loại đang lọc quyết định vai trò lưu (mặc định là ảnh đại diện khi chọn tất cả).
- Nhóm **Tài nguyên** chỉ còn **Kho tài nguyên**. Lọc riêng 3D model, Label, Fruit image, Leaf image, Splash, Icon, 2D model, Poster 3D hoặc ảnh đại diện; kết hợp tìm tên file / cấu hình, trạng thái và phân trang. Bộ lọc loại file thực sự lọc danh sách; khi chọn Tất cả, phần Loại file tải lên chỉ quyết định vai trò của file mới.
- Một file có thể có nhiều cấu hình nhãn/model bên dưới. Mở tên cấu hình để sửa, tạo thêm hoặc xóa cấu hình riêng với file. Cấu hình chưa có file hoặc liên kết sai loại vẫn xuất hiện để sửa; không mất dữ liệu khi gộp giao diện. Các URL `module=labels`, `models3d`, `icons` cũ tự mở đúng bộ lọc của kho chung.
- **Flavor Data → Biểu tượng nền** có hai nguồn: bộ vector có sẵn hoặc file từ **Kho tài nguyên → Icon**. `iconId` liên kết tới media vai trò `icon`, dùng lại trong nhiều hương vị; `icon` giữ biểu tượng dự phòng. Những bản phát hành cũ không có `iconId` vẫn đọc được.
- **Kho tài nguyên → Icon** nhận PNG/JPG/WebP và SVG tĩnh, tự tạo WebP tối đa 256 px; giữ tỷ lệ và alpha. SVG phải tự chứa, có width/height hoặc viewBox; script, HTML nhúng và URL ngoài bị từ chối. Bản SVG nhập không được phục vụ trực tiếp.
- Biểu tượng vừa ô nền bằng cách thu tỷ lệ đồng nhất theo cạnh dài, không ép vuông/cắt ảnh. Ô xem trước và danh sách Flavor Data dùng cùng biểu tượng đã chọn. Nền trang chính và lớp khúc xạ nước dùng chung tile đã ghép.
- Lưu hương vị vào nháp rồi kiểm tra/phát hành như các dữ liệu khác. Chỉ icon được hương vị trong bản phát hành sử dụng mới xuất vào public catalog; bản xuất tĩnh chứa WebP tương ứng, đọc được không cần đăng nhập và hỗ trợ base path GitHub Pages.
- Khi xóa icon khỏi nháp, liên kết `iconId` được bỏ và hương vị trở lại biểu tượng có sẵn; lịch sử phát hành giữ dữ liệu theo cơ chế backup hiện có.

Có SVG lá dọc mẫu tại `docs/samples/leaf-symbol.svg` để thử import và kiểm tra tỷ lệ.

## 11. Dịch tự động nội dung từ catalog

- Text giao diện dùng bộ dịch chuẩn của tám ngôn ngữ. Text công khai từ data (tên/mô tả dòng, hương vị, sản phẩm, loại nước, bao bì, button và alt ảnh 2D) dùng API **Translator** và **LanguageDetector** chính thức có sẵn trong Chrome desktop. Không cần API key hoặc dịch vụ trả phí; văn bản không được gửi đến API dịch từ xa.
- Chọn EN/FR/ZH/ES/AR/RU/KO/DE để dịch theo ngôn ngữ tương ứng. Các model ngôn ngữ được Chrome tải lần đầu khi người dùng bấm chọn; menu ngôn ngữ có trạng thái chuẩn bị/dịch và nút thử lại. EN mặc định cũng dịch mô tả tiếng Việt sang Anh. Text gốc vẫn hiển thị trong lúc chờ hoặc nếu tải/dịch lỗi.
- Dịch chỉ tạo bản dữ liệu dùng để render, không sửa bản nháp, database hoặc lịch sử phát hành. Giữ nguyên VINUT, dung tích, tỷ lệ phần trăm, ID, mã sản phẩm, đường dẫn file, màu sắc và liên kết. Text in trong artwork nhãn vẫn là ảnh gốc.
- Cache theo ngôn ngữ đích + text gốc trong localStorage, tối đa 1.000 mục / 250.000 ký tự. Sửa text nguồn tự loại cache cũ cho text đó. Khi đổi ngôn ngữ/bản phát hành, kết quả đang chạy bị hủy khỏi giao diện để tránh text của lựa chọn trước.
- Hoạt động với bản tĩnh GitHub Pages và bản dùng API. API Chrome hiện chưa hỗ trợ mobile và không có trên mọi trình duyệt; các môi trường đó dùng bản dịch đã cache trên chính trình duyệt hoặc giữ text data gốc, còn UI vẫn dịch chuẩn. Menu ngôn ngữ hiển thị khả năng dịch của trình duyệt. Không tự gọi endpoint dịch không chính thức.
- Kiểm tra adapter bằng `npm run test:translation`, kho chung bằng `npm run test:resources`. Tài liệu API: https://developer.chrome.com/docs/ai/translator-api và https://developer.chrome.com/docs/ai/language-detection.
