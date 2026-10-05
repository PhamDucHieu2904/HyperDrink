# Thống kê và giám sát website

## Sử dụng local

Chạy `npm run dev:admin` (API 3010, admin 3100) và `npm run dev` (website 3000). Đăng nhập admin rồi chọn **Thống kê truy cập** hoặc **An ninh & log**. Tổng quan có thêm chỉ số vận hành, thanh đầu trang báo số cảnh báo chưa xác nhận. Số liệu bắt đầu từ khi tính năng được bật; không tạo số liệu lịch sử giả.

Thống kê: lượt mở trang, phiên ẩn danh, tương tác, phiên có tương tác; biểu đồ theo thời gian, chức năng, hương vị, Best seller, thiết bị, ngôn ngữ. Lọc 24 giờ / 7 ngày / 30 ngày, thiết bị và nguồn local / online; xuất JSON. Phiên theo tab, hết hạn sau 30 phút không hoạt động; không phải người dùng duy nhất. Một phiên có thể có hoạt động ở nhiều mốc thời gian nên tổng các mốc không tương đương số phiên duy nhất toàn kỳ. Thiết bị là phân loại theo chiều rộng màn hình.

Sự kiện được ghi ở thao tác thực tế: mở trang, chọn Best seller/hương vị, mở sản phẩm, mở/dùng tìm kiếm, đổi ngôn ngữ, lọc bao bì, xem chi tiết, yêu thích, xem bộ sưu tập, tương tác 3D và mở menu. Tương tác 3D được gộp trong 3 giây; tìm kiếm được ghi sau 700 ms dừng gõ. Không lưu từ khóa. Tự chuyển động 3D hoặc carousel không tạo sự kiện. Admin preview không được tính traffic.

## Phạm vi an ninh

Log request API lưu thời gian, endpoint chuẩn hóa, phương thức, HTTP status, thời gian xử lý, mã request, mã nguồn ẩn danh và ID quản trị nếu đã đăng nhập. Log an ninh gộp sự kiện cùng loại / nguồn / endpoint trong 10 giây và giữ số lần. Log thao tác quản trị đọc nhật ký hiện có (save/archive/delete/publish/rollback và xác nhận cảnh báo).

Không lưu request body, mật khẩu, cookie, session token, query URL, IP gốc hoặc user agent gốc vào log vận hành. Nguồn request là HMAC của địa chỉ do transport cung cấp, với salt riêng trong SQLite. Mã nguồn dùng để đối chiếu, không dùng để truy ra IP. Log/biểu đồ chỉ được đọc sau đăng nhập; xác nhận cảnh báo chỉ dành cho owner. JSON xuất tối đa 5.000 dòng theo bộ lọc; không xuất credentials.

Quy tắc trên mỗi nguồn:

| Dấu hiệu | Ngưỡng | Cửa sổ |
| --- | ---: | ---: |
| Đăng nhập thất bại | 5 | 10 phút |
| Request vượt rate limit | 1 | 5 phút |
| Origin không được phép | 5 | 5 phút |
| Truy cập admin thiếu phiên | 10 | 5 phút |
| Dò đường dẫn nhạy cảm | 3 | 5 phút |
| Lỗi server 5xx | 3 | 5 phút |
| JSON / sự kiện không hợp lệ | 10 | 5 phút |
| Payload quá lớn | 3 | 5 phút |

Rate limit: 240 request thường / phút, 10 request login/setup / phút, 60 batch thống kê / phút / nguồn; mỗi batch tối đa 20 sự kiện. HTTP 429 có `Retry-After`. Login còn có giới hạn theo tài khoản hiện hữu. JSON login/setup tối đa 8 KiB, telemetry 32 KiB, JSON thao tác admin 1 MiB; upload tối đa 34 MiB trước bộ kiểm tra file. Giới hạn theo nguồn giữ bộ nhớ có giới hạn. Access log 429 được lấy mẫu mỗi 10 giây; bộ đếm an ninh vẫn ghi từng lần từ chối.

Cảnh báo gộp cùng loại/nguồn trong 30 phút. “Đã xem” chỉ xác nhận, không xóa bằng chứng. Nếu nguồn vẫn tiếp tục vượt ngưỡng, cảnh báo mở lại. Admin cập nhật mỗi 30 giây khi tab đang hiển thị; có thể tắt tự cập nhật hoặc tải lại thủ công. Không gửi email/Slack hay thông báo bên ngoài. Khi ghi log thất bại, API giữ phản hồi của thao tác gốc, ghi chẩn đoán tối giản ra stderr và đánh dấu giám sát suy giảm cho đến khi khởi động lại.

