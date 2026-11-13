import { calcShipDate, isIncidentLate, normalizePhone, saleLimit } from './rules';

// KST 시각 → Date
const kst = (s: string) => new Date(s + '+09:00');

describe('R-1 전화번호 정규화', () => {
  it('형식이 달라도 같은 번호', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
    expect(normalizePhone('01012345678')).toBe('01012345678');
    expect(normalizePhone('+82 10 1234 5678')).toBe('01012345678');
    expect(normalizePhone('031-123-4567')).toBe('0311234567');
  });
  it('잘못된 번호는 null', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('1234')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('R-8 발송 예정일 (2026-11-12 목, 11-13 금)', () => {
  it('목 16:00 → 월', () => expect(calcShipDate(kst('2026-11-12T16:00:00'), {})).toBe('2026-11-16'));
  it('목 14:59 → 목 당일', () => expect(calcShipDate(kst('2026-11-12T14:59:00'), {})).toBe('2026-11-12'));
  it('금 10:00 → 월', () => expect(calcShipDate(kst('2026-11-13T10:00:00'), {})).toBe('2026-11-16'));
  it('일 → 월', () => expect(calcShipDate(kst('2026-11-15T09:00:00'), {})).toBe('2026-11-16'));
  it('월 14:59 → 월 당일', () => expect(calcShipDate(kst('2026-11-16T14:59:00'), {})).toBe('2026-11-16'));
  it('월 15:00 → 화', () => expect(calcShipDate(kst('2026-11-16T15:00:00'), {})).toBe('2026-11-17'));
  it('금요일 허용 상품: 금 10:00 → 금', () =>
    expect(calcShipDate(kst('2026-11-13T10:00:00'), { allowFriday: true })).toBe('2026-11-13'));
  it('예약: 판매 시작일 10/24(토) → 10/26(월)', () =>
    expect(calcShipDate(kst('2026-10-01T10:00:00'), { saleStartDates: ['2026-10-24'] })).toBe('2026-10-26'));
});

describe('R-6 판매 한도', () => {
  it('예상 × 70% (내림)', () => expect(saleLimit({ expectedHarvestBoxes: 15, safetyRatio: 0.7, actualHarvestBoxes: null })).toBe(10));
  it('실제 수확량 있으면 실제 수확량', () =>
    expect(saleLimit({ expectedHarvestBoxes: 15, safetyRatio: 0.7, actualHarvestBoxes: 12 })).toBe(12));
});

describe('R-11 사고 접수 기한', () => {
  it('받은 날 + 2일까지는 기한 안', () => expect(isIncidentLate('2026-11-10', kst('2026-11-12T23:00:00'))).toBe(false));
  it('받은 날 + 3일은 기한 초과', () => expect(isIncidentLate('2026-11-10', kst('2026-11-13T09:00:00'))).toBe(true));
});
