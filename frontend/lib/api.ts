'use client';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export type Role = 'admin' | 'packer' | 'stock';
export interface User {
  id: number;
  name: string;
  role: Role;
}

export class ApiError extends Error {
  status: number;
  details: string[];
  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
}
export function getUser(): User | null {
  try {
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  } catch {
    return null;
  }
}
export function saveLogin(token: string, user: User) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}
export function logout() {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  } catch {}
}

export function homeFor(role?: Role) {
  return role === 'packer' ? '/packing' : role === 'stock' ? '/stock' : '/';
}

/** 공통 fetch: Bearer 토큰, 401 → 로그인, 서버 에러 메시지 그대로 */
export async function api<T = any>(path: string, opts: { method?: string; body?: any; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: any = undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(API_URL + path, { method: opts.method || (body ? 'POST' : 'GET'), headers, body });
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요');
  }
  if (res.status === 401 && !path.startsWith('/auth/')) {
    logout();
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new ApiError(401, '로그인이 필요합니다');
  }
  if (!res.ok) {
    let data: any = null;
    try {
      data = await res.json();
    } catch {}
    if (res.status === 403) throw new ApiError(403, '권한이 없습니다');
    let msg = data?.message ?? `요청 실패 (${res.status})`;
    if (Array.isArray(msg)) msg = msg.join(', ');
    const details = Array.isArray(data?.details) ? data.details.map(String) : [];
    throw new ApiError(res.status, String(msg), details);
  }
  if (opts.raw) return res as any;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export function errInfo(e: any): { message: string; details: string[] } {
  if (e instanceof ApiError) return { message: e.message, details: e.details };
  return { message: e?.message || '알 수 없는 오류', details: [] };
}

// ---------- 표시 도우미 (KST) ----------
const WD = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' → 11/16(월) */
export function fmtDate(d?: string | null) {
  if (!d) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  const wd = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return `${+m[2]}/${+m[3]}(${WD[wd]})`;
}

/** timestamp → KST '11/13 14:05' */
export function fmtDateTime(t?: string | null) {
  if (!t) return '-';
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(t);
  const k = new Date(d.getTime() + 9 * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${WD[k.getUTCDay()]}) ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

/** 오늘 KST 'YYYY-MM-DD' */
export function todayKst() {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

export function addDays(d: string, n: number) {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** 다음 월~목 발송일 n개 (오늘 포함 여부 선택) */
export function nextShipDays(from: string, n = 4, includeFrom = true) {
  const out: string[] = [];
  let d = includeFrom ? from : addDays(from, 1);
  while (out.length < n) {
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    if (wd >= 1 && wd <= 4) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export function weekday(d: string) {
  return new Date(d + 'T00:00:00Z').getUTCDay();
}

export function fmtPhone(p?: string | null) {
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return p;
}

export function won(n?: number | null) {
  return (n ?? 0).toLocaleString('ko-KR') + '원';
}

export const CHANNEL_LABEL: Record<string, string> = { smartstore: '스마트스토어', kakao: '카카오톡', phone: '전화' };
export const SHIP_STATUS_LABEL: Record<string, string> = { pending: '대기', packed: '포장완료', shipped: '발송완료' };

export function itemSummary(o: any) {
  const m = new Map<string, number>();
  for (const s of o.shipments || []) for (const i of s.items || []) m.set(i.label, (m.get(i.label) || 0) + i.qtyBoxes);
  return [...m].map(([l, q]) => `${l} ${q}박스`).join(', ');
}

export function shipDates(o: any) {
  const ds = [...new Set((o.shipments || []).filter((s: any) => !s.isReship).map((s: any) => s.shipDate))] as string[];
  return ds.map(fmtDate).join(', ') || '-';
}

