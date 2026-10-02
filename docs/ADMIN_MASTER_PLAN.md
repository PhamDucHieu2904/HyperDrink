# VINUT Admin — Master plan và trạng thái triển khai

Ngày: 02/10/2026 · Phiên bản: 1.4 · Trạng thái: demo local và tích hợp main đã triển khai; hosting production chưa chọn.

Tài liệu này mô tả phạm vi admin, quyết định dữ liệu và mã nguồn hiện tại. Hướng dẫn sử dụng nằm trong [ADMIN_RUNBOOK.md](ADMIN_RUNBOOK.md). Phần “còn lại” là mục tiêu nâng cấp, không phải tính năng đã hoàn thành.

## 1. Mục tiêu và phạm vi

Admin quản lý Flavor, dòng sản phẩm/nút hiển thị, danh mục bao bì, loại nước, nhãn, model 3D, cấu hình 3D và hình/cấu hình 2D. Người vận hành tạo dữ liệu, xem trước, lưu nháp và phát hành mà không sửa code cho mỗi sản phẩm.

- Cùng repository Next.js hiện tại; giao diện quản trị tại /admin, component/CSS riêng.
- Kho dữ liệu và tài nguyên tách khỏi cấu hình sản phẩm hiển thị.
- ID ổn định, tên có thể đổi, revision kiểm tra chỉnh sửa đồng thời.
- Bản nháp không thay đổi bản đang phát hành. Phát hành tạo snapshot hoàn chỉnh.
- Tái sử dụng ProductViewer; geometry, nhãn và hương độc lập.
- Khoảng 10 dòng sản phẩm là dự kiến, không phải giới hạn kỹ thuật.
- Không bao gồm bán hàng, thanh toán, tồn kho hoặc scene editor 3D tổng quát.

**Vai trò khu vực đã xác nhận:** banner cạnh navigation chỉ quảng cáo các loại nước bằng text có animation. Vùng **BEST SELLER** lấy các Product Display Group đang `visible`, sắp theo `position` từ trái sang phải rồi trên xuống dưới; người vận hành dùng danh sách này để trưng bày dòng bán chạy hoặc mới ra mắt. Chọn dòng mở slot đầu tiên theo thứ tự và hương mặc định hợp lệ. Slot bao bì vẫn là cấu hình nội bộ của dòng và dùng trong `/admin/live`; trang chính không dùng vùng BEST SELLER để chọn dung tích. “Juice 30%” là tên dòng/nút, “330 ml” là dung tích riêng. Hai kiểu 250 ml short/sleek có ID khác nhau.

## 2. Trạng thái thực hiện

| Phần | Đã có trong demo | Phạm vi còn lại |
|---|---|---|
| Danh mục | Đủ tám module, tạo/sửa/lưu trữ, tìm kiếm và các kho dependency | Hoàn thiện UX theo nội dung thực, dirty tracking cho mọi form |
| Persistence | Node API, SQLite bền vững, disk media | Chưa chọn cloud DB/object storage; chưa có adapter migration provider |
| Tài khoản | Bootstrap owner một lần, login/logout, session server, quyền owner/editor, giới hạn thử login | Chưa có UI mời Editor/reset password/MFA hoặc audit viewer |
| Media | Kiểm tra nguồn; tự resize/chuyển ảnh WebP, tính alpha bounds; GLB bounded; hash và file bất biến | Không worker, tự optimize GLB, tạo poster hay chứng nhận UV |
| Display | Composer 3D/2D, product variant, optional slot, ảnh gallery, preview responsive | Lưu composer gồm nhiều request; lỗi partial save phải kiểm tra nháp |
| Release | Preflight, kiểm tra file/checksum, conflict/idempotency, snapshot/active pointer và rollback | Chưa có export/import UI, backup tự động, staging/CDN |
| Public renderer | / và /admin/live đọc active release, shared resolver và mode 3D/2D | Duyệt trực quan WebGL/artwork trên trình duyệt và hoàn thiện nội dung thực |
| Hosting | Demo localhost; giữ GitHub Pages hiện tại | Cloudflare có thể chọn sau; chưa deploy hoặc chọn Supabase/provider khác |

