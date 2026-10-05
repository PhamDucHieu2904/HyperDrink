export const USAGE_EVENTS = {
  page_view: 'Mở website', group_select: 'Chọn Best seller', flavor_select: 'Chọn hương vị',
  product_open: 'Mở sản phẩm', search_open: 'Mở tìm kiếm', search_use: 'Dùng tìm kiếm',
  language_select: 'Đổi ngôn ngữ', packaging_filter: 'Lọc bao bì', detail_open: 'Xem chi tiết',
  favorite: 'Yêu thích', collection_open: 'Xem bộ sưu tập', model_interact: 'Tương tác 3D', menu_open: 'Mở menu',
} as const;
export type UsageEventName = keyof typeof USAGE_EVENTS;
export type Device = 'desktop' | 'mobile' | 'tablet';
export type TrafficScope = 'local' | 'production';
export type Severity = 'info' | 'warning' | 'critical';
export interface UsageEvent { id: string; name: UsageEventName; target?: string }
export interface UsageBatch { sessionId: string; device: Device; locale: string; events: UsageEvent[] }
export interface AnalyticsFilter { days: 1 | 7 | 30; device: Device | 'all'; scope: TrafficScope | 'all' }
export interface AnalyticsReport {
  generatedAt: string; firstEventAt: string | null; filters: AnalyticsFilter;
  totals: { views: number; sessions: number; interactions: number; engagedSessions: number };
  previous: { views: number; sessions: number; interactions: number; engagedSessions: number };
  trend: { time: string; views: number; sessions: number; interactions: number }[];
  features: { name: UsageEventName; count: number; sessions: number }[];
  devices: { name: string; count: number }[]; languages: { name: string; count: number }[];
  products: { id: string; count: number }[]; groups: { id: string; count: number }[];
  retentionDays: number;
}
export interface SecurityAlert {
  id: string; type: string; severity: Severity; source: string; count: number;
  firstAt: string; lastAt: string; acknowledgedAt: string | null; acknowledgedBy: string | null;
}
export interface OperationLog {
  id: string; time: string; kind: 'request' | 'security' | 'audit'; severity: Severity;
  action: string; route: string; method: string; status: number | null;
  durationMs: number | null; source: string; actor: string; requestId: string; count: number;
}
export interface SecurityReport {
  generatedAt: string; startedAt: string; monitoring: 'active' | 'degraded'; retentionDays: number;
  totals: { requests: number; errors: number; blocked: number; failedLogins: number; openAlerts: number; averageMs: number };
  trend: { time: string; requests: number; blocked: number; errors: number }[];
  alerts: SecurityAlert[];
  rules: { type: string; threshold: number; minutes: number }[];
}
export interface LogFilter { kind: 'request' | 'security' | 'audit'; severity: Severity | 'all'; days: 1 | 7 | 30; page: number }
export interface LogReport { rows: OperationLog[]; total: number; page: number; pageSize: number }
export const SECURITY_TYPES: Record<string, { label: string; help: string }> = {
  login_failed: { label: 'Đăng nhập thất bại liên tục', help: 'Kiểm tra nguồn request và tài khoản quản trị; đổi mật khẩu nếu có dấu hiệu sử dụng trái phép.' },
  rate_limited: { label: 'Spam request bị giới hạn', help: 'Nguồn này đã bị trả HTTP 429. Kiểm tra log; chặn tại reverse proxy nếu tiếp tục.' },
  origin_blocked: { label: 'Nguồn truy cập API không được phép', help: 'Kiểm tra cấu hình origin. Không thêm domain lạ vào danh sách cho phép.' },
  unauthorized: { label: 'Truy cập quản trị không có phiên hợp lệ', help: 'Đối chiếu thời gian với phiên hết hạn; nguồn lặp lại nhiều lần có thể đang dò API.' },
  path_probe: { label: 'Dò đường dẫn nhạy cảm', help: 'Request tìm file cấu hình hoặc trang quản trị không tồn tại. Kiểm tra nguồn và chặn ở proxy khi cần.' },
  server_error: { label: 'Lỗi API phía server', help: 'Đối chiếu mã request với log server; kiểm tra ổ đĩa, database và trạng thái dịch vụ.' },
  invalid_payload: { label: 'Payload không hợp lệ liên tục', help: 'Có thể là client lỗi hoặc dữ liệu gửi tự động. Kiểm tra endpoint và phiên bản website.' },
  oversized: { label: 'Request vượt kích thước cho phép', help: 'Payload đã bị từ chối. Đối chiếu giới hạn upload và nguồn gửi request.' },
};
