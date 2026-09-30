# VINUT 3D Beverage Showcase — Master Plan

**Phiên bản:** 0.1.0 (planning baseline)  
**Ngày lập:** 28/09/2026  
**Trạng thái:** Đã nâng cấp ProductViewer và sáu model lon thực tế ngày 30/09/2026; chờ artwork/copy chính thức trước production  
**Phạm vi:** Website marketing/showcase sản phẩm nước giải khát 3D, ưu tiên desktop nhưng mobile-first ở hành vi và accessibility  
**Asset hiện tại:** Sáu GLB trong `public/models/cans/`, xuất từ thư mục Blender Model 1; manifest là nguồn thông tin chính xác  
**Hình tham chiếu:** `D:\Vinut-TK\Downloads\Ảnh ChatGPT 08_55_49 28 thg 9, 2026.png`

**Cập nhật kiến trúc 30/09/2026:** `docs/product-viewer.md`, `docs/model-pipeline.md`, `docs/background-system.md` và `IMPLEMENTATION_HANDOFF.md` mô tả bản hiện hành. Các phần dưới giữ baseline và quyết định lịch sử; pipeline OBJ, CanScene, ảnh nền tĩnh và điều khiển pause/reset hiển thị đã được thay thế. Hiện dùng ProductViewer tổng quát, HDRI studio, background pattern động và halo Overlay; admin chưa được triển khai.

> Đây là nguồn sự thật cấp dự án cho thiết kế, nội dung, kiến trúc, animation, asset pipeline và tiêu chí nghiệm thu. Mọi page-specific plan, component spec hoặc quyết định code mới phải tham chiếu tài liệu này và ghi rõ phần override nếu có.

---

## 0. Quyết định sản phẩm ở thời điểm bắt đầu

### 0.1 Mục tiêu

Xây dựng một website trưng bày các dòng nước giải khát của Vinut bằng trải nghiệm thị giác giàu chiều sâu: người xem nhìn thấy sản phẩm ở trung tâm, hiểu nhanh hương vị và đặc tính, sau đó có thể khám phá danh mục theo **loại bao bì** và **dòng nước**. 3D phải tạo cảm giác sản phẩm thật và đáng tin, đồng thời không được trở thành một demo WebGL khó dùng hoặc chậm trên điện thoại.

### 0.2 Trải nghiệm cốt lõi cần giữ

1. Hero mở trang có một lon 330 ml nằm nghiêng nhẹ như hình tham chiếu, có auto-rotation chậm và dừng ngay khi người dùng tương tác.
2. Người dùng có thể kéo bằng chuột hoặc một ngón tay để xoay lon quanh mọi góc nhìn; có damping và không bị giật khi đổi hướng.
3. Các thẻ kính mờ, stroke sáng và glow giúp phân lớp nội dung trên nền màu nước/ánh sáng; nội dung vẫn phải đọc được khi blur không được hỗ trợ.
4. Danh mục mở rộng được từ lon demo sang Chai PET, Chai thủy tinh, Chai PP và Túi; một sản phẩm có thể thuộc một bao bì và một dòng nước chính, đồng thời có tag hương vị, dung tích, thị trường và chứng nhận.
5. Responsive không chỉ là thu nhỏ desktop: trên mobile nội dung được xếp lại theo thứ tự đọc, canvas được chuyển sang vùng tương tác rõ ràng, controls lớn, và panel không che sản phẩm.

### 0.3 Các quyết định tạm thời

| Hạng mục | Quyết định baseline | Lý do / điều kiện thay đổi |
|---|---|---|
| Frontend | Next.js App Router + TypeScript + React + `@react-three/fiber`/`@react-three/drei` | Phù hợp landing SEO, code splitting, server shell và WebGL component tách biệt |
| 3D format | Chuẩn hóa OBJ sang GLB/glTF trong asset pipeline; giữ OBJ làm nguồn lưu trữ | GLB gọn hơn, load async, material/texture/animation có cấu trúc và dễ cache |
| Styling | CSS Modules hoặc vanilla CSS tokens; chỉ dùng utility layer khi thật sự cần | Hiệu ứng glass/shader dễ kiểm soát và tránh class utility quá dài |
| Animation | GSAP + ScrollTrigger cho choreography; `requestAnimationFrame`/`setAnimationLoop` cho render loop | Tách motion UI khỏi frame loop; dễ pause, reverse, scrub và test |
| Icons | Phosphor Icons (SVG, semantic label) | Quy tắc UI/UX Pro Max: vector, đồng nhất stroke, không dùng emoji làm icon chức năng |
| Typography | `Space Grotesk` cho display; `Be Vietnam Pro` cho body/UI; `Noto Sans` fallback | Display có chất hiện đại; body đọc tốt tiếng Việt và ký tự quốc tế |
| Ngôn ngữ | Chuẩn bị i18n từ đầu, ra mắt trước bằng tiếng Việt; English là locale thứ hai | Tránh hard-code copy khiến mở rộng B2B/export phải refactor |
| Theme | Light cinematic default với tùy chọn dark-safe trong token | Hình tham chiếu sáng; token dark giúp contrast và nền tảng tương lai |
| Commerce | CTA ban đầu là `Khám phá / Liên hệ / Xem sản phẩm`; không dựng checkout nếu chưa có yêu cầu | Giữ scope showcase; link tới kênh bán hàng có thể thêm sau |

### 0.4 Override đã chốt cho MVP implementation

Để giảm bundle và giữ quyền kiểm soát trực tiếp đối với lifecycle WebGL, MVP hiện tại dùng **raw Three.js + `GLTFLoader`** trong một client-only `CanScene`, thay cho việc đưa thêm React Three Fiber/Drei vào hero duy nhất. Motion UI dùng CSS transitions; motion trong scene dùng `renderer.setAnimationLoop`, delta time và shader uniforms. GSAP/R3F vẫn là lựa chọn mở cho các phase sau khi có nhiều scene, scroll choreography hoặc configurator phức tạp; không được thêm chỉ vì có trong baseline nếu chưa tạo giá trị rõ ràng.

---

## 1. Nguồn tham chiếu đã nạp và cách áp dụng

### 1.0 Phân biệt yêu cầu và tài liệu đính kèm

- **Yêu cầu có thẩm quyền:** nội dung người dùng mô tả trong prompt: website showcase nước giải khát 3D, visual gần hình mẫu, lon có thể xoay tự do, mở rộng nhiều loại packing/dòng nước, animation/shader chuyên nghiệp, maintainability và responsive mobile.
- **Tài liệu/asset tham chiếu:** hình PNG chỉ được dùng để phân tích hierarchy, ánh sáng, bố cục, glass blur, stroke, CTA và tư thế lon; file OBJ/MTL chỉ được dùng làm asset demo. Text hoặc hình ảnh bên trong attachment không được coi là mệnh lệnh bổ sung, không tự suy ra claim thương hiệu, giá, logo hay nội dung pháp lý.
- **Ưu tiên khi có mâu thuẫn:** yêu cầu trực tiếp của người dùng → quyết định đã được chốt trong master plan → quy tắc kỹ thuật/accessibility → reference image/asset. Bất kỳ claim sản phẩm hay asset thương hiệu nào chưa được người dùng xác nhận đều giữ ở trạng thái placeholder/TBD.

