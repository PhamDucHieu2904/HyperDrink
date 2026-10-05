import type { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { AnalyticsFilter, AnalyticsReport, LogFilter, LogReport, OperationLog, SecurityAlert, SecurityReport, Severity, TrafficScope, UsageBatch } from '@/lib/operations/contracts';
import { USAGE_EVENTS } from '@/lib/operations/contracts';

const DAY = 86_400_000;
export const RETENTION_DAYS = 30;
export const DETECTION_RULES = [
  { type: 'login_failed', threshold: 5, minutes: 10 }, { type: 'rate_limited', threshold: 1, minutes: 5 },
  { type: 'origin_blocked', threshold: 5, minutes: 5 }, { type: 'unauthorized', threshold: 10, minutes: 5 },
  { type: 'path_probe', threshold: 3, minutes: 5 }, { type: 'server_error', threshold: 3, minutes: 5 },
  { type: 'invalid_payload', threshold: 10, minutes: 5 }, { type: 'oversized', threshold: 3, minutes: 5 },
];
type Row = Record<string, string | number | null>;
export function trafficScope(origin: string): TrafficScope {
  const host = new URL(origin).hostname;
  return ['localhost', '127.0.0.1', '[::1]'].includes(host) ? 'local' : 'production';
}
export function parseUsageBatch(input: unknown): UsageBatch {
  const invalid = () => { throw Object.assign(new Error('Sự kiện thống kê không hợp lệ.'), { code: 'INVALID_TELEMETRY' }); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const value = input as Record<string, unknown>;
  const uuid = (id: unknown) => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
  if (!uuid(value.sessionId) || !['desktop', 'mobile', 'tablet'].includes(String(value.device)) || !['en','fr','zh','es','ar','ru','ko','de'].includes(String(value.locale)) || !Array.isArray(value.events) || value.events.length < 1 || value.events.length > 20) return invalid();
  const events = value.events.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid();
    const event = item as Record<string, unknown>;
    if (!uuid(event.id) || typeof event.name !== 'string' || !Object.hasOwn(USAGE_EVENTS, event.name) || (event.target !== undefined && (typeof event.target !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(event.target)))) return invalid();
    return { id: event.id as string, name: event.name as keyof typeof USAGE_EVENTS, ...(event.target ? { target: event.target as string } : {}) };
  });
  // Arbitrary fields, search text, credentials and client timestamps are deliberately not retained.
  return { sessionId: value.sessionId as string, device: value.device as UsageBatch['device'], locale: value.locale as string, events };
}
export function analyticsFilter(params: URLSearchParams): AnalyticsFilter {
  const days = Number(params.get('days') || 7), device = params.get('device') || 'all', scope = params.get('scope') || 'all';
  if (![1,7,30].includes(days) || !['all','desktop','mobile','tablet'].includes(device) || !['all','local','production'].includes(scope)) throw new Error('Bộ lọc thống kê không hợp lệ.');
  return { days, device, scope } as AnalyticsFilter;
}
export function logFilter(params: URLSearchParams): LogFilter {
  const kind = params.get('kind') || 'security', severity = params.get('severity') || 'all', days = Number(params.get('days') || 1), page = Number(params.get('page') || 1);
  if (!['request','security','audit'].includes(kind) || !['all','info','warning','critical'].includes(severity) || ![1,7,30].includes(days) || !Number.isInteger(page) || page < 1 || page > 100000) throw new Error('Bộ lọc log không hợp lệ.');
  return { kind, severity, days, page } as LogFilter;
}

