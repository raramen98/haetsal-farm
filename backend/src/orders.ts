import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Not } from 'typeorm';
import { AuthUser, CurrentUser, Roles } from './auth';
import { Channel, Customer, Order, Product, Shipment, ShipmentItem } from './entities';
import { calcShipDate, kstParts, normalizePhone, isPhoneLike, todayKst } from './rules';
import { SettingsService } from './settings.service';
import { StockService, productLabel } from './stock';

export interface ItemInput {
  productId: number;
  qtyBoxes: number;
}
export interface ShipmentInput {
  recipientName: string;
  recipientPhone?: string | null;
  address: string;
  addressConfirmed?: boolean;
  memo?: string | null;
  items: ItemInput[];
}
export interface OrderInput {
  channel: Channel;
  externalOrderNo?: string | null;
  ordererName: string;
  ordererPhone?: string | null;
  customerId?: number | null;
  senderName?: string | null;
  paymentMethod?: 'prepaid' | 'cash';
  paymentStatus?: 'paid' | 'pending';
  rawText?: string | null;
  orderedAt?: string | Date | null;
  source?: 'reorder' | null;
  inputBy?: 'staff' | 'customer';
  shipments: ShipmentInput[];
}

const ORDER_RELATIONS = { customer: true, shipments: { items: { product: true } } } as const;

/** 주문에 붙는 상태 배지 (기능명세서 1장) */
export function orderBadges(o: Order, unpaidWarnDays = 3, now = new Date()): string[] {
  const b: string[] = [];
  if (o.status === 'cancelled') return ['취소'];
  if (o.status === 'needs_check') b.push('확인필요');
  if (!o.ordererPhone) b.push('번호 확인 필요');
  if (o.isReservation) b.push('예약');
  if (o.paymentStatus === 'pending') {
    const days = (now.getTime() - new Date(o.orderedAt).getTime()) / 86400000;
    b.push(days > unpaidWarnDays ? '입금 지연' : '입금대기');
  }
  if (o.duplicateStatus === 'suspect') b.push('중복 의심');
  if (o.nameMismatch) b.push('이름 다름');
  if (o.inputBy === 'customer') b.push('고객 작성');
  return b;
}