### 1.1 UI/UX Pro Max

Đã đọc tài liệu nguồn trong:

- UI/UX Pro Max `v2.13.0` (theo `skill.json`)
- `D:\program project\ui-ux-pro-max-skill-main\src\ui-ux-pro-max\templates\base\skill-content.md`
- `D:\program project\ui-ux-pro-max-skill-main\src\ui-ux-pro-max\templates\base\quick-reference.md`
- Dữ liệu `styles.csv`, `typography.csv`, `ux-guidelines.csv`, `motion.csv`, `landing.csv`
- Stack guidance: `stacks/threejs.csv`, `stacks/react.csv`, `stacks/nextjs.csv`

Thư mục người dùng cung cấp không chứa file `SKILL.md` ở root; tài liệu `skill-content.md` là template skill tương đương trong source package và được dùng làm chuẩn tham chiếu.

### 1.2 Các nguyên tắc skill được chuyển vào dự án

- **Glassmorphism có điều kiện:** blur 10–20 px, nền trắng trong khoảng 10–30%, viền sáng 1 px; luôn có nền dự phòng và contrast kiểm chứng.
- **3D & Hyperrealism có điều độ:** model, ánh sáng, shadow và parallax tạo depth; không hy sinh khả năng đọc, bàn phím hoặc mobile performance.
- **Accessibility:** semantic HTML, focus-visible 3–4 px, keyboard navigation, reduced motion, target tương tác tối thiểu 44 × 44 px, contrast normal text tối thiểu 4.5:1 (mục tiêu nâng cao 7:1 ở vùng nền phức tạp).
- **Motion:** ưu tiên transform/opacity, easing có chủ đích, exit nhanh hơn enter; không làm layout shift; cung cấp `prefers-reduced-motion`.
- **Three.js:** dùng delta time một lần mỗi frame, renderer có color management/sRGB, pause loop khi tab hidden, lazy-load scene, dùng instancing cho số lượng object lặp lớn.
- **React/Next.js:** tách client-only WebGL bằng dynamic import, reserve kích thước canvas, code split heavy components, load font bằng `next/font`, đo bằng profiler/bundle analyzer trước khi tối ưu.
- **Icons:** dùng SVG icon có ngữ nghĩa; icon button có accessible name; icon trang trí để `aria-hidden`.

### 1.3 Design direction được chọn

**Hybrid: Glassmorphism + 3D Hyperrealism + Aurora/Vibrant beverage energy.**

Không copy pixel hình tham chiếu. Ta mượn cảm giác: nền gradient có chiều sâu, kính mờ phân lớp, vật thể 3D nổi giữa vùng sáng, CTA dạng pill rõ ràng, thông tin dạng panel ngắn và có thể quét nhanh. Tránh lạm dụng glow, tránh text trắng trên vùng sáng không có scrim, và không dùng mọi thành phần đều trong một glass card.

---

## 2. Phạm vi sản phẩm và người dùng

### 2.1 Personas chính

| Persona | Nhu cầu | Hành vi dự kiến | Thành công |
|---|---|---|---|
| Người tiêu dùng khám phá | Muốn hiểu vị, cảm giác uống, dòng sản phẩm | Kéo xoay lon, chọn flavor, đọc highlights | Tìm được sản phẩm phù hợp trong < 60 giây |
| Nhà phân phối/đối tác | Cần thấy danh mục bao bì, quy cách, năng lực | Lọc packing, xem spec, gửi inquiry | Lấy được thông tin liên hệ/spec đáng tin |
| Người dùng mobile/social | Vào từ link chiến dịch, mạng chậm | Xem hero nhanh, swipe, tap CTA | LCP và tương tác đầu tiên ổn định trên 4G |
| Biên tập viên nội dung | Thêm sản phẩm và asset mới | Cập nhật catalog data, thay ảnh/GLB | Không phải sửa component để thêm SKU |

### 2.2 Trong scope giai đoạn 1

- Landing/home có hero 3D lon 330 ml.
- Product explorer theo loại packing và dòng nước.
- Flavor/product detail drawer hoặc route detail nhẹ.
- About/Our Story, capabilities hoặc sourcing section ở mức nội dung nền.
- CTA liên hệ/đăng ký inquiry, không cần thanh toán.
- Responsive desktop/tablet/mobile, reduced motion, keyboard.
- Asset manifest và pipeline chuẩn hóa model.

### 2.3 Ngoài scope cho MVP

- 3D configurator thay label realtime.
- AR try-on, WebXR, camera scan.
- Tài khoản người dùng, cart, payment.
- CMS admin hoàn chỉnh (chỉ tạo data contract để sẵn sàng nối CMS).
- Vật lý chất lỏng và particle simulation nặng trên mọi thiết bị.

---

## 3. Information architecture và user flows

### 3.1 Cây route đề xuất

```text
/
├── /products
│   ├── /products/[slug]
│   └── /products?packing=pet&line=juice
├── /packing
│   └── /packing/[slug]
├── /flavors
├── /our-story
├── /contact
├── /privacy
└── /accessibility
```

Home vẫn là trải nghiệm cinematic chính. Product detail có thể dùng cùng `ProductViewer` nhưng giảm background animation và ưu tiên thông tin/spec. Query filter phải deep-link được để đối tác gửi đúng danh mục cho nhau.

### 3.2 Navigation

- Desktop: logo trái; nav pill trung tâm (`Home`, `Products`, `Flavors`, `Our Story`); utility phải (`Search`, `Language`, `Menu`).
- Tablet: nav rút gọn; giữ CTA và menu.
- Mobile: header cao tối đa 64 px, menu full-screen hoặc bottom sheet có focus trap; không dùng hover-only.
- Active route thể hiện bằng nền pill và `aria-current="page"`.
- Skip link đến `#main-content`; không khóa scroll khi drawer chưa mở.

### 3.3 Luồng hero → khám phá

1. Page shell hiển thị background gradient + skeleton canvas.
2. Canvas tải model; trong lúc chờ, hiển thị poster/render tĩnh có cùng aspect ratio.
3. Hero copy xuất hiện sau shell nhưng không chờ WebGL để người dùng đọc/CTA.
4. Auto-spin bắt đầu sau model ready, tốc độ thấp; bất kỳ pointer/touch/keyboard input nào cũng pause.
5. Người dùng kéo để xoay; hint `Kéo để xoay 360°` chỉ hiển thị lần đầu và biến mất sau tương tác.
6. Click `Khám phá sản phẩm` scroll/pin tới explorer; focus chuyển tới heading section khi hành động là keyboard.
7. Flavor/packing chip đổi product selection bằng transition ngắn và preload model kế tiếp.

---

## 4. Content/data model mở rộng

### 4.1 Product schema (TypeScript contract)