export class OperationsStore {
  private salt: string;
  private lastPruned = 0;
  private failed = false;
  constructor(private db: DatabaseSync, private now: () => number = Date.now) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ops_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ops_usage (id TEXT PRIMARY KEY, time INTEGER NOT NULL, session TEXT NOT NULL, event TEXT NOT NULL, target TEXT NOT NULL, device TEXT NOT NULL, locale TEXT NOT NULL, scope TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ops_usage_time ON ops_usage(time);
      CREATE TABLE IF NOT EXISTS ops_requests (id TEXT PRIMARY KEY, time INTEGER NOT NULL, route TEXT NOT NULL, method TEXT NOT NULL, status INTEGER NOT NULL, duration INTEGER NOT NULL, source TEXT NOT NULL, actor TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ops_requests_time ON ops_requests(time);
      CREATE TABLE IF NOT EXISTS ops_security (id TEXT PRIMARY KEY, time INTEGER NOT NULL, type TEXT NOT NULL, severity TEXT NOT NULL, route TEXT NOT NULL, source TEXT NOT NULL, request_id TEXT NOT NULL, count INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS ops_security_time ON ops_security(time);
      CREATE INDEX IF NOT EXISTS ops_security_source ON ops_security(type,source,time);
      CREATE TABLE IF NOT EXISTS ops_alerts (id TEXT PRIMARY KEY, type TEXT NOT NULL, severity TEXT NOT NULL, source TEXT NOT NULL, count INTEGER NOT NULL, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, acknowledged_at INTEGER, acknowledged_by TEXT);
      CREATE INDEX IF NOT EXISTS ops_alerts_source ON ops_alerts(type,source,last_at);
    `);
    db.prepare('INSERT OR IGNORE INTO ops_meta VALUES(?,?)').run('salt', randomBytes(32).toString('hex'));
    db.prepare('INSERT OR IGNORE INTO ops_meta VALUES(?,?)').run('startedAt', String(now()));
    this.salt = String(db.prepare("SELECT value FROM ops_meta WHERE key='salt'").get()!.value);
    this.prune();
  }
  private rows(sql: string, ...values: (string | number)[]): Row[] { return this.db.prepare(sql).all(...values) as Row[]; }
  pseudonym(value: string) { return createHmac('sha256', this.salt).update(value).digest('hex').slice(0,16); }
  markDegraded() { this.failed = true; }
  private prune() {
    const now = this.now(); if (this.lastPruned && now - this.lastPruned < 60_000) return;
    const cutoff = now - RETENTION_DAYS * DAY;
    for (const [table, cap] of [['ops_usage',200000],['ops_requests',100000],['ops_security',50000],['ops_alerts',10000]] as const) {
      const field = table === 'ops_alerts' ? 'last_at' : 'time';
      this.db.prepare(`DELETE FROM ${table} WHERE ${field}<?`).run(cutoff);
      this.db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} ORDER BY ${field} DESC,rowid DESC LIMIT -1 OFFSET ?)`).run(cap);
    }
    this.lastPruned = now;
  }
  ingest(batch: UsageBatch, scope: TrafficScope, bot: boolean) {
    if (bot) return 0;
    this.prune();
    const insert = this.db.prepare('INSERT OR IGNORE INTO ops_usage VALUES(?,?,?,?,?,?,?,?)');
    let accepted = 0;
    for (const event of batch.events) accepted += Number(insert.run(event.id, this.now(), this.pseudonym(`${scope}:${batch.sessionId}`), event.name, event.target || '', batch.device, batch.locale, scope).changes);
    return accepted;
  }
  request(input: { id: string; route: string; method: string; status: number; duration: number; source: string; actor?: string }) {
    this.prune();
    // Repeated blocked requests use sampled access logs; security counters still retain every rejection.
    if (input.status === 429 && this.rows('SELECT id FROM ops_requests WHERE source=? AND status=429 AND time>? LIMIT 1', input.source, this.now()-10000).length) return;
    this.db.prepare('INSERT INTO ops_requests VALUES(?,?,?,?,?,?,?,?)').run(input.id, this.now(), input.route, input.method, input.status, input.duration, input.source, input.actor || '');
  }
  signal(type: string, source: string, route: string, requestId: string) {
    const rule = DETECTION_RULES.find(item => item.type === type); if (!rule) return;
    this.prune();
    const now = this.now(), severity: Severity = type === 'server_error' ? 'critical' : 'warning';
    const bucket = Math.floor(now / 10000), id = this.pseudonym(`${type}:${source}:${route}:${bucket}`);
    this.db.prepare('INSERT INTO ops_security VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET count=count+1,time=excluded.time,request_id=excluded.request_id').run(id, now, type, severity, route, source, requestId);
    const count = Number(this.rows('SELECT COALESCE(SUM(count),0) AS n FROM ops_security WHERE type=? AND source=? AND time>?', type, source, now-rule.minutes*60000)[0].n);
    if (count < rule.threshold) return;
    const previous = this.rows('SELECT id FROM ops_alerts WHERE type=? AND source=? AND last_at>? ORDER BY last_at DESC LIMIT 1', type, source, now-30*60000)[0];
    if (previous) this.db.prepare('UPDATE ops_alerts SET count=?,last_at=?,acknowledged_at=NULL,acknowledged_by=NULL WHERE id=?').run(count, now, String(previous.id));
    else this.db.prepare('INSERT INTO ops_alerts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(randomUUID(), type, severity, source, count, now, now);
  }
  acknowledge(id: string, actor: string) {
    const result = this.db.prepare('UPDATE ops_alerts SET acknowledged_at=?,acknowledged_by=? WHERE id=?').run(this.now(), actor, id);
    if (!result.changes) throw new Error('Cảnh báo không còn tồn tại.');
    this.db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)').run(randomUUID(),actor,'acknowledge:alert',id,new Date(this.now()).toISOString());
  }
  analytics(filters: AnalyticsFilter): AnalyticsReport {
    this.prune();
    const now = this.now(), start = now - filters.days * DAY;
    const clauses = ['time>=?', 'time<=?'], dimensions: string[] = [];
    if (filters.device !== 'all') { clauses.push('device=?'); dimensions.push(filters.device); }
    if (filters.scope !== 'all') { clauses.push('scope=?'); dimensions.push(filters.scope); }
    const where = clauses.join(' AND '), values = [start,now,...dimensions];
    const totals = (from: number, to: number) => {
      const result = this.rows(`SELECT COALESCE(SUM(event='page_view'),0) views,COUNT(DISTINCT session) sessions,COALESCE(SUM(event!='page_view'),0) interactions,COUNT(DISTINCT CASE WHEN event!='page_view' THEN session END) engagedSessions FROM ops_usage WHERE ${where}`, from,to,...dimensions)[0];
      return { views: Number(result.views), sessions: Number(result.sessions), interactions: Number(result.interactions), engagedSessions: Number(result.engagedSessions) };
    };
    const bucket = filters.days === 1 ? 3600000 : DAY;
    const buckets = this.rows(`SELECT CAST(time/? AS INTEGER)*? bucket,COALESCE(SUM(event='page_view'),0) views,COUNT(DISTINCT session) sessions,COALESCE(SUM(event!='page_view'),0) interactions FROM ops_usage WHERE ${where} GROUP BY bucket`, bucket,bucket,...values);
    const trend: AnalyticsReport['trend'] = [];
    for (let time = Math.floor(start/bucket)*bucket; time <= now; time += bucket) {
      const row = buckets.find(item => Number(item.bucket) === time);
      trend.push({ time: new Date(time).toISOString(), views: Number(row?.views || 0), sessions: Number(row?.sessions || 0), interactions: Number(row?.interactions || 0) });
    }
    const distribution = (dimension: 'device' | 'locale') => this.rows(`SELECT ${dimension} name,COUNT(*) count FROM ops_usage WHERE ${where} AND event='page_view' GROUP BY ${dimension} ORDER BY count DESC`, ...values).map(row => ({ name: String(row.name), count: Number(row.count) }));
    const targets = (event: string) => this.rows(`SELECT target id,COUNT(*) count FROM ops_usage WHERE ${where} AND event=? AND target!='' GROUP BY target ORDER BY count DESC LIMIT 10`, ...values,event).map(row => ({ id: String(row.id), count: Number(row.count) }));
    return { generatedAt: new Date(now).toISOString(), firstEventAt: this.rows('SELECT MIN(time) time FROM ops_usage')[0].time ? new Date(Number(this.rows('SELECT MIN(time) time FROM ops_usage')[0].time)).toISOString() : null, filters,
      totals: totals(start,now), previous: totals(start-filters.days*DAY,start-1), trend,
      features: this.rows(`SELECT event name,COUNT(*) count,COUNT(DISTINCT session) sessions FROM ops_usage WHERE ${where} AND event!='page_view' GROUP BY event ORDER BY count DESC`, ...values).map(row => ({ name: String(row.name) as keyof typeof USAGE_EVENTS, count: Number(row.count), sessions: Number(row.sessions) })),
      devices: distribution('device'), languages: distribution('locale'), products: targets('flavor_select'), groups: targets('group_select'), retentionDays: RETENTION_DAYS };
  }
  security(): SecurityReport {
    this.prune();
    const now = this.now(), start = now-DAY;
    const request = this.rows('SELECT COUNT(*) requests,COALESCE(SUM(status>=500),0) errors,COALESCE(AVG(duration),0) averageMs FROM ops_requests WHERE time>=?', start)[0];
    const count = (types: string[]) => Number(this.rows(`SELECT COALESCE(SUM(count),0) n FROM ops_security WHERE time>=? AND type IN (${types.map(()=>'?').join(',')})`,start,...types)[0].n);
    const alerts: SecurityAlert[] = this.rows('SELECT * FROM ops_alerts ORDER BY acknowledged_at IS NULL DESC,last_at DESC LIMIT 100').map(row=>({ id:String(row.id), type:String(row.type), severity:row.severity as Severity, source:String(row.source),count:Number(row.count),firstAt:new Date(Number(row.first_at)).toISOString(),lastAt:new Date(Number(row.last_at)).toISOString(),acknowledgedAt:row.acknowledged_at?new Date(Number(row.acknowledged_at)).toISOString():null,acknowledgedBy:row.acknowledged_by as string|null }));
    const trend: SecurityReport['trend'] = [];
    for(let time=Math.floor(start/3600000)*3600000;time<=now;time+=3600000) {
      const row=this.rows('SELECT COUNT(*) requests,COALESCE(SUM(status>=500),0) errors FROM ops_requests WHERE time>=? AND time<?',time,time+3600000)[0];
      const blocked=Number(this.rows("SELECT COALESCE(SUM(count),0) n FROM ops_security WHERE time>=? AND time<? AND type='rate_limited'",time,time+3600000)[0].n);
      trend.push({time:new Date(time).toISOString(),requests:Number(row.requests),errors:Number(row.errors),blocked});
    }
    return {generatedAt:new Date(now).toISOString(),startedAt:new Date(Number(this.rows("SELECT value FROM ops_meta WHERE key='startedAt'")[0].value)).toISOString(),monitoring:this.failed?'degraded':'active',retentionDays:RETENTION_DAYS,
      totals:{requests:Number(request.requests),errors:Number(request.errors),averageMs:Math.round(Number(request.averageMs)),blocked:count(['rate_limited','origin_blocked','oversized']),failedLogins:count(['login_failed']),openAlerts:Number(this.rows('SELECT COUNT(*) n FROM ops_alerts WHERE acknowledged_at IS NULL')[0].n)},alerts,trend,rules:DETECTION_RULES};
  }
  logs(filter: LogFilter, exportAll = false): LogReport {
    const start = this.now()-filter.days*DAY;
    const tables = {
      request: "SELECT id,time,'request' kind,CASE WHEN status>=500 THEN 'critical' WHEN status>=400 THEN 'warning' ELSE 'info' END severity,'http_request' action,route,method,status,duration durationMs,source,actor,id requestId,1 count FROM ops_requests",
      security: "SELECT id,time,'security' kind,severity,type action,route,'' method,NULL status,NULL durationMs,source,'' actor,request_id requestId,count FROM ops_security",
      audit: "SELECT id,CAST(strftime('%s',created_at) AS INTEGER)*1000 time,'audit' kind,'info' severity,action,entity_id route,'' method,NULL status,NULL durationMs,'' source,actor,'' requestId,1 count FROM audit_events",
    };
    const where=`time>=?${filter.severity==='all'?'':' AND severity=?'}`,args:(string|number)[]=[start];
    if(filter.severity!=='all')args.push(filter.severity);
    const sql=`FROM (${tables[filter.kind]}) WHERE ${where}`;
    const total=Number(this.rows(`SELECT COUNT(*) n ${sql}`,...args)[0].n),pageSize=exportAll?5000:50;
    const page=Math.min(filter.page,Math.max(1,Math.ceil(total/pageSize)));
    const rows=this.rows(`SELECT * ${sql} ORDER BY time DESC,id DESC LIMIT ? OFFSET ?`,...args,pageSize,exportAll?0:(page-1)*pageSize).map(row=>({...row,time:new Date(Number(row.time)).toISOString()})) as unknown as OperationLog[];
    return {rows,total,page,pageSize};
  }
}