/** 발송 가능 여부 (R-2, R-9, R-10) — 못 보내는 이유 목록 */
export function blockReasons(o: Order): string[] {
  const r: string[] = [];
  if (o.status === 'cancelled') r.push('취소된 주문');
  if (o.status === 'needs_check') r.push('확인필요 (정우 씨 확인 전)');
  if (!o.ordererPhone) r.push('번호 확인 필요');
  if (o.paymentStatus !== 'paid') r.push('입금 전');
  return r;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private stock: StockService,
    private settings: SettingsService,
  ) {}

  // ---------- 검증 (R-4) ----------
  private validate(input: OrderInput) {
    if (!input || !input.ordererName?.trim()) throw new BadRequestException('주문자 이름은 필수입니다');
    if (!['smartstore', 'kakao', 'phone'].includes(input.channel)) throw new BadRequestException('주문 경로가 올바르지 않습니다');
    if (!Array.isArray(input.shipments) || input.shipments.length === 0) throw new BadRequestException('배송지는 1곳 이상이어야 합니다');
    input.shipments.forEach((s, i) => {
      if (!s.recipientName?.trim() || !s.address?.trim()) throw new BadRequestException(`배송지 ${i + 1}: 받는 분과 주소는 필수입니다`);
      if (!Array.isArray(s.items) || s.items.length === 0) throw new BadRequestException(`배송지 ${i + 1}: 품목이 1개 이상이어야 합니다`);
      s.items.forEach((it) => {
        if (!it.productId || !Number.isInteger(+it.qtyBoxes) || +it.qtyBoxes < 1)
          throw new BadRequestException(`배송지 ${i + 1}: 상품과 박스 수(1 이상)를 확인해 주세요`);
      });
      if (s.recipientPhone && isPhoneLike(s.recipientPhone) && !normalizePhone(s.recipientPhone))
        throw new BadRequestException(`배송지 ${i + 1}: 받는 분 전화번호 형식이 올바르지 않습니다`);
    });
    if (input.ordererPhone && isPhoneLike(input.ordererPhone) && !normalizePhone(input.ordererPhone))
      throw new BadRequestException('주문자 전화번호 형식이 올바르지 않습니다 (예: 010-1234-5678)');
    // R-14 다시 넣기: 배송지마다 주소 확인 필수
    if (input.source === 'reorder' && input.shipments.some((s) => !s.addressConfirmed))
      throw new BadRequestException('다시 넣기 주문은 배송지마다 "주소 확인"을 체크해야 저장됩니다');
  }

  private requestedMap(shipments: { items: ItemInput[] }[]) {
    const m = new Map<number, number>();
    for (const s of shipments) for (const it of s.items) m.set(+it.productId, (m.get(+it.productId) || 0) + +it.qtyBoxes);
    return m;
  }

  // ---------- R-1 고객 묶기 ----------
  async resolveCustomer(m: EntityManager, phone: string | null, name: string, customerId?: number | null) {
    if (!phone) return { customer: null as Customer | null, nameMismatch: false };
    const repo = m.getRepository(Customer);
    const same = await repo.find({ where: { phone }, order: { id: 'ASC' } });
    let c: Customer | undefined;
    if (same.length === 0) {
      c = await repo.save(repo.create({ phone, displayName: name.trim(), knownNames: [name.trim()] }));
    } else if (same.length === 1) {
      c = same[0];
    } else {
      c = same.find((x) => x.id === Number(customerId));
      if (!c)
        throw new ConflictException({
          message: '이 번호를 쓰는 고객이 여러 명입니다. 고객을 선택해 주세요',
          candidates: same.map((x) => ({ id: x.id, displayName: x.displayName, splitNote: x.splitNote })),
        });
    }
    const n = name.trim();
    const nameMismatch = n !== c.displayName;
    if (!c.knownNames.includes(n)) {
      c.knownNames = [...c.knownNames, n];
      await repo.save(c);
    }
    return { customer: c, nameMismatch };
  }

  // ---------- R-7 예약, R-8 발송일 ----------
  private shipInfo(orderedAt: Date, products: Product[], s: { items: ItemInput[] }, ship: any, isReservation: boolean) {
    const ps = s.items.map((it) => products.find((p) => p.id === +it.productId)!);
    return calcShipDate(
      orderedAt,
      { saleStartDates: isReservation ? ps.map((p) => p.variety.saleStartDate) : [], allowFriday: ps.every((p) => p.allowFriday) },
      ship,
    );
  }

  private isReservation(orderedAt: Date, products: Product[]) {
    const d = kstParts(orderedAt).date;
    return products.some((p) => d < p.variety.saleStartDate);
  }

  // ---------- 주문 생성 ----------
  async create(input: OrderInput, user: AuthUser | null, opts: { forceStatus?: 'needs_check' } = {}) {
    this.validate(input);
    const ship = await this.settings.ship();
    const orderId = await this.ds.transaction(async (m) => {
      const phone = normalizePhone(input.ordererPhone);
      const { customer, nameMismatch } = await this.resolveCustomer(m, phone, input.ordererName, input.customerId);
      const requested = this.requestedMap(input.shipments);
      await this.stock.assertAvailable(m, requested); // R-6
      const products = await m.getRepository(Product).find({ where: { id: In([...requested.keys()]) } });
      const orderedAt = input.orderedAt ? new Date(input.orderedAt) : new Date();
      if (isNaN(orderedAt.getTime())) throw new BadRequestException('주문 시각이 올바르지 않습니다');
      const isReservation = this.isReservation(orderedAt, products);
      const paymentMethod = input.paymentMethod || (input.channel === 'smartstore' ? 'prepaid' : 'cash');
      const paymentStatus = input.paymentStatus || (paymentMethod === 'prepaid' ? 'paid' : 'pending');
      let total = 0;
      const order = m.getRepository(Order).create({
        channel: input.channel,
        externalOrderNo: input.externalOrderNo || null,
        customerId: customer?.id ?? null,
        ordererName: input.ordererName.trim(),
        ordererPhone: phone,
        nameMismatch,
        senderName: input.senderName?.trim() || input.ordererName.trim(), // R-5
        status: opts.forceStatus || 'confirmed',
        isReservation,
        paymentMethod,
        paymentStatus,
        rawText: input.rawText || null,
        inputBy: input.inputBy === 'customer' ? 'customer' : 'staff',
        orderedAt,
        createdBy: user?.id ?? null,
        shipments: input.shipments.map((s) => ({
          recipientName: s.recipientName.trim(),
          recipientPhone: normalizePhone(s.recipientPhone) || '',
          address: s.address.trim(),
          addressConfirmed: input.source === 'reorder' ? !!s.addressConfirmed : true,
          memo: s.memo || null,
          shipDate: this.shipInfo(orderedAt, products, s, ship, isReservation),
          items: s.items.map((it) => {
            const p = products.find((x) => x.id === +it.productId)!;
            total += p.price * +it.qtyBoxes;
            return { productId: p.id, qtyBoxes: +it.qtyBoxes, unitPrice: p.price } as ShipmentItem;
          }),
        })) as Shipment[],
      });
      order.totalAmount = total;
      try {
        const saved = await m.getRepository(Order).save(order);
        return saved.id;
      } catch (e: any) {
        if (e?.code === '23505') throw new ConflictException('이미 등록된 주문번호입니다');
        throw e;
      }
    });
    await this.checkDuplicate(orderId);
    return this.get(orderId);
  }

  // ---------- 주문 수정 (배송지·품목 교체, 재발송 건은 유지) ----------
  async update(id: number, input: OrderInput, user: AuthUser) {
    const current = await this.get(id);
    if (current.status === 'cancelled') throw new ConflictException('취소된 주문은 수정할 수 없습니다');
    if (current.shipments.some((s) => !s.isReship && s.status === 'shipped'))
      throw new ConflictException('이미 발송된 배송지가 있어 품목을 수정할 수 없습니다');
    input.channel = current.channel;
    this.validate(input);
    const ship = await this.settings.ship();
    await this.ds.transaction(async (m) => {
      const phone = normalizePhone(input.ordererPhone);
      const { customer, nameMismatch } = await this.resolveCustomer(m, phone, input.ordererName, input.customerId ?? current.customerId);
      const reships = current.shipments.filter((s) => s.isReship);
      const requested = this.requestedMap([...input.shipments, ...reships.map((s) => ({ items: s.items }))]);
      await this.stock.assertAvailable(m, requested, id); // 이 주문을 뺀 사용량 기준
      const products = await m.getRepository(Product).find({ where: { id: In([...requested.keys()]) } });
      const isReservation = this.isReservation(current.orderedAt, products);
      await m.getRepository(Shipment).delete({ orderId: id, isReship: false });
      let total = 0;
      for (const s of input.shipments) {
        const sh = await m.getRepository(Shipment).save(
          m.getRepository(Shipment).create({
            orderId: id,
            recipientName: s.recipientName.trim(),
            recipientPhone: normalizePhone(s.recipientPhone) || '',
            address: s.address.trim(),
            addressConfirmed: true,
            memo: s.memo || null,
            shipDate: this.shipInfo(current.orderedAt, products, s, ship, isReservation),
          }),
        );
        for (const it of s.items) {
          const p = products.find((x) => x.id === +it.productId)!;
          total += p.price * +it.qtyBoxes;
          await m.getRepository(ShipmentItem).save({ shipmentId: sh.id, productId: p.id, qtyBoxes: +it.qtyBoxes, unitPrice: p.price });
        }
      }
      await m.getRepository(Order).update(id, {
        ordererName: input.ordererName.trim(),
        ordererPhone: phone,
        customerId: customer?.id ?? null,
        nameMismatch,
        senderName: input.senderName?.trim() || input.ordererName.trim(),
        isReservation,
        totalAmount: total,
        rawText: input.rawText ?? current.rawText,
        ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
      });
    });
    await this.checkDuplicate(id);
    return this.get(id);
  }

  async get(id: number) {
    const o = await this.ds.getRepository(Order).findOne({ where: { id }, relations: ORDER_RELATIONS as any });
    if (!o) throw new NotFoundException('주문을 찾을 수 없습니다');
    o.shipments.sort((a, b) => a.id - b.id);
    return o;
  }

  async detail(id: number) {
    const o = await this.get(id);
    const warn = await this.settings.num('unpaid_warn_days');
    const dup = o.duplicateOfId ? await this.ds.getRepository(Order).findOne({ where: { id: o.duplicateOfId }, relations: ORDER_RELATIONS as any }) : null;
    return { ...this.serialize(o, warn), duplicateOf: dup ? this.serialize(dup, warn) : null };
  }

  serialize(o: Order, unpaidWarnDays: number) {
    return {
      ...o,
      badges: orderBadges(o, unpaidWarnDays),
      blockReasons: blockReasons(o),
      shipments: (o.shipments || []).map((s) => ({
        ...s,
        items: (s.items || []).map((i) => ({ ...i, label: i.product ? productLabel(i.product) : '' })),
      })),
    };
  }

  // ---------- R-3 중복 의심 ----------
  async checkDuplicate(orderId: number) {
    const repo = this.ds.getRepository(Order);
    const o = await this.get(orderId);
    if (!o.customerId || o.status === 'cancelled' || o.duplicateStatus === 'kept' || o.duplicateStatus === 'merged') return;
    const days = await this.settings.num('duplicate_window_days');
    const myProducts = new Set(o.shipments.filter((s) => !s.isReship).flatMap((s) => s.items.map((i) => i.productId)));
    const from = new Date(o.orderedAt.getTime() - days * 86400000);
    const to = new Date(o.orderedAt.getTime() + days * 86400000);
    const others = await repo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.shipments', 's')
      .leftJoinAndSelect('s.items', 'i')
      .where('o.customerId = :c', { c: o.customerId })
      .andWhere('o.id <> :id', { id: o.id })
      .andWhere('o.channel <> :ch', { ch: o.channel })
      .andWhere(`o.status <> 'cancelled'`)
      .andWhere('o.orderedAt BETWEEN :from AND :to', { from, to })
      .orderBy('o.orderedAt', 'ASC')
      .getMany();
    const hit = others.find((x) => x.shipments.some((s) => !s.isReship && s.items.some((i) => myProducts.has(i.productId))));
    if (!hit) return;
    await repo.update(o.id, { duplicateStatus: 'suspect', duplicateOfId: hit.id });
    if (hit.duplicateStatus !== 'merged') await repo.update(hit.id, { duplicateStatus: 'suspect', duplicateOfId: hit.duplicateOfId ?? o.id });
  }

  /** 사람이 결정: 유지 / 합치기(한쪽 취소). 자동 취소 없음 */
  async decideDuplicate(id: number, body: { action: 'keep' | 'merge'; cancelId?: number }) {
    const o = await this.get(id);
    if (o.duplicateStatus !== 'suspect' || !o.duplicateOfId) throw new ConflictException('중복 의심 상태가 아닙니다');
    const pair = o.duplicateOfId;
    const repo = this.ds.getRepository(Order);
    if (body.action === 'keep') {
      await repo.update({ id: In([id, pair]) }, { duplicateStatus: 'kept' });
    } else if (body.action === 'merge') {
      const cancelId = Number(body.cancelId);
      if (![id, pair].includes(cancelId)) throw new BadRequestException('취소할 주문은 중복 의심 두 건 중 하나여야 합니다');
      const target = await this.get(cancelId);
      if (target.shipments.some((s) => s.status === 'shipped')) throw new ConflictException('이미 발송된 주문은 취소할 수 없습니다');
      await repo.update(cancelId, { status: 'cancelled', duplicateStatus: 'merged' });
      await repo.update(cancelId === id ? pair : id, { duplicateStatus: 'kept' });
    } else throw new BadRequestException('action은 keep 또는 merge');
    return this.detail(id);
  }

  // ---------- R-8④ 확인 시각 기준 발송일 다시 계산 ----------
  private async recalcShipDates(m: EntityManager, orderId: number, at: Date) {
    const ship = await this.settings.ship();
    const o = await m.getRepository(Order).findOne({ where: { id: orderId }, relations: ORDER_RELATIONS as any });
    if (!o) return;
    for (const s of o.shipments) {
      if (s.status === 'shipped') continue;
      const ps = s.items.map((i) => i.product);
      const d = calcShipDate(at, { saleStartDates: o.isReservation ? ps.map((p) => p.variety.saleStartDate) : [], allowFriday: ps.every((p) => p.allowFriday) }, ship);
      if (!s.shipDate || d > s.shipDate) await m.getRepository(Shipment).update(s.id, { shipDate: d });
    }
  }

  /** R-2: 번호 입력 → 고객 연결 → 중복 검사 → 발송일 */
  async setPhone(id: number, body: { phone: string; customerId?: number }) {
    const phone = normalizePhone(body?.phone);
    if (!phone) throw new BadRequestException('전화번호 형식이 올바르지 않습니다');
    const o = await this.get(id);
    const hadPhone = !!o.ordererPhone;
    await this.ds.transaction(async (m) => {
      const { customer, nameMismatch } = await this.resolveCustomer(m, phone, o.ordererName, body.customerId);
      await m.getRepository(Order).update(id, { ordererPhone: phone, customerId: customer!.id, nameMismatch });
      if (!hadPhone) await this.recalcShipDates(m, id, new Date());
    });
    await this.checkDuplicate(id);
    return this.detail(id);
  }

  /** R-9 입금 확인 */
  async confirmPayment(id: number, body: { depositorName?: string }, user: AuthUser) {
    const o = await this.get(id);
    if (o.status === 'cancelled') throw new ConflictException('취소된 주문입니다');
    if (o.paymentStatus === 'paid') throw new ConflictException('이미 입금 확인된 주문입니다');
    const depositor = (body?.depositorName || '').trim();
    if (!depositor) throw new BadRequestException('입금자명을 입력해 주세요');
    await this.ds.transaction(async (m) => {
      await m.getRepository(Order).update(id, {
        paymentStatus: 'paid',
        depositorName: depositor,
        paidConfirmedAt: new Date(),
        paidConfirmedBy: user.id,
      });
      await this.recalcShipDates(m, id, new Date());
    });
    const d = await this.detail(id);
    return { ...d, depositorNameMismatch: depositor !== o.ordererName };
  }

  /** 확인필요 → 접수 */
  async confirm(id: number) {
    const o = await this.get(id);
    if (o.status !== 'needs_check') throw new ConflictException('확인필요 상태가 아닙니다');
    await this.ds.transaction(async (m) => {
      await m.getRepository(Order).update(id, { status: 'confirmed' });
      await this.recalcShipDates(m, id, new Date());
    });
    return this.detail(id);
  }

  async cancel(id: number) {
    const o = await this.get(id);
    if (o.shipments.some((s) => s.status === 'shipped')) throw new ConflictException('이미 발송된 배송지가 있어 취소할 수 없습니다');
    await this.ds.getRepository(Order).update(id, { status: 'cancelled' });
    return this.detail(id);
  }

  async list(q: { channel?: string; flag?: string; q?: string; customerId?: string }) {
    const qb = this.ds
      .getRepository(Order)
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.customer', 'c')
      .leftJoinAndSelect('o.shipments', 's')
      .leftJoinAndSelect('s.items', 'i')
      .leftJoinAndSelect('i.product', 'p')
      .leftJoinAndSelect('p.variety', 'v')
      .orderBy('o.orderedAt', 'DESC')
      .addOrderBy('s.id', 'ASC');
    if (q.channel) qb.andWhere('o.channel = :ch', { ch: q.channel });
    if (q.customerId) qb.andWhere('o.customerId = :cid', { cid: +q.customerId });
    const warn = await this.settings.num('unpaid_warn_days');
    switch (q.flag) {
      case 'needs_check': qb.andWhere(`o.status = 'needs_check'`); break;
      case 'phone_missing': qb.andWhere(`o.ordererPhone IS NULL AND o.status <> 'cancelled'`); break;
      case 'duplicate': qb.andWhere(`o.duplicateStatus = 'suspect' AND o.status <> 'cancelled'`); break;
      case 'unpaid': qb.andWhere(`o.paymentStatus = 'pending' AND o.status <> 'cancelled'`); break;
      case 'unpaid_late':
        qb.andWhere(`o.paymentStatus = 'pending' AND o.status <> 'cancelled' AND o.orderedAt < :t`, { t: new Date(Date.now() - warn * 86400000) });
        break;
      case 'reservation': qb.andWhere(`o.isReservation = true AND o.status <> 'cancelled'`); break;
      case 'cancelled': qb.andWhere(`o.status = 'cancelled'`); break;
      case 'active': qb.andWhere(`o.status <> 'cancelled'`); break;
    }
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      qb.andWhere(
        new Brackets((w) => {
          w.where('o.ordererName ILIKE :n', { n: `%${q.q}%` })
            .orWhere('s.recipientName ILIKE :n', { n: `%${q.q}%` })
            .orWhere('o.externalOrderNo ILIKE :n', { n: `%${q.q}%` });
          if (digits.length >= 3) w.orWhere('o.ordererPhone LIKE :d', { d: `%${digits}%` });
        }),
      );
    }
    const rows = await qb.take(300).getMany();
    return rows.map((o) => this.serialize(o, warn));
  }

  async counts() {
    const warn = await this.settings.num('unpaid_warn_days');
    const r = this.ds.getRepository(Order);
    const notCancelled = { status: Not('cancelled' as const) } as any;
    const [needsCheck, phoneMissing, duplicate, unpaid] = await Promise.all([
      r.count({ where: { status: 'needs_check' } }),
      r.createQueryBuilder('o').where(`o.ordererPhone IS NULL AND o.status <> 'cancelled'`).getCount(),
      r.count({ where: { ...notCancelled, duplicateStatus: 'suspect' } }),
      r.count({ where: { ...notCancelled, paymentStatus: 'pending' } }),
    ]);
    const unpaidLate = await r
      .createQueryBuilder('o')
      .where(`o.paymentStatus = 'pending' AND o.status <> 'cancelled' AND o.orderedAt < :t`, { t: new Date(Date.now() - warn * 86400000) })
      .getCount();
    return { needsCheck, phoneMissing, duplicate, unpaid, unpaidLate, today: todayKst() };
  }

  /** R-14 다시 넣기 초안 (저장 아님) */
  async reorderDraft(orderId: number) {
    const o = await this.get(orderId);
    const stockList = await this.stock.list();
    const today = todayKst();
    const warnings: string[] = [];
    const need = new Map<number, number>();
    const shipments = o.shipments
      .filter((s) => !s.isReship)
      .map((s) => ({
        recipientName: s.recipientName,
        recipientPhone: s.recipientPhone,
        address: s.address,
        addressConfirmed: false,
        items: s.items.map((i) => {
          need.set(i.productId, (need.get(i.productId) || 0) + i.qtyBoxes);
          return { productId: i.productId, qtyBoxes: i.qtyBoxes, label: productLabel(i.product) };
        }),
      }));
    for (const [pid, qty] of need) {
      const p = stockList.find((x) => x.id === pid);
      if (!p) continue;
      if (!p.active) warnings.push(`${p.label}: 판매 중지된 상품 — 다른 상품으로 바꾸려면 고객 확인 필요(자동 대체 안 함)`);
      if (today < p.variety.saleStartDate) warnings.push(`${p.label}: 판매 시작일(${p.variety.saleStartDate}) 전이라 예약 주문으로 받습니다`);
      if (qty > p.remaining) warnings.push(`${p.label}: 남은 ${Math.max(p.remaining, 0)}박스, 필요 ${qty}박스 — 수량 부족(저장 시 거부됨)`);
    }
    return {
      source: 'reorder',
      fromOrderId: o.id,
      customerId: o.customerId,
      ordererName: o.ordererName,
      ordererPhone: o.ordererPhone,
      senderName: o.senderName,
      paymentMethod: o.paymentMethod,
      shipments,
      warnings,
    };
  }
}