Seed ban đầu an toàn cho nháp, không tự công bố sản phẩm. Theo yêu cầu thử dữ liệu, demo hiện đã phát hành Juice 30% với slot 330 ml, Orange mặc định, 24 hương và nhãn thật. Chi tiết ở [JUICE30_DEMO.md](JUICE30_DEMO.md).

## 3. Kiến trúc thực tế

**Next.js + Node API cổng 3010 + SQLite + disk**, cùng repository. Admin Next chạy cổng 3100, build/cache .next-admin để giảm đụng cache chat trang chính. API và Next chỉ bind loopback.

~~~text
/admin tại localhost:3100
  → rewrite cùng origin /api/*
    → Node API 127.0.0.1:3010
      → validation/service → data/admin/catalog.sqlite
      → kiểm tra upload đồng bộ → data/admin/media/<sha256>.<ext>

Preflight → snapshot release → đổi active pointer bằng SQLite transaction

/admin/live → public catalog active release
            → shared resolver → ProductViewer / hình 2D

Trang chính / → public release API hoặc snapshot tĩnh → shared resolver
~~~

Contract: lib/catalog/contracts.ts. Business validation/tương thích: lib/catalog/validation.ts, compatibility.ts, service.ts. Resolver: lib/catalog/resolve.ts. Adapter local: lib/server/local-repository.ts. API handler: lib/server/admin-api.ts. Launcher: scripts/admin-server.cjs và scripts/dev-admin.cjs.

**SQLite hiện lưu catalog nháp trong một JSON graph đã kiểm tra; mỗi release là JSON snapshot bất biến.** User/session/login attempts/audit/publication/idempotency có bảng riêng. Các quan hệ entity được service kiểm tra, chưa phải bộ bảng SQL/FK cho từng entity. Transaction bảo vệ cập nhật và active pointer. Đây là adapter demo có chủ đích, cần quyết định giữ SQLite trên server bền vững hay migrate khi chọn production.

Chưa chọn hoặc tạo Supabase. Chủ dự án chưa có kế hoạch hosting; Cloudflare là khả năng về sau. GitHub Pages chỉ phục vụ static và không chạy Node API. Admin SPA có thể export nhưng chức năng đăng nhập/ghi/upload cần backend đang chạy. Nếu chuyển sang Cloudflare/serverless, cần adapter runtime/database/storage/auth phù hợp; không thể copy SQLite/disk hiện tại rồi coi là deployment hoàn chỉnh. Tham khảo [Next.js static export](https://nextjs.org/docs/app/guides/static-exports) và [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

## 4. Mô hình dữ liệu v1

Type of Drink là loại nước, ví dụ Juice, Energy Drink, Aloe Vera. Product Display Group là dòng/nút cụ thể; một loại Juice có thể có nhiều dòng. Packaging Category là loại/vật liệu; Packaging Variant là quy cách/dung tích/kiểu dáng. Product Variant là identity chung của dòng + bao bì + hương, dùng cho cả 3D và 2D.

| Collection trong CatalogData | Dữ liệu và quan hệ chính |
|---|---|
| drinkTypes | Tên, slug, mô tả, lifecycle, position |
| packagingCategories | Tên, viewerKind, position; seed Alu can/Glass/PP/PET/Other |
| packagingVariants | categoryId, volumeMl hoặc null, shape, position |
| flavors | Tên/ngắn, mô tả, accent/background/text color, mã icon, thumbnailId |
| flavorAssets | flavorId, mediaId, role fruit/leaf/splash, enabled, position |
| productGroups | drinkTypeId, tên/nội dung button, mô tả, visible, position |
| productVariants | groupId, packagingVariantId, flavorId, mã/mô tả, enabled |
| packagingSlots | groupId, packagingVariantId, regionKey, button, position, mode, defaultVariantId, enabled |
| media | role/status, URL/hash/storageKey, MIME/bytes/dimensions/imageBounds, error |
| labels | drinkTypeId, flavorId tùy chọn, mediaId, compatibilities bao bì + layoutProfile |
| models3d | packagingVariantId, GLB mediaId, posterId, layoutProfile, materialSlots, orientation |
| assets2d | packagingVariantId, drinkTypeId, flavorId tùy chọn, mediaId, galleryIds, mô tả |
| displays3d | productVariantId, modelId, labelId, enabled |
| displays2d | productVariantId, assetId, alt, enabled |

Tất cả record có ID, name, slug, lifecycle, revision và timestamps. API/repository kiểm tra schema và quan hệ. Không tự thêm field JSON tùy ý để né thiết kế nghiệp vụ. Kho preset ánh sáng/material, lịch sử revision riêng từng entity và metadata license/source đầy đủ chưa có; viewer đang dùng preset mặc định.

Quy tắc bắt buộc:

1. Product variant unique theo dòng + quy cách + hương trong v1; dùng lại khi tạo display 2D/3D.
2. Loại nước kế thừa từ group; đổi loại nước phải kiểm tra nhãn/ảnh lại.
3. Slot unique theo group + vùng + quy cách; vị trí trong vùng không trùng. Reorder có revision check và transaction.
4. Default variant phải thuộc đúng group/bao bì và có render phù hợp.
5. Một cấu hình 3D và một cấu hình 2D hoạt động cho mỗi variant.
6. Model đúng bao bì; label đúng drink/flavor nếu khóa hương, và đúng packaging/layout UV. Cùng ml không đủ chứng minh tương thích.
7. Model material slots phải trỏ tới tên mesh/material có trong GLB; slot label khai báo rõ.
8. 2D artwork đúng bao bì/drink/flavor; hệ thống không tự thay label trong ảnh đã render.
9. Slot mode 3d/2d/auto; auto ưu tiên 3D, dự phòng bằng Display2D của cùng variant. Poster dùng chung của model chỉ minh họa kiểu dáng, phải ghi rõ khi dùng thay cảnh 3D.
10. Lưu nháp có thể chưa đủ nội dung public, nhưng giá trị malformed/references sai bị chặn. Publish chỉ lấy graph reachable đã kiểm tra.

## 5. Tám module và workflow

Các module hiện điều hướng qua /admin?module=..., tránh tạo dynamic route ID không export được. Các kho có list/editor, MediaPicker, thông tin nơi dùng và archive. Composer/publishing có workspace riêng; chưa có mọi chức năng phân trang/nhân bản của bảng kho.

| Module | Chức năng v1 |
|---|---|
| Flavor Data | Màu/ghi chú/icon registry/thumbnail; pool nhiều fruit/leaf/splash theo vai trò |
| Product Display | Tên dòng, Type of Drink, thứ tự/visible; slot bao bì, tên nút/default/mode |
| Packaging List | Thêm/sửa category và quy cách, volume tách shape; 250 short/sleek độc lập |
| Type of Drink | Thêm Juice/Energy/Aloe Vera/... và sắp xếp/lưu trữ |
| Label Library | Artwork label, drink/flavor tùy chọn, nhiều packaging/profile tương thích |
| 3D Packaging | GLB, bao bì, poster upload, material slots và orientation/profile |
| 3D Display | Chọn group/packaging/flavor/model/label, nội dung, optional slot và preview |
| 2D Display | Kho ảnh/render có gallery + metadata; gán group/flavor/slot và alt text |

Luồng 3D:

1. Tạo hoặc chọn drink/packaging/flavor.
2. Thêm artwork trang trí vào pool flavor đúng vai trò.
3. Chọn model GLB, poster và label đúng packaging/profile; không chạy Blender trong request web.
4. Tạo/chọn Product Display group.
5. Composer chọn tổ hợp; kiểm tra preview desktop/mobile và bộ ảnh.
6. Lưu nháp; sửa slot/default/thứ tự/visible trong Product Display.
7. Preflight; sửa blocker; owner phát hành.
8. Mở /admin/live, kiểm tra lại sản phẩm; rollback nếu cần.

Luồng 2D có thể bỏ bước GLB/label: tạo ảnh hoàn thiện trong kho 2D, gán drink/packaging/flavor, chọn trong composer, nhập alt và mode 2D.

Composer lưu variant → display → optional slot bằng nhiều request. Nếu lỗi giữa chừng, phần trước có thể đã lưu; UI báo rõ và refresh dữ liệu. Transaction gộp toàn bộ thao tác là nâng cấp còn lại. Thay tổ hợp của display có thể giữ variant cũ trong nháp; kiểm tra slot/default và preflight để quyết định tiếp tục dùng hay tắt tổ hợp cũ.

## 6. Media và preview

Upload nhận multipart file + role có session, kiểm tra nội dung, tự tối ưu ảnh rồi lưu hash-key immutable. File lỗi trả lỗi, không tạo record ready giả. Ảnh ready đã được giải mã và mã hóa WebP thành công; GLB ready là **đã qua kiểm tra bounded cấu trúc**. Cả hai không xác nhận chất lượng artwork, UV hoặc giải mã Draco đầy đủ.

- Ảnh tĩnh PNG/JPEG/WebP: tối đa 20 MB, 8192 px mỗi chiều, 32 triệu pixel. PNG có checksum/chunk checks; JPEG/WebP có header/dimensions/container checks.
- GLB 2.0 tự chứa: tối đa 30 MB, 250.000 tam giác, JSON 4 MB; kiểm tra buffers/accessors/nodes/material refs, cây node không vòng và các extension được hỗ trợ.
- Không nhận SVG/AVIF/ảnh động, sparse accessor, animation GLB, external texture/KTX2, nguồn .blend/OBJ trong upload v1.
- Ảnh PNG/JPEG/WebP được auto-orient theo EXIF, chuyển sRGB, resize fit-inside không crop/padding/upsize và mã hóa WebP. Cạnh dài tối đa: label 2048 px, thumbnail 512 px, icon 256 px, fruit/leaf/splash/poster/image-2d 1600 px. Giữ alpha; label quality 90, các ảnh khác 82, alpha quality 100. Metadata/hash phản ánh file output; nguồn không lưu riêng trong demo.
- UI hiển thị trạng thái tải/tối ưu và kích thước, MIME, dung lượng thực sau khi lưu. Quy tắc này đổi pixel file, không tự đổi tỷ lệ hoặc scale ảnh trong scene. Record/file có sẵn được giữ nguyên.
- Tính alpha bounds cho fruit/leaf/splash có vùng trong suốt để dùng trong framing; không crop file hoặc tự xóa nền. GLB không tự optimize/convert; poster vẫn upload thủ công.
- Label dùng slots.label.baseColorMap; procedural demo palette không ghi đè artwork thật.
- GLB hiện có được giữ geometry/UV/PBR; PP giữ domain riêng và adapter viewer ánh xạ sang other.
- Preview tái sử dụng ProductViewer với loading/error/fallback; không viết renderer 3D thứ hai.
- Meta/version mới dùng checksum key, không ghi đè file của release cũ.

Pool flavor tách fruit/leaf/splash, chỉ chọn media ready/active đúng vai trò. Dedup file trùng trước shuffle, đủ ảnh thì không lặp, ít ảnh thì luân phiên. Pool fruit/leaf rỗng bỏ role đó; splash rỗng giữ preset nước dùng chung `water-splash-user.webp`, với transform, Hard Light và trạng thái bật/tắt gốc. Splash riêng được gán cho hương sẽ thay preset. Seed giữ ổn định khi render/xoay; nút Đổi bộ ảnh tạo seed mới. Trang chính và /admin/live dùng chung resolver, không dùng union bốn hương cố định.

Production còn lại: worker/job retry nếu cần conversion dài, kiểm tra GLB sâu, export metadata UV/bounds, chỉnh sửa ảnh/xóa nền, upload progress theo phần trăm, orphan file cleanup/retention và object storage/CDN.

## 7. Nháp, release, quyền

- Lưu nháp không chuyển active release; chỉ group visible/slot enabled/variant enabled và các dependency reachable được publish.
- Preflight kiểm tra schema/tương thích/default/mode/field bắt buộc và file/checksum trên disk.
- UI vô hiệu kết quả preflight nếu catalog đổi; server kiểm tra snapshot hash/active release khi publish.
- Publish tạo immutable JSON snapshot và đổi active pointer trong một transaction; có idempotency cho retry request.
- Rollback đổi pointer tới release đã lưu sau kiểm tra file, không ghi đè nháp.
- Archive thay xóa; service chặn archive record còn liên kết cần xử lý. Retained release có snapshot/file riêng; không tự xóa file cũ.
- Public catalog chỉ trả active release; media public được phép khi thuộc release giữ lại, draft media cần session.
- Password scrypt + salt; token ngẫu nhiên lưu hash; cookie HttpOnly/SameSite, session 8 giờ; origin allowlist, giới hạn thử login.
- Owner được publish/rollback; Editor schema có quyền edit/upload nhưng UI mời/cấp tài khoản chưa có.
- API truyền actor email vào audit khi ghi; chưa có UI tra cứu audit hoặc full per-entity revision restore.

Demo chỉ bind loopback, bootstrap owner lần đầu không mật khẩu mặc định. Internet production cần tài khoản lifecycle/MFA/reset/invite, HTTPS/cookie policy, logging/rate limits và kiểm tra hạ tầng riêng. Không ghi nhận có RLS/Supabase policy chưa tồn tại.

## 8. API và bàn giao trang chính

| Endpoint | Mục đích |
|---|---|
| /api/admin/v1/session, setup, login, logout | Owner/session/login/logout |
| /api/admin/v1/catalog | Catalog nháp, release metadata và active ID |
| /api/admin/v1/record, archive, usage, reorder | Ghi collection/record có revision, impact/archive và thứ tự |
| /api/admin/v1/upload | Multipart kiểm tra và lưu file |
| /api/admin/v1/preflight, publish, rollback | Kiểm tra và phát hành |
| /api/public/v1/catalog | Envelope data gồm catalog/schemaVersion/releaseId/publishedAt |
| /api/public/v1/media/:id | File theo media ID; gate draft hoặc release |

Error dùng code/message/issues; 401/403 cho auth/quyền, 409 conflict, 422 dữ liệu. Public graph không chứa owner/password/session hoặc draft ngoài graph. V1 vẫn có media storageKey/checksum metadata; production DTO nên chỉ giữ field cần cho renderer.

**Đã tích hợp trên /admin/live và trang chính /** ngày 02/10/2026. Trang chính dùng public release, shared selection và resolver; không query nháp hoặc tự ghép mọi model × flavor. Tích hợp gồm:

1. Banner navigation dùng text quảng cáo độc lập; vùng BEST SELLER dùng groups visible sorted position.
2. Group quyết định slots, slot quyết định variants/flavors; default fallback bằng ID, không tạo tích mọi model × flavor.
3. Viewer nhận asset/appearance/scene đã resolve; label thật thay demo gradient.
4. Nền/icon/theme weights của main chuyển từ bốn hương sang data động, preserve motion hiện có.
5. 2D fallback dùng đúng variant; poster model dùng chung phải ghi rõ là hình minh họa bao bì.
6. Chỉ một owner sửa shared layout/runtime/config trong thời điểm phối hợp.

Người dùng đã cho phép sửa trang chính trong chat này để tích hợp data. Các thay đổi đa ngôn ngữ hiện có được giữ lại. Mỗi file chỉ có một owner trong đợt tích hợp. Hai checkout/worktree là hướng phối hợp có thể dùng về sau; demo này không tự tạo worktree mới.

## 9. Phân công và phối hợp

| Owner | Phạm vi thực tế |
|---|---|
| Root | Contract/seed/resolver, Node API/SQLite/auth, launcher/config/package, AdminClient, PublishedShowcase và E2E |
| Agent 1 | lib/catalog validation/compatibility/service và admin-domain tests |
| Agent 2 | app/admin shell/CSS, AdminApp, catalog editors, shared MediaPicker và UX |
| Agent 3 | lib/server/media, composer/2D intake/DisplayPreview/PublishingWorkspace, media/resolver tests và tài liệu |

Một owner/file tại một thời điểm. Root duyệt thay đổi shared contract/package/config trước tích hợp. Agent dùng fixture khi API chưa xong nhưng fixture không được coi là persistence thật. Handoff chat trang chính qua contract/tài liệu; không tự nhắn chat khác khi chưa được người dùng cho phép.

## 10. Phases và nghiệm thu

| Phase | Trạng thái bản local | Còn lại trước production |
|---|---|---|
| G0 — Domain/ownership | Đã chốt contract v1, seed, slot và phạm vi file | Provider/hosting chính thức và migration plan |
| G1 — Foundation | SQLite/disk/owner/session/API thật; dữ liệu giữ sau restart | Invite/reset/MFA, hạ tầng tài khoản production |
| G2 — Danh mục/kho | Tám module, validation/relations/archive/revision và media intake | UX polish, bulk import/export, worker nếu cần |
| G3 — Composer | 3D/2D, compatibility, preview và seeded random | Transaction composer, dirty tracking đầy đủ, artwork/GLB thực |
| G4 — Release | Preflight/file checks/snapshot/rollback, /admin/live, main / và snapshot Pages | CDN/cache production và backend hosting |
| G5 — Vận hành | Runbook và tests local | Staging, backup/restore thử, migration, monitoring/retention, deploy |

Kiểm thử mã nguồn thật: admin-domain, admin-media, admin-resolver, admin-api; typecheck/lint/build và regression viewer/background/framing/accents/environment/water theo phạm vi. Resolver kiểm tra flavor thứ năm, role/no-repeat/metadata/URL/PP; media kiểm tra asset thực, malformed/giả MIME/remote reference/cycle/accessor size; API kiểm tra auth/roles/persistence/conflict/release/file checks.

Bản local ngày 01/10/2026: 50/50 admin tests đạt; typecheck và lint đạt; build production admin và static export GitHub Pages đạt. Các bộ regression viewer/background/framing/accents/environment/water đã chạy đạt trong phiên này. Browser QA với dữ liệu thử riêng đã kiểm tra đăng nhập, thêm flavor thứ năm, upload ảnh, tạo kho/config 2D, publish và xem catalog, xem geometry GLB thật, ghép label vào 3D, publish 3D và responsive 390 px; tạo label nháp trên mobile thành công. Dữ liệu QA nằm trong .tmp/admin-qa, không nhập vào database mặc định.

Bảng trên không xác nhận mọi yêu cầu production đã hoàn thành. Owner cần tiếp tục duyệt một sản phẩm thật, thử artwork/UV/keyboard, WebGL fallback và quy trình sao lưu/khôi phục trước khi vận hành chính thức.

## 11. Production còn mở

- Chọn host/runtime/database/storage; Cloudflare có thể chọn sau, Supabase chưa được chọn.
- Sao lưu DB + media + asset seed trên public, thử restore; backup không nằm trong Git.
- Migrations có version, dry-run/idempotence, import/export và đối chiếu references/file hashes.
- Account lifecycle, quyền multi-user, audit viewer và revision restore.
- Transaction composer, error recovery/dirty warnings, gallery rendering/advanced presets nếu cần.
- Worker/process sâu nếu chuyển đổi ảnh/model; CDN/CORS/signed media, retention/orphan cleanup.
- Backend hosting cho trang chính; GitHub Pages dùng snapshot public tĩnh đã export, cập nhật bằng export/build/deploy.
- Nội dung chính thức: dòng/nhãn/artwork/model/poster phải được người vận hành duyệt.

Backlog tiếp theo: đa ngôn ngữ/market/edition, campaigns/regions, scheduling/approval, bulk import dry-run, scene editor, advanced material/light presets và analytics theo số đo. Mở rộng qua IDs/revisions/schemaVersion/service boundaries, không cài đặt trước toàn bộ.

Chủ dự án đã cho phép thực hiện ngày 01/10/2026 và chỉnh dần. Demo local phục vụ việc này; chưa tạo dịch vụ bên ngoài, mua gói, deploy hosting hoặc tự xuất bản sản phẩm chính thức.