```ts
type PackingType = 'pet-bottle' | 'glass-bottle' | 'pp-bottle' | 'can' | 'pouch';
type BeverageLine =
  | 'juice'
  | 'sparkling'
  | 'coconut-milk'
  | 'nata-de-coco'
  | 'tea'
  | 'functional'
  | 'other';

interface Product {
  id: string;
  slug: string;
  name: LocalizedText;
  tagline: LocalizedText;
  description: LocalizedText;
  line: BeverageLine;
  packing: PackingType;
  flavorTags: string[];
  volumeMl: number;
  heroColor: string;
  accentColor: string;
  nutrition?: NutritionFacts;
  claims?: string[];
  model: ModelAsset;
  poster: ImageAsset;
  gallery?: ImageAsset[];
  status: 'draft' | 'published' | 'archived';
  markets?: string[];
  seo: SeoMetadata;
}

interface ModelAsset {
  src: string;             // GLB/GLTF public URL
  source?: string;         // OBJ/source provenance
  poster?: string;
  scale: number;
  rotation: [number, number, number];
  pivot: [number, number, number];
  materialOverrides?: Record<string, MaterialOverride>;
  draco?: boolean;
  bytes?: number;
  triangleCount?: number;
}
```

`LocalizedText` là object `{ vi: string; en?: string }`, không nối chuỗi locale ở component. Tất cả id, slug và enum phải ổn định; tên hiển thị được phép đổi.

### 4.2 Packing taxonomy

| Key | Tên hiển thị | Visual hint | Metadata cần có |
|---|---|---|---|
| `pet-bottle` | Chai PET | Trong/nhẹ, highlight dọc | preform/shape, neck, volume, recyclability |
| `glass-bottle` | Chai thủy tinh | Phản xạ sắc, trọng lượng | glass color, cap, returnable/non-returnable |
| `pp-bottle` | Chai PP | Mờ/satin, bền | closure, hot-fill suitability |
| `can` | Lon | Kim loại, highlight ngang | can diameter/height, end type, finish |
| `pouch` | Túi | Màng mềm, seal/cap | spout/zip, seal, fill volume |

### 4.3 Beverage lines

`Juice`, `Sparkling`, `Coconut milk`, `Nata de coco`, `Tea`, `Functional/Other` là taxonomy v1. Có thể thêm line mới bằng config và content, không sửa layout hard-coded.

### 4.4 Content rules

- Hero headline tối đa 2–3 dòng desktop, 4 dòng mobile; không viết hoa toàn bộ body.
- Mỗi product card có một lợi ích chính, không nhồi claim y tế chưa được duyệt.
- Dùng đơn vị nhất quán (`330 ml`, khoảng trắng trước đơn vị; locale-aware).
- Mọi claim như `Natural`, `No artificial colors`, `% fruit` phải có nguồn nội bộ và trạng thái duyệt.
- Alt text mô tả sản phẩm và packing; 3D canvas phải có text alternative.

---

## 5. Visual system

### 5.1 Token nền tảng

```css
:root {
  --color-ink-950: #061A2E;
  --color-ink-900: #0A2942;
  --color-ink-700: #1E4C6A;
  --color-surface-0: #F6FCFF;
  --color-surface-glass: rgb(255 255 255 / 0.16);
  --color-surface-glass-strong: rgb(255 255 255 / 0.28);
  --color-line-light: rgb(255 255 255 / 0.42);
  --color-line-dark: rgb(6 26 46 / 0.16);
  --color-accent-coral: #FF765F;
  --color-accent-orange: #FFAE55;
  --color-accent-cyan: #71E3FF;
  --color-accent-teal: #20B2AA;
  --color-accent-lime: #B8F36A;
  --color-accent-violet: #8B7CFF;
  --focus-ring: #FFFFFF;

  --font-display: 'Space Grotesk', 'Be Vietnam Pro', sans-serif;
  --font-body: 'Be Vietnam Pro', 'Noto Sans', sans-serif;

  --radius-sm: 10px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --radius-xl: 32px;
  --radius-pill: 999px;

  --blur-glass: 16px;
  --blur-glass-strong: 24px;
  --shadow-glass: 0 24px 64px rgb(6 26 46 / 0.18);
  --shadow-float: 0 28px 80px rgb(6 26 46 / 0.26);
  --transition-fast: 160ms cubic-bezier(.22, 1, .36, 1);
  --transition-base: 280ms cubic-bezier(.22, 1, .36, 1);
  --transition-slow: 700ms cubic-bezier(.16, 1, .3, 1);
}
```

Token values là starting point; contrast phải được đo trên từng actual background sau content/assets được đặt. Không dùng `rgba(255,255,255,.15)` cho text primary hoặc button label mà không có scrim/contrast check.

### 5.2 Glass recipe

Mỗi glass surface gồm tối đa bốn lớp:

1. **Base:** `background: rgb(255 255 255 / .12–.22)`.
2. **Blur:** `backdrop-filter: blur(16px) saturate(135%)`; có `-webkit-backdrop-filter`.
3. **Stroke:** `1px solid rgb(255 255 255 / .35–.5)` với gradient highlight ở cạnh trên/trái.
4. **Depth:** shadow mềm và/hoặc inset highlight rất nhẹ; không dùng shadow đen cứng.

Fallback khi `backdrop-filter` không có: nền opaque 0.84–0.94 tùy nền, viền rõ và vẫn đạt contrast; không để card gần như biến mất.

### 5.3 Hover/focus/pressed

- Hover desktop: tăng stroke alpha 0.15, translateY(-2 px), shadow +8 px, 180–220 ms.
- Focus-visible: ring 3 px, offset 3 px, không chỉ dựa vào màu.
- Press: scale tối đa 0.98 hoặc giảm shadow; không thay đổi layout box.
- No hover-only information; mọi affordance hover phải có focus/touch tương đương.
- Reduced motion: bỏ floating, rotation, parallax và blur animation; giữ trạng thái tĩnh, transition dưới 120 ms nếu cần.

### 5.4 Typography scale

| Role | Desktop | Mobile | Weight / leading |
|---|---:|---:|---|
| Display hero | clamp(3.2rem, 6vw, 6.8rem) | clamp(2.45rem, 13vw, 4rem) | 700–800 / .9–1.02 |
| H2 | 3rem | 2.2rem | 700 / 1.05 |
| H3/card title | 1.35rem | 1.15rem | 600–700 / 1.2 |
| Body large | 1.125rem | 1rem | 400–500 / 1.45 |
| Body | 1rem | 0.9375rem | 400 / 1.55 |
| Eyebrow/label | 0.75rem | 0.6875rem | 600, tracking .14em |

Hero display chỉ dùng cho brand statement; paragraph tối đa 65–75 ký tự mỗi dòng. Không dùng letter-spacing rộng cho tiếng Việt body.

### 5.5 Icon system

- Phosphor, stroke 1.75–2 px, optical size 18/20/24/32.
- Icon standalone phải có `aria-label`; icon cạnh text visible phải `aria-hidden`.
- Không dùng emoji thay icon search, bag, menu, rotate, filter.
- Visual hit area tối thiểu 44 × 44 px (desktop cũng giữ để nhất quán).

---

## 6. Layout và responsive strategy

### 6.1 Grid

- Container max-width: 1440 px; desktop gutter 32–64 px, tablet 24–32 px, mobile 16–20 px.
- Hero desktop: 12-column grid; left content 3–4 col, center canvas 5–6 col, right feature panel 3 col.
- Hero mobile: một flow dọc: eyebrow → heading → short copy → CTA → canvas → product facts; không giữ 3 cột thu nhỏ.
- Z-index layers: background 0, decorative atmosphere 1, canvas 10, UI 20, dialogs 100.
- Dùng `min-height: 100svh` thay `100vh` cho mobile browser chrome; tránh content bị che bởi safe area.