**Cảnh báo là dấu hiệu cần điều tra, không chứng minh website đã bị xâm nhập.** Phạm vi hiện tại là request đến API này. Không thấy các request chỉ đến GitHub Pages, file tĩnh của Next.js, request bị reverse proxy chặn, DDoS làm server mất kết nối, hay thay đổi file ngoài API. Theo dõi các phần này cần access log/WAF, kiểm tra file và giám sát hạ tầng tại hosting. Tính năng này không thay thế các lớp đó. Cách phân tách log và tránh credentials dựa trên [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

## Lưu trữ và quyền riêng tư

Các bảng `ops_*` dùng chung SQLite local với catalog nhưng độc lập các bản phát hành: đổi/rollback/xóa lịch sử phát hành không đổi thống kê và log. Giữ tối đa 30 ngày, dọn mỗi phút khi có hoạt động: 200.000 sự kiện, 100.000 request, 50.000 dòng an ninh và 10.000 cảnh báo; có thể vượt cap tạm thời giữa hai lần dọn. Audit quản trị cũ không bị xóa tự động, nhưng giao diện log chỉ truy vấn tối đa 30 ngày. Vì giới hạn lưu trữ, kỳ so sánh cũ có thể thiếu dữ liệu; với 30 ngày không có một kỳ 30 ngày trước đầy đủ.

Browser chỉ dùng sessionStorage cho phiên theo tab. Tôn trọng `navigator.doNotTrack`, Global Privacy Control và opt-out `localStorage['vinut-analytics-disabled']='1'`. Sự kiện không có nội dung tìm kiếm, đường dẫn đầy đủ, referrer, email hay cookie. Phân loại bot theo user agent có thể bỏ sót bot giả dạng; traffic gửi từ browser là dữ liệu tự báo, không phải số liệu chống gian lận. Không có GeoIP hay theo dõi xuyên website. Gửi theo batch, giữ event ID khi retry để server chống đếm trùng; queue giới hạn 100, bỏ batch lỗi 4xx. Chặn quảng cáo, offline hoặc đóng tab đột ngột có thể làm thiếu sự kiện.

## Khi có API online

GitHub Pages là site tĩnh. Khi chưa cấu hình collector, bản Pages tự tắt telemetry, không gọi máy local của người xem và không tạo số liệu online. Sau này triển khai API trên HTTPS rồi build website với:

```dotenv
NEXT_PUBLIC_TELEMETRY_URL=https://api.example.com/api/public/v1/events
ADMIN_ALLOWED_ORIGINS=https://your-site.example,https://your-admin.example
```

`NEXT_PUBLIC_TELEMETRY_URL` là địa chỉ public, không phải API key. Tuyệt đối không thêm secret vào biến `NEXT_PUBLIC_*`. Collector nhận sự kiện công khai nhưng các endpoint đọc log và thống kê vẫn bắt buộc đăng nhập. Reverse proxy phải chuyển đến API và cấu hình HTTPS/auth như môi trường triển khai hiện hữu.

Mặc định bỏ qua X-Forwarded-For. Nếu API đứng sau proxy được quản lý, đặt `ADMIN_TRUSTED_PROXIES` là các địa chỉ proxy chính xác (ví dụ `127.0.0.1,::1` cho Next proxy local). Proxy phải xóa/ghi đè forwarding header từ client. Chuỗi được đọc từ phải qua trái và dừng ở nguồn không được tin cậy. Không dùng `*` hoặc tin mọi proxy. Khi chưa cấu hình, nhiều người dùng sau cùng một proxy sẽ cùng chịu giới hạn của proxy đó.

## Kiểm thử

`npm run test:operations` kiểm tra privacy/schema, retry/dedup, session, filters, retention, alert/ack/reopen, rate limit, JSON size, quyền API, forwarding spoofing, phân trang/xuất log và lỗi ghi log. `npm run test:admin`, `npm run test:catalog`, lint, typecheck và build kiểm tra hồi quy. Các tests SQLite chạy trong thư mục tạm hoặc memory, không sửa catalog thật.

Kiểm tra UI local: mở website → chọn Best seller/hương vị → dùng tìm kiếm → xem Thống kê. Kiểm thử dấu hiệu dò đường dẫn có thể gửi 3 GET đến `/api/admin/v1/.env` ở API local; xem cảnh báo và bấm Đã xem. Đây là dữ liệu thử nghiệm; không diễn giải thành một vụ tấn công thật.
