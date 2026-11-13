/* 시험 데이터 (전부 가상) — 기획서 8장
 * 실행: npm run seed  (DB를 비우고 다시 채움)
 */
import 'dotenv/config';
import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import { AppModule } from '../app.module';
import { AuthUser } from '../auth';
import { Customer, Incident, IncidentLog, IncidentPhoto, Order, Product, Shipment, User, Variety } from '../entities';
import { OrdersService } from '../orders';
import { QaService } from '../ai';
import { calcShipDate, todayKst } from '../rules';
import { CENTER_DOC, FARM_NOTES } from './knowledge';

// 결정적 난수 (매번 같은 데이터)
let seed = 15;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const kst = (s: string) => new Date(s + '+09:00');

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권'];
const GIVEN = ['영희', '철수', '순자', '미경', '정숙', '영수', '말순', '복희', '상철', '은주', '경자', '명수', '현숙', '종철', '옥순'];
const CITIES = ['서울시 마포구 망원로', '서울시 노원구 동일로', '경기도 수원시 팔달로', '경기도 고양시 중앙로', '인천시 남동구 구월로', '대전시 서구 둔산로', '대구시 수성구 달구벌대로', '부산시 해운대구 센텀로', '광주시 북구 용봉로', '경북 안동시 경동로'];
const addr = () => `${pick(CITIES)} ${Math.floor(rnd() * 300) + 1}, ${Math.floor(rnd() * 20) + 1}0${Math.floor(rnd() * 9) + 1}호`;
const phone = (i: number) => `010${String(2000 + ((i * 137) % 7999)).padStart(4, "0")}${String(1000 + ((i * 7919) % 9000)).padStart(4, '0')}`;