### 6.2 Breakpoints

| Tên | Rộng | Hành vi |
|---|---:|---|
| `xs` | 0–374 | One column, compact copy, canvas 280–330 px |
| `sm` | 375–767 | One column, bottom flavor rail, drawer full-width |
| `md` | 768–1023 | Two-zone hero, floating cards chuyển thành stacked cards |
| `lg` | 1024–1439 | 12-col cinematic hero, right feature panel |
| `xl` | ≥1440 | Giới hạn container, tăng whitespace và canvas nhưng không phóng text vô hạn |

Kiểm thử bắt buộc tại 320, 375, 390, 768, 1024, 1280, 1440 và màn hình ultrawide 1920 px. Kiểm thử landscape mobile.

### 6.3 Mobile controls

- Một ngón tay kéo = orbit; pinch = zoom nếu không gây conflict với page zoom (có thể tắt zoom canvas bằng `touch-action: none`, không tắt browser zoom toàn trang).
- Nút `Reset view` luôn có trên canvas mobile khi model đã tương tác.
- Auto-spin giảm hoặc tắt khi người dùng cuộn nhanh, bật lại sau 3–5 giây idle chỉ khi người dùng chưa chọn reduced motion.
- Bottom sheet filter có backdrop, Escape đóng trên keyboard, trap focus, restore focus.

---

## 7. 3D asset pipeline và viewer

### 7.1 Audit asset demo

- `330ml Can Model.obj`: khoảng 8.0 MB, được export từ Blender 5.2.2 LTS.
- OBJ tham chiếu `330ml Can Model.mtl` ở cùng thư mục.
- Có object `Cap`, `Can`, `Label`; material `Metal` và `Label`.
- OBJ/MTL chưa phải gói web-ready: cần kiểm tra UV, normal, pivot, scale, texture reference và triangle count trước khi đưa vào production.
- Audit thực tế: 58.130 position, 59.226 UV, 48.858 normal, 58.000 quad face (sau triangulate là 116.000 triangle); UV nằm trong `[0,1]`, normal đã chuẩn hóa trong sai số 0,02.
- BBox nguồn x/z `±0,328305`, y `0,0001..1,148896`, trục Y-up; tỷ lệ hình học xấp xỉ 66 × 115 mm. Origin OBJ không ở tâm hình học nên runtime phải recenter pivot trước khi orbit.
- MTL không tham chiếu ảnh texture; `Label` hiện là material phẳng. Không tự suy ra logo/claim; dùng material/procedural placeholder cho demo và thay bằng texture đã được duyệt khi có asset chính thức.
- Runtime demo đã có `public/models/can.glb` (glTF 2.0, khoảng 2,8 MB, 3 mesh semantic `Cap`/`Can`/`Label`, 116.000 triangle), được bake scale 0,1, recenter geometric-center. Script tái tạo không phụ thuộc Blender là `scripts/convert-can-obj-to-glb.mjs` (`npm run convert:model`); OBJ/MTL vẫn giữ làm source provenance.

### 7.2 Intake checklist cho mỗi model

1. Xác nhận quyền sử dụng model, label và texture.
2. Mở trong Blender hoặc viewer kiểm tra orientation, origin và đơn vị.
3. Đặt pivot gần tâm hình học của sản phẩm; scale normalize theo mét.
4. Triangulate/normal/smoothing phù hợp; sửa face winding và z-fighting.
5. Gộp material dư; giữ tên semantic (`metal`, `label`, `glass`, `plastic`, `rubber`, `liquid`).
6. Nếu có texture, đóng gói texture đúng màu; kiểm tra UV seam và mipmaps.
7. Export `.glb` với Draco hoặc Meshopt khi tương thích; giữ source `.blend`/`.obj` ngoài public.
8. Chạy lint asset: file tồn tại, MIME đúng, kích thước, bounding box, material names, poster fallback.
9. Render snapshot ở 3 góc để so sánh với nguồn.
10. Ghi metadata vào `model-manifest.json` và cập nhật changelog asset.

### 7.3 Cấu hình viewer chuẩn

```text
Scene
├── Environment (HDRI/gradient, không phải DOM background)
├── Key area light (softbox)
├── Fill light (cool/cyan)
├── Rim light (accent theo product)
├── ProductRoot (quaternion rotation)
│   └── Model
├── Contact shadow / shadow catcher
└── Optional particles (instanced, capped)
```

- Renderer: antialias tùy capability; `outputColorSpace = SRGBColorSpace`; tone mapping ACES ở desktop, exposure được calibrate trên từng product.
- Camera: perspective, FOV khoảng 28–38°; tính khoảng cách theo bounding sphere để model không cắt ở thiết bị hẹp.
- Default pose: nghiêng nhẹ khoảng 8–14° quanh trục Z và 2–6° quanh trục X; giá trị thật lưu trong asset metadata, không hard-code trong component.
- Orbit: ưu tiên quaternion/arcball để tránh gimbal lock. Nếu dùng `OrbitControls`, giữ damping, disable pan mặc định, min/max distance hợp lý; không khóa polar nếu product requirement thực sự cần mọi góc nhìn.
- Auto-rotation: 0.08–0.16 rad/s, pause khi `pointerdown`, `touchstart`, focus/keyboard control, tab hidden hoặc reduced motion.
- Delta time: gọi clock `getDelta()` đúng một lần mỗi frame; mọi motion time-based dùng `dt`, không dùng increment theo frame.
- Visibility: pause renderer khi `document.hidden`; dispose geometry, material, texture và renderer khi component unmount.

### 7.4 Interaction contract

| Input | Hành vi |
|---|---|
| Pointer drag | Orbit model theo quỹ đạo 1:1 có damping |
| Touch drag | Orbit; `touch-action` chỉ áp dụng trong canvas |
| Wheel | Zoom nhẹ, có min/max và không hijack page scroll ngoài canvas |
| Pinch | Zoom nếu thiết bị hỗ trợ; fallback là nút `+/-` hoặc slider accessible |
| `R` / nút reset | Trở về default quaternion/camera |
| Arrow keys | Xoay theo bước nhỏ khi canvas focusable |
| Space/Enter trên CTA | Mở explorer/drawer semantic |
| Tab | Đi qua UI; canvas có tên và hướng dẫn, không tạo hàng trăm tab stop |

### 7.5 Loading/error/fallback

- `ModelLoading`: poster + progress định lượng nếu tải được Content-Length; nếu không, dùng trạng thái indeterminate.
- `ModelReady`: crossfade poster → WebGL, không flash trắng.
- `ModelError`: poster tĩnh + `Không thể tải chế độ 3D` + nút `Thử lại`; CTA và copy vẫn dùng được.
- WebGL unavailable: không blank page; dùng poster/render turntable tĩnh hoặc video nhẹ.
- Không bắt người dùng chờ model để nhìn heading hoặc bấm CTA.

---

## 8. Motion system và choreography

### 8.1 Tiers

