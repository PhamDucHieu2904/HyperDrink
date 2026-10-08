# Chai 500 ml — nhãn ngắn, GLB cho web

Nguồn: `D:/3D model/Model Bottle Can/Blender Model 1/500 ml Bottle Model Short Label_web.blend`.
File gốc chỉ được đọc, SHA-256 vẫn là `a0a0526acef9c8771b9a36eb29ff1b6c7adf13bec1c056b3e5f81171c2355f48`.

## Kết quả

| Chỉ số | Bản xuất đối chứng | Bản tối ưu |
| --- | ---: | ---: |
| GLB đã nén Draco | 3.014.632 bytes | 1.125.168 bytes — 1,13 MB / 1,07 MiB |
| Tam giác | 246.768 | 246.768 |
| Vertex glTF, gồm tách UV/normals/material | 206.434 | 168.836 |
| Normal map | PNG, 668 × 668, 1.263.265 bytes | WebP, 668 × 668, 338.830 bytes |

Dung lượng giảm khoảng **62,7%**. Không cần decimate hoặc thay đổi topology để đạt mức dung lượng này. Số vertex glTF giảm do bỏ các UV không dùng và các vertex bị tách vì UV đó; vị trí vertex và mặt của lưới nguồn được giữ lại trước bước lượng tử hóa Draco.

Subdivision giữ đúng thiết lập nguồn: Body và Water **viewport/export 1, render 2**; Label **2/2**. Cap giữ Solidify và cách shading đã lưu. Lưới được đánh giá qua các modifiers trước, sau đó mới tối ưu attributes; không đưa Subdivision về 0. Explicit corner normals của kết quả đánh giá được bảo toàn để tránh Blender tính lại normals ở các mặt rất nhỏ tại đáy khi xóa UV.

## Cách giảm dung lượng

- Giữ UVMap trên Body (tọa độ normal map thực sự được sử dụng trong glTF) và Label (để gắn artwork sau). Bỏ `automap`, `UV_Body_Normal` khỏi bản xuất Body và UV không dùng của Water/Cap. Các UV trong `.blend` gốc được giữ nguyên.
- Draco level 10: position 14 bits, normals 10 bits, UV 12 bits. Riêng Water dùng position **16 bits** vì có các tam giác rất nhỏ ở đáy; thử 14 bits làm một số mặt mất diện tích nên bản đó bị loại.
- Normal map vẫn đủ 668 × 668 và strength 0,35. Đổi PNG có alpha trắng hoàn toàn sang WebP quality 95, smartSubsample. Đây là nén texture có mất dữ liệu, không đổi màu hoặc giảm độ phân giải. Sai lệch hướng normal theo pixel sau khi áp strength 0,35: trung bình khoảng 0,77°, p95 khoảng 1,79°.
- Chuẩn hóa đồng đều scale 0,1 và đặt tâm tại origin theo quy ước asset chai trong project. Không thay đổi tỷ lệ các phần. glTF Y-up; chiều cao tổng thể sau chuẩn hóa khoảng 209 mm.

Các material nguồn và phân chia Ring, Body, Cap, Label, Water, Aloe Pulp được giữ ở bước tối ưu hình học. Bản hoàn thiện tiếp theo dùng profile Aloe riêng và đã được đăng ký vào catalog; xem [ALOE_PET_500.md](ALOE_PET_500.md). Sau thiết lập material và sửa mặt đỉnh nước bị hở, GLB hiện tại là **1.128.836 bytes**, **246.960 tam giác**. Mặt bịt nước thêm một vertex và 192 tam giác sau subdivision, giữ các vị trí/mặt/normals nước cũ; các dòng Draco của Body, Cap, Label và Pulp không đổi. Các số liệu bảng trên ghi lại bước tối ưu trước khi thiết lập material và bịt đỉnh nước.

## Kiểm chứng

Giải nén lại GLB bằng bộ Draco của project và nhập lại bằng Blender 5.2.2 LTS. So sánh hai chiều tất cả vertex với lưới nguồn đã qua modifiers, kiểm tra số mặt, UV Body/Label và normals thực tế được GPU sử dụng:

- Sai lệch vị trí lớn nhất: **0,01069 mm**.
- Sai lệch normals hình học GPU lớn nhất: **0,474°**; riêng Body **0,228°**.
- Không có tam giác mất diện tích; đủ 246.768 tam giác.
- UV Body/Label giữ nguyên mapping, sai lệch lượng tử hóa lớn nhất khoảng 0,000171 UV, tương đương 0,114 pixel trên normal map 668 px.
- File nguồn không thay đổi, hash GLB khớp manifest.

Blender importer tự tái tạo khác normal ở vài corner rất nhỏ tại đáy Body. Chỉ số đó được lưu riêng trong báo cáo, không phải normals nằm trong GLB: kiểm tra trực tiếp `NORMAL` do bộ Draco giải nén cho thấy normals GPU của Body nằm trong sai lệch 0,228° nêu trên.

Render đối chiếu form ở góc chính diện và 55°, cùng camera/ánh sáng, dùng material trung tính để nhìn hình học. Ảnh trong `docs/screenshots/pet-500-geometry-comparison.png`; đây không phải bản hoàn thiện shader/chất lỏng.

Asset: `public/models/bottles/pet-500-short-label.glb`.
Thông số: `pet-500-short-label.manifest.json`; kiểm chứng: `pet-500-short-label.validation.json`, cùng thư mục.

## Xuất lại

Chạy lần lượt tại thư mục project, với Blender launcher đang cài:

```powershell
& 'C:/Users/thietke06.VINUT/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe' --background --factory-startup --disable-autoexec --python 'D:/program project/3d display product website/scripts/export-bottle-500.py'
node scripts/pack-bottle-500.cjs
node scripts/decode-bottle-500.cjs
& 'C:/Users/thietke06.VINUT/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe' --background --factory-startup --disable-autoexec --python 'D:/program project/3d display product website/scripts/validate-bottle-500.py'
node scripts/configure-aloe-500.cjs
```

Đợi `export-report.json` báo `state: complete` trước bước pack nếu launcher trả về sớm. Báo cáo validation phải `passed: true`. Thay đổi file nguồn/texture cần chạy đủ chuỗi và kiểm tra lại; pipeline chặn GLB vượt 1.150.000 bytes hoặc sai lệch hình học vượt ngưỡng kiểm chứng.