@Controller('orders')
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Get() @Roles('admin')
  list(@Query() q: any) {
    return this.orders.list(q);
  }

  @Get('counts') @Roles('admin')
  counts() {
    return this.orders.counts();
  }

  @Get(':id') @Roles('admin')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.orders.detail(id);
  }

  @Post() @Roles('admin')
  async create(@Body() body: OrderInput, @CurrentUser() u: AuthUser) {
    if (body?.channel === 'smartstore' && !body.externalOrderNo) throw new BadRequestException('스마트스토어 주문은 엑셀 업로드로 등록합니다');
    return this.orders.detail((await this.orders.create({ ...body, inputBy: 'staff' }, u)).id);
  }

  /** 어머니 전화 주문: 서버가 '확인필요'로 고정 (FR-1.3) */
  @Post('phone') @Roles('admin', 'packer')
  async createPhone(@Body() body: OrderInput, @CurrentUser() u: AuthUser) {
    const o = await this.orders.create(
      { ...body, channel: 'phone', paymentMethod: body?.paymentMethod === 'prepaid' ? 'prepaid' : 'cash', paymentStatus: undefined, externalOrderNo: null, source: null, inputBy: 'staff' },
      u,
      // 어머니(포장)가 넣은 전화 주문은 정우 씨 확인 전까지 '확인필요', 정우 씨가 넣으면 바로 접수
      u.role === 'packer' ? { forceStatus: 'needs_check' } : {},
    );
    return { id: o.id, status: o.status, shipDates: o.shipments.map((s) => s.shipDate) };
  }

  @Patch(':id') @Roles('admin')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: OrderInput, @CurrentUser() u: AuthUser) {
    await this.orders.update(id, body, u);
    return this.orders.detail(id);
  }

  @Patch(':id/phone') @Roles('admin')
  setPhone(@Param('id', ParseIntPipe) id: number, @Body() body: { phone: string; customerId?: number }) {
    return this.orders.setPhone(id, body);
  }

  @Post(':id/payment') @Roles('admin')
  pay(@Param('id', ParseIntPipe) id: number, @Body() body: { depositorName?: string }, @CurrentUser() u: AuthUser) {
    return this.orders.confirmPayment(id, body, u);
  }

  @Post(':id/confirm') @Roles('admin')
  confirm(@Param('id', ParseIntPipe) id: number) {
    return this.orders.confirm(id);
  }

  @Post(':id/cancel') @Roles('admin')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.orders.cancel(id);
  }

  @Post(':id/duplicate') @Roles('admin')
  duplicate(@Param('id', ParseIntPipe) id: number, @Body() body: { action: 'keep' | 'merge'; cancelId?: number }) {
    return this.orders.decideDuplicate(id, body);
  }

  @Post('reorder/:id') @Roles('admin')
  reorder(@Param('id', ParseIntPipe) id: number) {
    return this.orders.reorderDraft(id);
  }
}