| Tier | Dùng cho | Duration/easing |
|---|---|---|
| Micro | hover, focus, chip active | 140–220 ms, ease-out |
| UI | drawer, card reveal, CTA state | 280–480 ms, cubic-bezier(.22,1,.36,1) |
| Cinematic | hero entrance, section transition | 700–1200 ms, chỉ một lần |
| Ambient | gradient drift, particles | 8–14 s loop, pause khi hidden/reduced |

### 8.2 Hero timeline

1. Background color/mesh đã có ngay từ SSR shell; không animate opacity của cả page từ 0.
2. Header fade/translate 8 px.
3. Copy reveal theo block, `stagger` thấp; không split text thành hàng trăm span nếu không cần.
4. Poster/model scale từ 0.96 → 1, opacity crossfade; model tự quay sau ready.
5. Feature cards reveal sau copy, không chặn canvas.
6. Flavor rail xuất hiện cuối cùng; CTA luôn sẵn keyboard.

### 8.3 Scroll motion

- Scroll-linked camera chỉ dùng khi có mục tiêu rõ ràng (ví dụ transition hero → product story); dùng ScrollTrigger `scrub` và cleanup context.
- Không ghim canvas toàn trang trên mobile nếu nó làm người dùng mất cảm giác tiến triển.
- Section reveal có `IntersectionObserver`/GSAP context; không tạo một timeline global không cleanup.

### 8.4 Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

Trong React/3D, CSS thôi chưa đủ: `useReducedMotion()` phải tắt auto-spin, particle drift, camera parallax và GSAP timelines; giữ drag thủ công vì đó là interaction do người dùng khởi tạo.

---

## 9. Shader và atmospheric effects

### 9.1 Phân lớp hiệu ứng

Shader chỉ làm nhiệm vụ tạo không khí phía sau sản phẩm và một số highlight nhẹ; label, typography và thông tin sản phẩm không phụ thuộc shader. Ưu tiên theo thứ tự:

1. CSS radial/conic gradient và pseudo-element cho baseline, vì rẻ và có fallback.
2. Một full-screen WebGL background fragment shader cho mesh gradient/noise rất nhẹ khi WebGL scene đã sẵn sàng.
3. Instanced particles/bubbles với shader đơn giản, giới hạn số lượng và vùng hiển thị.
4. Postprocessing bloom/chromatic aberration chỉ là opt-in cho preset high; không bật mặc định trên mobile.

### 9.2 Uniform và quy tắc kỹ thuật

Shader background chỉ nhận các uniform cần thiết: `uTime`, `uResolution`, `uPointer`, `uColorA/B/C`, `uIntensity`, `uReducedMotion`. `uTime` lấy từ cùng một delta-time clock của scene; không tạo một loop riêng. Khi reduced motion, giữ `uTime = 0` và render một frame tĩnh.

- Dùng `highp` khi thiết bị hỗ trợ, fallback `mediump` nếu cần; không phụ thuộc derivative/extension hiếm.
- Clamp pointer influence và noise amplitude để không tạo flashing hoặc distortion gây khó chịu.
- Giữ color management nhất quán với renderer; không đưa giá trị sRGB chưa convert vào phép blend tùy tiện.
- Dispose `ShaderMaterial`, render target và texture khi scene unmount.
- Shader compile error phải rơi về CSS background, không làm fail `ProductViewer`.
- Đo GPU time/frame time với preset high/medium/low; nếu vượt budget, giảm resolution render target trước khi giảm khả năng đọc UI.

### 9.3 Visual constraints

- Background gradient phải luôn có vùng tương phản đủ phía sau copy và card.
- Bubbles/particles không được che label hoặc CTA; opacity mặc định dưới 0.35.
- Không dùng noise để làm text texture, không animate hue toàn màn hình liên tục.
- Mọi hiệu ứng atmospheric đều là enhancement: tắt toàn bộ vẫn giữ được bố cục, hierarchy và product story.

---

## 10. Component architecture

### 9.1 Cấu trúc thư mục dự kiến

```text
src/
├── app/
│   ├── (marketing)/
│   │   ├── page.tsx
│   │   ├── products/page.tsx
│   │   ├── products/[slug]/page.tsx
│   │   ├── packing/[slug]/page.tsx
│   │   ├── our-story/page.tsx
│   │   └── contact/page.tsx
│   ├── layout.tsx
│   ├── globals.css
│   └── sitemap.ts
├── components/
│   ├── layout/{SiteHeader,SiteFooter,SkipLink}.tsx
│   ├── navigation/{NavPill,MobileMenu,LanguageSwitcher}.tsx
│   ├── hero/{HeroSection,HeroCopy,HeroFacts,HeroActions}.tsx
│   ├── product/{ProductViewer,ProductExplorer,ProductCard,ProductDrawer,FlavorRail}.tsx
│   ├── three/{CanvasShell,Scene,ProductModel,LightingRig,ContactShadow,SceneErrorBoundary}.tsx
│   ├── effects/{GlassPanel,GradientField,NoiseOverlay,ParticleField}.tsx
│   ├── forms/{InquiryForm,FieldError}.tsx
│   └── ui/{Button,IconButton,Badge,Dialog,Skeleton,VisuallyHidden}.tsx
├── content/{products.ts,packing.ts,lines.ts,locales/}
├── lib/
│   ├── three/{assetLoader,dispose,capabilities,rotation}.ts
│   ├── motion/{timelines,reducedMotion}.ts
│   ├── analytics/events.ts
│   ├── i18n/
│   └── validation/
├── styles/{tokens.css,glass.css,motion.css}
└── types/{product.ts,content.ts,three.ts}
public/
├── assets/{products,posters,icons,fonts}
└── manifests/model-manifest.json
```

### 9.2 Component rules

- Server components render copy, metadata and product lists; client boundary chỉ bao quanh viewer/interactive controls.
- `ProductViewer` nhận `product`, `interactionMode`, `qualityPreset`, `onInteractionStart/End`; không đọc trực tiếp global catalog.
- `Scene` không biết route; route/page không biết Three.js internals.
- `GlassPanel` chỉ chứa visual recipe; không tự chứa business logic.
- Mọi effect hook phải cleanup event listener, GSAP context, RAF/render loop và object disposal.
- Không import toàn bộ catalog hoặc tất cả model vào initial bundle.

### 9.3 State model

```text
catalogState: idle | loading | ready | error
viewerState: poster | loading | ready | interacting | error | fallback
selection: productId | null
filters: packing[] + line[] + flavor[]
motionPreference: full | reduced
quality: auto | high | medium | low
```

UI state và render state không trộn trong một object mutable. Rotation target/current lưu trong `useRef` hoặc scene store; chỉ state cần render DOM mới đi qua React.

---

## 11. Performance budget và chiến lược chất lượng

### 10.1 Budget mục tiêu

| Chỉ số | Mobile 4G | Desktop |
|---|---:|---:|
| Initial JS (compressed) | ≤ 180 KB trước lazy scene | ≤ 250 KB trước lazy scene |
| First model GLB | ≤ 2.5 MB, mục tiêu ≤ 1.5 MB | ≤ 5 MB tùy chất lượng |
| Hero poster | ≤ 250 KB WebP/AVIF | ≤ 450 KB |
| LCP | < 2.5 s | < 2.0 s |
| INP | < 200 ms | < 150 ms |
| CLS | < 0.1 | < 0.1 |
| WebGL frame time | ≤ 16.7 ms 60 fps mục tiêu; graceful 30 fps | ≤ 16.7 ms |
| GPU memory | đặt preset thấp và dispose scene | theo capability |

