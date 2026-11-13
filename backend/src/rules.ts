// 순수 규칙 함수 모음 (DB 없이 단위 테스트 가능) — 기능명세서 3장

/** R-1 전화번호 정규화: 숫자만, +82 → 0. 유효하지 않으면 null */
export function normalizePhone(input?: string | null): string | null {
  if (!input) return null;
  let d = String(input).replace(/\D/g, '');
  if (d.startsWith('82') && d.length >= 11 && d.length <= 12) d = '0' + d.slice(2);
  if (!/^0\d{9,10}$/.test(d)) return null;
  return d;
}

export function isPhoneLike(input?: string | null): boolean {
  return !!input && String(input).replace(/\D/g, '').length > 0;
}

/** KST 기준 날짜/시각 분해 */
export function kstParts(d: Date) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return {
    date: k.toISOString().slice(0, 10), // YYYY-MM-DD
    minutes: k.getUTCHours() * 60 + k.getUTCMinutes(),
    weekday: k.getUTCDay(), // 0=일
  };
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

export function todayKst(now = new Date()): string {
  return kstParts(now).date;
}

export interface ShipRuleSettings {
  cutoffMinutes: number; // 15:00 → 900
  shipWeekdays: number[]; // [1,2,3,4]
}

export const DEFAULT_SHIP_SETTINGS: ShipRuleSettings = { cutoffMinutes: 15 * 60, shipWeekdays: [1, 2, 3, 4] };

/**
 * R-8 발송 예정일
 * ① 기준일 = 기준 시각의 KST 날짜, 마감(15:00) 이후면 다음 날
 * ② 예약이면 max(기준일, 판매 시작일)
 * ③ 발송 요일(월~목, 모든 품목이 금요일 허용이면 금 포함)인 첫날
 */
export function calcShipDate(
  at: Date,
  opts: { saleStartDates?: string[]; allowFriday?: boolean },
  s: ShipRuleSettings = DEFAULT_SHIP_SETTINGS,
): string {
  const p = kstParts(at);
  let base = p.minutes >= s.cutoffMinutes ? addDays(p.date, 1) : p.date;
  for (const start of opts.saleStartDates || []) if (start > base) base = start;
  const days = new Set(s.shipWeekdays);
  if (opts.allowFriday) days.add(5);
  for (let i = 0; i < 14; i++) {
    if (days.has(weekdayOf(base))) return base;
    base = addDays(base, 1);
  }
  return base;
}

/** R-6 판매 한도 */
export function saleLimit(p: { expectedHarvestBoxes: number; safetyRatio: number; actualHarvestBoxes: number | null }): number {
  if (p.actualHarvestBoxes != null) return p.actualHarvestBoxes;
  return Math.floor(p.expectedHarvestBoxes * Number(p.safetyRatio) + 1e-9);
}

/** R-11 사고 접수 기한 초과 여부 */
export function isIncidentLate(receivedDate: string, reportedAt: Date, deadlineDays = 2): boolean {
  return kstParts(reportedAt).date > addDays(receivedDate, deadlineDays);
}

/** 상품명/옵션 텍스트에서 등급 해석 */
export function parseGrade(text: string): 'gift' | 'home' | null {
  if (/선물/.test(text)) return 'gift';
  if (/가정|못난이|실속/.test(text)) return 'home';
  return null;
}

export function parseKg(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(kg|키로|킬로)/i);
  return m ? Number(m[1]) : null;
}