async function main() {
  const pw = process.env.SEED_PASSWORD;
  if (!pw) throw new Error('SEED_PASSWORD 환경 변수를 설정해 주세요 (시드 계정 비밀번호)');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const ds = app.get(DataSource);
  const orders = app.get(OrdersService);
  const qa = app.get(QaService);
  console.log('DB 초기화…');
  await ds.synchronize(true);

  // ---------- 사용자 3명 ----------
  const hash = await bcrypt.hash(pw, 10);
  const users = await ds.getRepository(User).save([
    { loginId: 'jungwoo', passwordHash: hash, name: '정우', role: 'admin' },
    { loginId: 'mom', passwordHash: hash, name: '어머니', role: 'packer' },
    { loginId: 'dad', passwordHash: hash, name: '아버지', role: 'stock' },
  ] as User[]);
  const admin: AuthUser = { id: users[0].id, name: '정우', role: 'admin' };
  const mom: AuthUser = { id: users[1].id, name: '어머니', role: 'packer' };

  // ---------- 품종·상품 (가격 가상) ----------
  const V = await ds.getRepository(Variety).save([
    { crop: '사과', name: '홍로', saleStartDate: '2026-09-07' },
    { crop: '사과', name: '부사', saleStartDate: '2026-10-26' },
    { crop: '배', name: '신고', saleStartDate: '2026-11-18' }, // 시연: 아직 판매 전 → 예약
    { crop: '감자', name: '수미', saleStartDate: '2026-07-01' },
  ] as Variety[]);
  const P = await ds.getRepository(Product).save([
    { varietyId: V[0].id, grade: 'gift', boxKg: 5, price: 45000, expectedHarvestBoxes: 120, safetyRatio: 0.7, actualHarvestBoxes: 95 },
    { varietyId: V[0].id, grade: 'home', boxKg: 5, price: 28000, expectedHarvestBoxes: 150, safetyRatio: 0.7, actualHarvestBoxes: 130 },
    { varietyId: V[1].id, grade: 'gift', boxKg: 5, price: 48000, expectedHarvestBoxes: 15, safetyRatio: 0.7 }, // 한도 10 (시연용)
    { varietyId: V[1].id, grade: 'gift', boxKg: 10, price: 85000, expectedHarvestBoxes: 80, safetyRatio: 0.7 },
    { varietyId: V[1].id, grade: 'home', boxKg: 5, price: 30000, expectedHarvestBoxes: 200, safetyRatio: 0.7 },
    { varietyId: V[1].id, grade: 'home', boxKg: 10, price: 52000, expectedHarvestBoxes: 150, safetyRatio: 0.7 },
    { varietyId: V[2].id, grade: 'gift', boxKg: 7.5, price: 55000, expectedHarvestBoxes: 60, safetyRatio: 0.7 },
    { varietyId: V[2].id, grade: 'home', boxKg: 7.5, price: 35000, expectedHarvestBoxes: 80, safetyRatio: 0.7 },
    { varietyId: V[3].id, grade: 'home', boxKg: 10, price: 25000, expectedHarvestBoxes: 100, safetyRatio: 0.7, actualHarvestBoxes: 90 },
    { varietyId: V[3].id, grade: 'home', boxKg: 20, price: 42000, expectedHarvestBoxes: 60, safetyRatio: 0.7, actualHarvestBoxes: 55 },
  ] as Product[]);
  const [HONG_G, HONG_H, BU_G5, BU_G10, BU_H5, BU_H10, SIN_G, SIN_H, SU_10, SU_20] = P;

  // ---------- 고객 30명 ----------
  const people: { name: string; phone: string }[] = [];
  for (let i = 0; i < 30; i++) people.push({ name: SURNAMES[i % SURNAMES.length] + GIVEN[(i * 4) % GIVEN.length], phone: phone(i) });
  people[0] = { name: '김순자', phone: '01023456789' }; // "순자 어머님"과 같은 번호
  people[1] = { name: '박정호', phone: '01034567890' }; // 명절 5곳 주문 고객
  const custRepo = ds.getRepository(Customer);
  const customers = await custRepo.save(people.map((p) => ({ phone: p.phone, displayName: p.name, knownNames: [p.name] })));
  customers[0].knownNames = ['김순자', '순자 어머님'];
  await custRepo.save(customers[0]);

  // ---------- 지난해 주문 100건 (재고 시즌 밖, 이미 발송) ----------
  const lastYearProducts = [HONG_G, HONG_H, BU_G5, BU_G10, BU_H5, BU_H10, SIN_G, SU_10];
  const orderRepo = ds.getRepository(Order);
  for (let n = 0; n < 100; n++) {
    const ci = n < 4 ? 0 : n < 6 ? 1 : Math.floor(rnd() * 30);
    const c = customers[ci];
    const name = ci === 0 && n % 2 === 1 ? '순자 어머님' : c.displayName;
    const day = new Date(Date.UTC(2025, 8, 5) + Math.floor(rnd() * 75) * 86400000);
    const orderedAt = new Date(day.getTime() + (1 + Math.floor(rnd() * 8)) * 3600000);
    const nShip = ci === 1 && n === 4 ? 5 : rnd() < 0.15 ? 2 : 1;
    const shipments: any[] = [];
    let total = 0;
    const baseP = pick(lastYearProducts);
    const qty = 1 + Math.floor(rnd() * 3);
    for (let s = 0; s < nShip; s++) {
      const p = nShip === 5 ? BU_G5 : s === 0 ? baseP : pick(lastYearProducts);
      const q = nShip === 5 ? 2 : s === 0 ? qty : 1;
      total += p.price * q;
      const self = s === 0 && nShip < 5;
      shipments.push({
        recipientName: self ? name : `${pick(SURNAMES)}${pick(GIVEN)}`,
        recipientPhone: self ? c.phone : phone(100 + n * 5 + s),
        address: self ? `${['서울시 강동구 천호대로', '경기도 성남시 분당로'][ci % 2]} ${100 + ci}, ${ci + 1}01호` : addr(),
        shipDate: calcShipDate(orderedAt, {}),
        status: 'shipped',
        shippedAt: orderedAt,
        items: [{ productId: p.id, qtyBoxes: q, unitPrice: p.price }],
      });
    }
    await orderRepo.save(
      orderRepo.create({
        channel: pick(['smartstore', 'kakao', 'phone', 'kakao'] as const),
        externalOrderNo: null,
        customerId: c.id,
        ordererName: name,
        ordererPhone: c.phone,
        nameMismatch: name !== c.displayName,
        senderName: name,
        status: 'confirmed',
        paymentMethod: 'prepaid',
        paymentStatus: 'paid',
        totalAmount: total,
        orderedAt,
        shipments,
      } as any),
    );
  }

  // ---------- 올해 주문 (서비스를 거쳐 규칙 적용) ----------
  const mk = (o: any, by: AuthUser = admin) => orders.create(o, by);
  const one = (name: string, ph: string | null, p: Product, qty: number, at: string, extra: any = {}) =>
    mk({
      channel: extra.channel || 'kakao',
      ordererName: name,
      ordererPhone: ph,
      paymentMethod: extra.paymentMethod || 'prepaid',
      paymentStatus: extra.paymentStatus,
      orderedAt: kst(at),
      rawText: extra.rawText || null,
      shipments: [{ recipientName: extra.recipient || name, recipientPhone: ph, address: extra.address || addr(), items: [{ productId: p.id, qtyBoxes: qty }] }],
    });

  // 이번 주 이미 나간 주문 (사고 시연용)
  const shippedOrders = [
    await one(people[5].name, people[5].phone, BU_G10, 1, '2026-11-10T09:20:00'),
    await one(people[6].name, people[6].phone, BU_H5, 2, '2026-11-11T11:00:00'),
    await one(people[7].name, people[7].phone, BU_G5, 2, '2026-11-12T10:10:00', { address: '서울시 송파구 올림픽로 300, 1203호' }),
    await one(people[8].name, people[8].phone, HONG_H, 1, '2026-11-12T13:40:00'),
  ];
  for (const o of shippedOrders) {
    for (const s of o.shipments) await ds.getRepository(Shipment).update(s.id, { status: 'shipped', shippedAt: kst(s.shipDate + 'T15:00:00') });
  }

  // 김순자 카톡 주문 (엑셀의 "순자 어머님" 주문과 중복 의심 시연)
  await one('김순자', '010-2345-6789', BU_G5, 2, '2026-11-12T16:30:00', {
    rawText: '부사 선물용 5키로 2박스 보내주세요. 받는분 김순자 010-2345-6789 서울시 강동구 천호대로 100, 101호',
    address: '서울시 강동구 천호대로 100, 101호',
  });
  // 목요일 15시 이후 → 월요일
  await one(people[9].name, people[9].phone, BU_H10, 1, '2026-11-12T16:20:00');
  await one(people[10].name, people[10].phone, HONG_G, 2, '2026-11-12T17:05:00', { channel: 'phone' });
  // 금요일 오전 → 월요일
  await one(people[11].name, people[11].phone, BU_G10, 1, '2026-11-13T08:30:00');
  await one(people[12].name, people[12].phone, SU_20, 1, '2026-11-13T09:10:00', { channel: 'phone', recipient: '임현숙' });
  // 현금 입금대기 (3일 지남 → 입금 지연) / 어제 주문 입금대기
  await one(people[13].name, people[13].phone, BU_H5, 3, '2026-11-09T10:00:00', { channel: 'phone', paymentMethod: 'cash' });
  await one(people[14].name, people[14].phone, BU_G10, 1, '2026-11-12T11:30:00', { channel: 'kakao', paymentMethod: 'cash' });
  // 번호 없는 카톡 주문
  await one('이말순', null, BU_H5, 2, '2026-11-12T19:40:00', {
    rawText: '사과 집에서 먹을거 5키로 두박스요 주소는 대구시 수성구 달구벌대로 2500 이말순',
    address: '대구시 수성구 달구벌대로 2500',
  });
  // 예약 (신고 배 판매 시작 11/18)
  await one(people[15].name, people[15].phone, SIN_G, 2, '2026-11-11T10:00:00');
  // 어머니 전화 입력 → 확인필요
  await orders.create(
    {
      channel: 'phone',
      ordererName: people[16].name,
      ordererPhone: people[16].phone,
      paymentMethod: 'cash',
      orderedAt: kst('2026-11-13T10:40:00'),
      rawText: '어머니 메모: 가정용 부사 5키로 1박스, 늘 보내던 주소',
      shipments: [{ recipientName: people[16].name, recipientPhone: people[16].phone, address: addr(), items: [{ productId: BU_H5.id, qtyBoxes: 1 }] }],
    },
    mom,
    { forceStatus: 'needs_check' },
  );
  // 박정호: 올해도 다주소(3곳) 주문
  await mk({
    channel: 'kakao',
    ordererName: '박정호',
    ordererPhone: '01034567890',
    senderName: '박정호',
    paymentMethod: 'prepaid',
    orderedAt: kst('2026-11-11T09:00:00'),
    rawText: '부사 선물용 10키로 한박스씩 세군데요 (어머니, 장인어른, 회사 이사님)',
    shipments: [
      { recipientName: '박영자', recipientPhone: '01055551111', address: '경기도 수원시 팔달로 12, 301호', items: [{ productId: BU_G10.id, qtyBoxes: 1 }] },
      { recipientName: '최병철', recipientPhone: '01055552222', address: '대전시 서구 둔산로 88', items: [{ productId: BU_G10.id, qtyBoxes: 1 }] },
      { recipientName: '한상훈', recipientPhone: '01055553333', address: '서울시 중구 세종대로 110, 7층', items: [{ productId: BU_G10.id, qtyBoxes: 1 }] },
    ],
  });
  // 그 밖의 이번 시즌 주문 (10~11월, 이미 발송)
  for (let k = 0; k < 18; k++) {
    const c = people[17 + (k % 13)];
    const day = 20 + k;
    const at = day <= 31 ? `2026-10-${String(day).padStart(2, '0')}T10:00:00` : `2026-11-0${day - 31}T10:00:00`;
    const p = day < 26 ? pick([HONG_G, HONG_H, SU_10]) : pick([HONG_H, BU_H5, BU_H10, BU_G10, SU_10]);
    const o = await one(c.name, c.phone, p, 1 + (k % 2), at, { channel: pick(['kakao', 'phone', 'smartstore']) === 'smartstore' ? 'kakao' : 'phone' });
    for (const s of o.shipments) await ds.getRepository(Shipment).update(s.id, { status: 'shipped', shippedAt: kst(s.shipDate + 'T15:00:00') });
  }

  // 지난 발송일 건 중 보낼 수 있던 것은 이미 나간 것으로 (실제 농원처럼 그날 3시에 발송됨)
  await ds.query(
    `UPDATE shipments s SET status = 'shipped', "shippedAt" = (s."shipDate"::timestamp + interval '6 hours')
     FROM orders o
     WHERE o.id = s."orderId" AND s.status = 'pending' AND s."shipDate" < $1
       AND o.status = 'confirmed' AND o."paymentStatus" = 'paid' AND o."ordererPhone" IS NOT NULL`,
    [todayKst()],
  );

  // ---------- 지난 사고 1건 (처리 완료 기록) ----------
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const firstShipped = shippedOrders[0].shipments[0];
  const inc = await ds.getRepository(Incident).save({
    shipmentId: firstShipped.id,
    type: 'broken',
    receivedDate: '2026-11-11',
    reportedAt: kst('2026-11-11T18:00:00'),
    isLate: false,
    status: 'done',
    memo: '상자 모서리 눌림, 2알 깨짐',
  } as Incident);
  await ds.getRepository(IncidentPhoto).save({ incidentId: inc.id, mimeType: 'image/png', data: tinyPng });
  await ds.getRepository(IncidentLog).save([
    { incidentId: inc.id, userId: admin.id, action: '접수', memo: '깨짐, 사진 1장', createdAt: kst('2026-11-11T18:00:00') },
    { incidentId: inc.id, userId: admin.id, action: '상태변경', memo: '접수 → 완료 · 고객과 통화, 다음 주문 때 1박스 덤으로 드리기로 함', createdAt: kst('2026-11-12T09:30:00') },
  ] as IncidentLog[]);

  // ---------- Q&A 자료 ----------
  for (const n of FARM_NOTES) await qa.addDoc({ source: 'farm_note', title: n.title, variety: n.variety, text: n.text });
  const c = await qa.addDoc({ source: 'center', title: CENTER_DOC.title, text: CENTER_DOC.text });
  console.log(`Q&A 자료: 쪽지 ${FARM_NOTES.length}장, 센터 자료 ${c.chunks}쪽 (임베딩 ${c.embedded ? '사용' : '없음 → 키워드 검색'})`);

  // ---------- 스마트스토어 가상 엑셀 20행 ----------
  const rows: any[] = [];
  const row = (no: string, at: string, p: Product, opt: string, qty: number, on: string, op: string, rn: string, rp: string, ad: string) =>
    rows.push({ 주문번호: no, 주문일시: at, 상품명: `햇살농원 ${p.variety?.name || ''} 사과`.replace('신고 사과', '신고 배').replace('수미 사과', '수미 감자'), 옵션: opt, 수량: qty, 주문자명: on, 주문자연락처: op, 수령인명: rn, 수령인연락처: rp, 배송지: ad, 결제상태: '결제완료' });
  const all = await ds.getRepository(Product).find();
  const byId = (id: number) => all.find((x) => x.id === id)!;
  const opt = (p: Product) => `${p.grade === 'gift' ? '선물용' : '가정용'} / ${p.boxKg}kg`;
  const base = 2026111300100;
  let i = 0;
  const add = (p: Product, qty: number, at: string, cust: { name: string; phone: string }, recip?: { name: string; phone: string; address: string }, no?: string) => {
    const pp = byId(p.id);
    const r = recip || { name: cust.name, phone: cust.phone, address: addr() };
    row(no || String(base + ++i), at, pp, opt(pp), qty, cust.name, cust.phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3'), r.name, r.phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3'), r.address);
  };
  // 1) 김순자 번호, 다른 이름 → 같은 고객 + 이름 다름 + 카톡과 중복 의심
  add(BU_G5, 2, '2026-11-13 09:30:00', { name: '순자 어머님', phone: '01023456789' }, { name: '김순자', phone: '01023456789', address: '서울시 강동구 천호대로 100, 101호' });
  // 2) 한 주문 2개 품목 (같은 주문번호 2행)
  const multiNo = String(base + ++i);
  add(HONG_H, 1, '2026-11-12 08:10:00', people[18], { name: people[18].name, phone: people[18].phone, address: '경기도 고양시 중앙로 1200, 502호' }, multiNo);
  add(SU_10, 1, '2026-11-12 08:10:00', people[18], { name: people[18].name, phone: people[18].phone, address: '경기도 고양시 중앙로 1200, 502호' }, multiNo);
  // 3) 다주소 주문 (같은 주문번호, 받는 곳 2곳)
  const multiAddr = String(base + ++i);
  add(BU_G10, 1, '2026-11-12 14:20:00', people[19], { name: '오정숙', phone: '01077771234', address: '인천시 남동구 구월로 55' }, multiAddr);
  add(BU_G10, 1, '2026-11-12 14:20:00', people[19], { name: '오민수', phone: '01077775678', address: '부산시 해운대구 센텀로 90, 1501호' }, multiAddr);
  // 4) 나머지 일반 주문 (목 오전·오후, 금)
  const times = ['2026-11-12 10:05:00', '2026-11-12 11:45:00', '2026-11-12 13:30:00', '2026-11-12 15:10:00', '2026-11-12 16:45:00', '2026-11-12 21:00:00', '2026-11-13 07:50:00', '2026-11-13 08:40:00', '2026-11-13 09:55:00', '2026-11-13 10:20:00', '2026-11-11 12:00:00', '2026-11-11 15:30:00', '2026-11-10 09:00:00', '2026-11-13 10:50:00'];
  const prods = [BU_H5, BU_H10, HONG_H, BU_G10, SU_10, BU_H5, HONG_G, BU_H10, SU_20, BU_H5, HONG_H, BU_G10, BU_H10, SIN_H];
  times.forEach((t, k) => add(prods[k], 1 + (k % 2), t, people[20 + (k % 10)]));
  // 5) 상품을 찾을 수 없는 행 (오류 처리 확인)
  row(String(base + ++i), '2026-11-13 11:00:00', BU_G5, '샤인머스캣 2kg', 1, people[29].name, '010-9999-0000', people[29].name, '010-9999-0000', addr());
  rows[rows.length - 1].상품명 = '햇살농원 샤인머스캣';
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '발주발송관리');
  const outDir = path.resolve(__dirname, '../../../docs/시험자료');
  fs.mkdirSync(outDir, { recursive: true });
  XLSX.writeFile(wb, path.join(outDir, '스마트스토어_주문_샘플.xlsx'));
  console.log(`스마트스토어 엑셀 ${rows.length}행 → docs/시험자료/스마트스토어_주문_샘플.xlsx`);

  const counts = await Promise.all([ds.getRepository(Customer).count(), ds.getRepository(Order).count()]);
  console.log(`완료: 고객 ${counts[0]}명, 주문 ${counts[1]}건, 계정 jungwoo(관리자)/mom(포장)/dad(재고)`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