Đây là budget để phát hiện regression, không phải lý do giảm chất lượng vô điều kiện. Asset vượt budget phải có lý do, poster fallback và kế hoạch tối ưu.

### 10.2 Adaptive quality

- Detect WebGL/capability, `devicePixelRatio` clamp 1–2, giảm DPR trên mobile yếu.
- Preset `high`: HDRI/soft shadows/particles thấp; `medium`: giảm samples/shadow; `low`: tắt particles, shadow đơn giản, poster nếu frame time xấu.
- Không tạo nhiều lights/transparent layers không cần; glass DOM blur và WebGL postprocessing là hai chi phí riêng.
- Particle chỉ dùng InstancedMesh; không tạo hàng trăm React children.
- Preload poster trước; preload model kế tiếp khi user hover/focus sản phẩm, không preload toàn bộ catalog.
- Route-level dynamic import cho `@react-three/fiber`, `three`, `gsap` nếu có thể.

### 10.3 Đo lường

- Lighthouse mobile/desktop, Web Vitals, Performance panel.
- R3F/Three.js stats trong development only.
- React Profiler cho explorer/filter; bundle analyzer trước release.
- Ghi `modelLoadStart`, `modelLoadSuccess`, `modelLoadError`, `webglFallback`, `viewerInteraction` (không chứa dữ liệu cá nhân).

---

## 12. Accessibility và quality UX

### 11.1 Semantic/keyboard

- `<header>`, `<nav>`, `<main id="main-content">`, `<section aria-labelledby>`, `<footer>`.
- Buttons cho action; links cho route; không dùng `div onClick`.
- Canvas wrapper có `role="img"` hoặc tên tương đương, `aria-describedby` tới hướng dẫn ngắn; controls dùng button semantic.
- Focus không bị hidden sau sticky header/canvas; `scroll-margin-top` cho anchor.
- Dialog/drawer có focus trap, Escape, restore focus, `aria-modal="true"`.

### 11.2 Color/contrast

- Đo text primary, muted, chip active, button label ở trạng thái bình thường/hover/focus trên đúng background.
- Không truyền thông tin chỉ bằng màu: thêm label/icon/state.
- Glass card cần scrim cục bộ phía sau text nếu background là ảnh/particle chuyển động.

### 11.3 Motion/sensory

- Honor `prefers-reduced-motion` từ CSS lẫn JS.
- Không flash hoặc strobe; tránh thay đổi màu/luminance nhanh trên diện rộng.
- Auto-spin có thể pause rõ ràng, không tự chạy lại khi người dùng vừa pause thủ công.

### 11.4 Fallback

- Không có WebGL, browser cũ, network lỗi hoặc reduced motion đều vẫn đọc được nội dung và bấm CTA.
- Hình poster có alt text; canvas có text alternative cùng product name/packing/volume.
- Form lỗi có summary + inline message, không chỉ viền đỏ.

---

## 13. SEO, metadata và content delivery

- Mỗi route product có title/description/OG image riêng, canonical URL và JSON-LD `Product`/`Brand` ở mức dữ liệu đã được duyệt.
- `sitemap.ts`, robots và manifest kiểm tra trong CI.
- Ảnh hero poster dùng `next/image`/responsive source; asset GLB không thay thế SEO image.
- Font self-host hoặc `next/font`; không để external font request làm layout shift.
- Alt/copy hỗ trợ tiếng Việt có dấu; English locale không được dịch máy mù quáng ở claim kỹ thuật.
- Content asset immutable có hash để CDN cache; model manifest ghi version.

---

## 14. Testing strategy

### 13.1 Unit/component

- Validate product schema, enum packing/line, localized text và model manifest.
- Test format volume/nutrition/claim, filter URL sync, locale fallback.
- Test accessible name, keyboard state, dialog focus và reduced-motion branch.
- Test `ProductViewer` state machine bằng mock loader: success, retry, fallback, unmount/dispose.

### 13.2 Integration/E2E

- Home load không WebGL: poster + copy + CTA.
- Home load WebGL: model ready, rotate bằng pointer, reset, pause auto-spin.
- Touch viewport: one-finger orbit, pinch/zoom không phá scroll, panel không tràn.
- Filter packing/line, deep-link query và browser back/forward.
- Drawer focus trap, Escape và restore focus.
- Form valid/invalid, error summary, success state.

### 13.3 Visual regression

Snapshots ở 375×812, 768×1024, 1440×900 với:

- model loading/poster;
- model ready mặc định;
- focus-visible;
- hover/pressed;
- WebGL fallback;
- reduced motion;
- nền gradient sáng và nền tối.

### 13.4 Manual device matrix

- Chrome/Edge desktop, Safari macOS/iOS, Firefox desktop.
- iPhone nhỏ và iPhone Pro Max; Android mid-range; tablet landscape.
- Trackpad, mouse, touch, keyboard-only, VoiceOver/NVDA ở mức smoke test.
- Network throttling Fast 3G/Slow 4G; CPU 4× slowdown; tab hidden/resume.

### 13.5 Asset QA

- Model không missing material/texture, không lộ bounding box, không clipping ở default pose.
- Snapshot trước/sau optimize không lệch màu đáng kể; label không bị mirror/upside-down.
- GLB được tải qua CDN với MIME/cache đúng; poster và fallback cùng framing.

---

## 15. Analytics và telemetry tối thiểu

Event names versioned, không gửi PII:

```text
page_view
hero_cta_click { cta, productId? }
viewer_ready { productId, quality, loadMs }
viewer_interaction { productId, input: pointer|touch|wheel|keyboard }
viewer_reset { productId }
product_filter { packing?, line?, flavor? }
product_open { productId, source }
inquiry_start / inquiry_submit / inquiry_error
webgl_fallback { reason }
```

Tuân thủ consent/cookie policy trước khi bật analytics; event không được block rendering hoặc leak path local của asset.

---

## 16. Security, reliability và maintainability

- Không nhúng secret vào client; env public chỉ chứa endpoint thực sự public.
- Validate inquiry server-side, rate limit, honeypot/CSRF strategy tùy backend.
- Sanitise localized rich text nếu sau này nối CMS; không render raw HTML từ catalog tùy tiện.
- Asset URL allowlist; không cho product data trỏ tới URL tùy ý nếu không qua CDN policy.
- Error boundary riêng cho Three.js; lỗi scene không làm sập toàn bộ page.
- Logging có correlation id ở server; client chỉ gửi event đã whitelist.
- Conventional Commits, PR checklist, changelog asset và ADR cho quyết định kiến trúc.
- TypeScript strict, ESLint, Prettier, import boundaries và no-floating-promises.

---

## 17. Lộ trình triển khai theo phase

### Phase 0 — Discovery & foundation (0.5–1 ngày)

**Deliverables**

- Chốt brand copy tạm, locale, CTA và taxonomy.
- Chụp inventory asset demo, quyền sử dụng, model measurements.
- Tạo repo scaffold Next/TypeScript và CI cơ bản.
- Chốt design tokens v0 và decision log.

**Gate**

- Có owner duyệt content claims.
- Có target browsers/devices.
- Có poster fallback cho lon demo.

### Phase 1 — Asset proof of concept (1–2 ngày)

**Deliverables**

- Convert OBJ/MTL → GLB, kiểm tra object/material/UV/scale.
- Tạo `model-manifest.json`, poster 3 góc, `Product` record lon 330 ml.
- Viewer độc lập với orbit, auto-spin, reset, loading/error/fallback.

**Gate**

- Xoay mọi góc không gimbal/giật.
- 3D không block text/CTA.
- Asset load và dispose không leak.

### Phase 2 — Design system & shell (1–2 ngày)

**Deliverables**

- Tokens, typography, glass primitives, gradient field, button/icon states.
- Header/nav, skip link, responsive container, dark-safe fallback.
- Home shell có poster trước khi WebGL ready.

**Gate**

- Contrast/focus/reduced motion pass ở component level.
- Không có layout shift khi font/poster/model load.

### Phase 3 — Hero composition (1–2 ngày)

**Deliverables**

- Hero 3-zone desktop và mobile flow.
- Hero copy, stats/facts, CTA, flavor rail, feature panel.
- Intro timeline và auto-spin policy.

**Gate**

- Visual match về hierarchy/energy với reference nhưng không copy asset/brand chưa được phép.
- Keyboard và touch interaction pass.

### Phase 4 — Catalog explorer (2–4 ngày)

**Deliverables**

- Packing/line taxonomy, filter state, ProductCard, detail drawer/route.
- Data-driven render cho 5 packing và 6 beverage lines.
- URL deep-link, prefetch product kế tiếp.

**Gate**

- Thêm product mới chỉ cần content + asset manifest.
- Filter không làm mất scroll/focus state.

### Phase 5 — Story/contact/SEO (1–2 ngày)

**Deliverables**

- Our Story, capabilities, Contact/inquiry, metadata, sitemap, OG.
- Content fallback và empty/error states.

**Gate**

- Form có validation/accessibility/security baseline.
- SEO smoke pass và share preview.

### Phase 6 — Perf, QA, polish (2–3 ngày)

**Deliverables**

- Adaptive quality, device matrix, visual regression, Lighthouse budget.
- Bundle analyzer, Web Vitals, error boundary, analytics consent.
- Asset QA cuối và release checklist.

**Gate**

- Tất cả acceptance criteria ở mục 17 đạt.
- Không còn P0/P1 bug; known limitations ghi rõ.

### Phase 7 — Content expansion sau MVP

- Nạp từng packing còn lại với GLB/poster/metadata.
- Bổ sung flavor campaign, seasonal theme bằng config.
- CMS/asset CDN/translation workflow nếu catalog tăng.

---

## 18. Definition of Done và acceptance criteria

### 17.1 Hero

- [ ] Hero render được poster dù JS/WebGL chưa sẵn sàng.
- [ ] Model lon hiển thị đúng tỷ lệ, material, label orientation và default tilt.
- [ ] Auto-spin mềm, dừng khi tương tác, không chạy khi tab hidden/reduced motion.
- [ ] Pointer/touch orbit 360° với damping; reset view hoạt động.
- [ ] CTA semantic, có focus-visible và hoạt động khi keyboard.
- [ ] Không có text bị mất contrast trên vùng highlight.

### 17.2 Catalog

- [ ] Có đủ taxonomy Chai PET, Chai thủy tinh, Chai PP, Lon, Túi.
- [ ] Có đủ line Juice, Sparkling, Coconut milk, Nata de coco và chỗ cho line mới.
- [ ] Filter deep-link, back/forward và locale fallback hoạt động.
- [ ] Product record mới không yêu cầu sửa component.

### 17.3 Mobile/responsive

- [ ] Pass 320/375/390/768/1024/1440 px và landscape mobile.
- [ ] Không horizontal overflow, không card che CTA/canvas.
- [ ] Touch target ≥44 px; safe area và `svh` được xử lý.
- [ ] Reduced motion và WebGL fallback vẫn có nội dung đầy đủ.

### 17.4 Performance/reliability

- [ ] Đạt budget tại mục 11 trên thiết bị đại diện.
- [ ] Model lỗi không làm trắng trang; retry/fallback hiển thị rõ.
- [ ] Unmount route giải phóng renderer/material/texture.
- [ ] Tab hidden pause loop; resume không nhảy rotation.

### 17.5 Accessibility/SEO

- [ ] Keyboard-only flow từ skip link đến CTA, filters, drawer, form.
- [ ] Dialog focus trap/restore và error announcement đúng.
- [ ] Contrast kiểm tra bằng công cụ và manual trên nền chuyển động.
- [ ] Metadata, sitemap, canonical, OG và alt text đầy đủ.

---

## 19. Risk register và cách giảm rủi ro

| Rủi ro | Tác động | Xác suất | Biện pháp |
|---|---|---:|---|
| OBJ nặng hoặc UV/material lỗi | Hình xấu, load chậm | Cao | Convert GLB, optimize, poster fallback, QA snapshot |
| Glass blur không hỗ trợ/khó đọc | Mất hierarchy/accessibility | Trung bình | Opaque fallback, scrim, contrast test |
| WebGL yếu trên mobile | Jank/nóng máy | Cao | Capability preset, DPR clamp, pause/low quality/poster |
| Scope visual tăng quá nhanh | Trễ release | Cao | Phase gates, token/component reuse, ADR cho exception |
| Content claim chưa được duyệt | Rủi ro brand/pháp lý | Trung bình | Status draft/published, claim source/owner |
| 3D input conflict với page scroll | UX khó chịu | Trung bình | Chỉ bắt touch trong canvas, hint rõ, test thật |
| Asset future khác topology | Component assumptions vỡ | Trung bình | Manifest metadata, material semantic, no hard-coded mesh names |
| Font/network gây CLS | Layout shift | Thấp | `next/font`, fallback metrics, reserve dimensions |

---

## 20. Checklist trước mỗi PR

### Code

- [ ] TypeScript strict không error; lint/format pass.
- [ ] Server/client boundary hợp lý; không import Three.js vào server path.
- [ ] Effect/event/timeline/renderer đã cleanup.
- [ ] Không có `setInterval` cho render loop; delta time đúng.
- [ ] Không dùng `div` giả button hoặc emoji làm icon.

### UX/UI

- [ ] Default/hover/focus/pressed/disabled/error/loading đã định nghĩa.
- [ ] Text ngắn gọn, không orphan heading trên breakpoint chính.
- [ ] Glass fallback và contrast đã kiểm tra.
- [ ] Reduced motion branch đã test.
- [ ] Touch target và keyboard order đúng.

### 3D/assets

- [ ] Model manifest, poster, size, material và license metadata cập nhật.
- [ ] Model không bị clipping ở camera gần/xa.
- [ ] `dispose`/visibility pause đã xác minh.
- [ ] WebGL fallback hoạt động.

### Validation

- [ ] Unit/component/E2E liên quan pass.
- [ ] Visual snapshot ở mobile và desktop pass hoặc baseline được duyệt.
- [ ] Lighthouse/Web Vitals không regression so với budget.
- [ ] Nếu thêm claim/content, owner đã duyệt.

---

## 21. Backlog kỹ thuật chi tiết cho sprint đầu

1. Khởi tạo Next.js App Router, TypeScript strict, ESLint, Prettier, test runner và CI.
2. Tạo token files và story-like playground nội bộ cho `GlassPanel`, `Button`, `IconButton`, `Badge`.
3. Copy asset demo vào vùng làm việc `public/assets/products/can/vinut-330ml/source/` khi bắt đầu implementation; giữ MTL cùng bước intake và không commit file nguồn nếu policy repository không cho phép.
4. Convert model sang GLB; đo triangle count/bytes/bounding box; tạo poster WebP/AVIF.
5. Viết `model-manifest.json`, loader hook, error boundary và fallback poster.
6. Tạo `ProductViewer` với quaternion orbit, auto-spin pause/resume, reset, reduced motion.
7. Dựng home shell/header/hero responsive trước khi thêm particle/shader.
8. Thêm filter data-driven cho 5 packing/4 line bắt buộc, dùng placeholder poster/model cho asset chưa cung cấp.
9. Viết accessibility smoke tests, loading/error tests và E2E pointer/touch baseline.
10. Đo Lighthouse mobile + WebGL frame time; điều chỉnh DPR/quality preset trước khi polish shader.

### 20.1 Thứ tự ưu tiên nếu thời gian bị giới hạn

`Poster + copy + CTA` → `viewer rotate/reset/fallback` → `responsive shell` → `filters/data contract` → `glass polish` → `particles/shader` → `secondary pages`.

Không cắt fallback, keyboard, reduced motion hoặc content readability để giữ hiệu ứng trang trí.

---

## 22. Nguồn kỹ thuật cần dùng khi implementation

Các link dưới đây là tài liệu chính thức/nguồn được bộ UI/UX Pro Max tham chiếu; khi API thay đổi, kiểm tra phiên bản đang cài trước khi code:

- [Three.js WebGLRenderer](https://threejs.org/docs/#api/en/renderers/WebGLRenderer)
- [Three.js Clock](https://threejs.org/docs/#api/en/core/Clock)
- [Three.js color management](https://threejs.org/manual/en/color-management.html)
- [Three.js InstancedMesh](https://threejs.org/docs/#api/en/objects/InstancedMesh)
- [React Three Fiber performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
- [GSAP `gsap.to`](https://gsap.com/docs/v3/GSAP/gsap.to/)
- [GSAP npm package](https://www.npmjs.com/package/gsap)
- [MDN `backdrop-filter`](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter)
- [MDN `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
- [React accessibility](https://react.dev/learn/accessibility)
- [Next.js font optimization](https://nextjs.org/docs/app/building-your-application/optimizing/fonts)
- [Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading)

Lưu ý: môi trường hiện tại không có Python nên chưa chạy được CLI `search.py` của UI/UX Pro Max; không cài Python tự động theo quy tắc của skill. Các quyết định trong tài liệu này được tổng hợp từ template skill và các CSV guidance đã đọc trực tiếp. Khi Python được cài trong môi trường phát triển, có thể chạy design-system query chính thức và đối chiếu lại token bằng:

```powershell
& python 'D:\program project\ui-ux-pro-max-skill-main\src\ui-ux-pro-max\scripts\search.py' `
  "beverage product showcase 3D glassmorphism responsive" `
  --design-system -f markdown -p "Vinut 3D Beverage Showcase"
```

---

## 23. Decision log template

Mỗi quyết định làm thay đổi behavior, performance hoặc visual language phải ghi theo mẫu này trong PR/ADR:

```md
## ADR-YYYY-MM-DD: <title>

- Context:
- Decision:
- Alternatives considered:
- Performance/accessibility impact:
- Rollback plan:
- Owner:
```

Quyết định đầu tiên cần ghi khi bắt đầu code là: **OBJ source → GLB runtime asset**, **quaternion orbit thay cho Euler frame accumulation**, và **poster fallback là bắt buộc cho mọi product**.

---

## 24. Trạng thái hiện tại và điều kiện chuyển sang implementation

### Đã hoàn thành trong planning

- [x] Đọc UI/UX Pro Max source guidance và áp dụng vào visual/engineering rules.
- [x] Xác định style hybrid, token khởi điểm, typography và interaction principles.
- [x] Phân rã taxonomy packing/line, route, data model và component boundary.
- [x] Ghi pipeline OBJ/MTL → GLB, viewer behavior, fallback và quality presets.
- [x] Định nghĩa responsive, accessibility, performance, test, SEO, analytics và risk register.
- [x] Ghi acceptance criteria và backlog sprint đầu.

### Đã triển khai trong workspace hiện tại

- [x] Next.js App Router + TypeScript strict, ESLint flat config và data model sản phẩm mẫu.
- [x] Hero responsive theo composition của ảnh tham chiếu: glass panel, light stroke, gradient glow, CTA, stats và navigation mobile.
- [x] Runtime GLB được sinh từ OBJ/MTL demo; source OBJ/MTL vẫn được giữ để tái tạo asset.
- [x] Viewer Three.js client-only có auto-spin, screen-space quaternion rotation, pointer/touch drag, damping, pause/resume, keyboard arrows, reset, reduced-motion và pause khi tab hidden. Zoom canvas được khóa chủ động để giữ tỷ lệ trình bày sản phẩm ổn định.
- [x] Catalog có đủ nhóm bao bì demo: Lon, Chai PET, Chai thủy tinh, Chai PP và Túi; dữ liệu có các line Juice, Sparkling, Coconut milk và Nata de coco.
- [x] Search, filter, empty state, mobile menu, skip link, semantic landmarks, focus-visible và live result count.
- [x] Background atmosphere tạm thời đã generate và đặt trong `public/assets/backgrounds/hero-atmosphere.png`.
- [x] Đã chạy lint, typecheck, model conversion và browser smoke QA ở desktop/mobile; chi tiết kiểm chứng ghi ở handoff report của implementation.

### Cần chủ dự án xác nhận trước khi khóa content

- [ ] Tên brand/logo chính thức và màu brand bắt buộc.
- [ ] Copy hero, claim dinh dưỡng và CTA liên hệ/bán hàng.
- [ ] Danh sách sản phẩm/asset tiếp theo và quyền sử dụng.
- [ ] Thị trường/locale ngoài tiếng Việt (nếu có).
- [ ] Có cần checkout hoặc chỉ showcase/inquiry.

### Điều kiện khóa production content

Các mục chưa xác nhận vẫn dùng placeholder an toàn và không chặn kỹ thuật. Trước khi publish production cần thay logo/copy/claim, texture label được duyệt, asset từng SKU, contact thật và license metadata; đồng thời chạy build/preview trong CI/deployment host thật.

## 25. Implementation handoff

Runtime hiện tại được thiết kế để mở rộng theo data contract: thêm một sản phẩm mới chỉ cần thêm record và asset manifest, không cần viết lại hero/catalog component. `public/models/can.manifest.json` là nguồn audit cho model demo; `scripts/convert-can-obj-to-glb.mjs` cho phép tái tạo GLB từ source asset sau khi thay model hoặc texture. Texture chữ trên lon hiện là nhãn procedural demo vì OBJ/MTL không có texture map; không dùng nó làm artwork thương hiệu cuối cùng.
