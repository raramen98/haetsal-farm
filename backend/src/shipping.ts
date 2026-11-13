import { Body, ConflictException, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { AuthUser, CurrentUser, Roles } from './auth';
import { Shipment } from './entities';
import { todayKst } from './rules';
import { blockReasons } from './orders';
import { productLabel } from './stock';
import { SettingsService } from './settings.service';

/** R-10 오늘 보낼 목록 · 포장 목록 */
@Controller()
export class ShippingController {
  constructor(@InjectDataSource() private ds: DataSource, private settings: SettingsService) {}

  private async open(today: string) {
    const rows = await this.ds
      .getRepository(Shipment)
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.order', 'o')
      .leftJoinAndSelect('s.items', 'i')
      .leftJoinAndSelect('i.product', 'p')
      .leftJoinAndSelect('p.variety', 'v')
      .where(`s.status IN ('pending','packed')`)
      .andWhere(`o.status <> 'cancelled'`)
      .andWhere('s.shipDate <= :today', { today })
      .orderBy('s.shipDate', 'ASC')
      .addOrderBy('s.id', 'ASC')
      .getMany();
    return rows.map((s) => {
      const reasons = blockReasons(s.order);
      return {
        id: s.id,
        orderId: s.orderId,
        channel: s.order.channel,
        ordererName: s.order.ordererName,
        ordererPhone: s.order.ordererPhone,
        senderName: s.order.senderName,
        recipientName: s.recipientName,
        recipientPhone: s.recipientPhone,
        address: s.address,
        shipDate: s.shipDate,
        overdue: (s.shipDate || '') < today,
        status: s.status,
        isReship: s.isReship,
        duplicateSuspect: s.order.duplicateStatus === 'suspect',
        hasGift: s.items.some((i) => i.product.grade === 'gift'),
        items: s.items.map((i) => ({ label: productLabel(i.product), grade: i.product.grade, qtyBoxes: i.qtyBoxes })),
        totalBoxes: s.items.reduce((a, i) => a + i.qtyBoxes, 0),
        memo: s.memo,
        reasons,
      };
    });
  }

  /** date를 주면 그 날짜 기준 목록 미리보기 (예: 금요일에 월요일 포장 준비). 발송 완료는 실제 오늘 기준으로만 */
  @Get('shipping/today') @Roles('admin')
  async today(@Query('date') date?: string) {
    const today = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayKst();
    const all = await this.open(today);
    const ready = all.filter((s) => s.reasons.length === 0);
    const blocked = all.filter((s) => s.reasons.length > 0);
    const upcoming = await this.ds
      .getRepository(Shipment)
      .createQueryBuilder('s')
      .innerJoin('s.order', 'o')
      .where(`s.status = 'pending' AND o.status <> 'cancelled' AND s.shipDate > :today`, { today })
      .select('s.shipDate', 'shipDate')
      .addSelect('COUNT(*)', 'count')
      .groupBy('s.shipDate')
      .orderBy('s.shipDate')
      .limit(7)
      .getRawMany();
    return { today, realToday: todayKst(), isShipDay: (await this.settings.ship()).shipWeekdays.includes(new Date(today + 'T00:00:00Z').getUTCDay()), ready, blocked, upcoming: upcoming.map((u) => ({ shipDate: u.shipDate, count: Number(u.count) })) };
  }

  /** 홈 달력: 날짜별 발송 예정·발송 완료 건수 (month=YYYY-MM) */
  @Get('shipping/calendar') @Roles('admin')
  async calendar(@Query('month') month?: string) {
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : todayKst().slice(0, 7);
    const [y, mo] = m.split('-').map(Number);
    const from = `${m}-01`;
    const to = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    const rows = await this.ds.query(
      `SELECT s."shipDate" AS date,
              COUNT(*) FILTER (WHERE s.status = 'shipped') AS shipped,
              COUNT(*) FILTER (WHERE s.status <> 'shipped') AS planned,
              COUNT(*) FILTER (WHERE s.status <> 'shipped' AND (o.status <> 'confirmed' OR o."paymentStatus" <> 'paid' OR o."ordererPhone" IS NULL)) AS blocked,
              COUNT(*) FILTER (WHERE s."isReship") AS reship
         FROM shipments s JOIN orders o ON o.id = s."orderId"
        WHERE o.status <> 'cancelled' AND s."shipDate" BETWEEN $1 AND $2
        GROUP BY s."shipDate" ORDER BY s."shipDate"`,
      [from, to],
    );
    const ship = await this.settings.ship();
    return {
      month: m,
      today: todayKst(),
      shipWeekdays: ship.shipWeekdays,
      days: rows.map((r: any) => ({ date: r.date, shipped: +r.shipped, planned: +r.planned, blocked: +r.blocked, reship: +r.reship })),
    };
  }

  /** 어머니 포장 목록: 보낼 수 있는 건만, 금액·결제 정보 없이 */
  @Get('shipping/packing') @Roles('admin', 'packer')
  async packing(@Query('date') date?: string) {
    const today = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayKst();
    const ready = (await this.open(today)).filter((s) => s.reasons.length === 0);
    return {
      today,
      realToday: todayKst(),
      list: ready.map(({ id, recipientName, address, senderName, items, hasGift, totalBoxes, status, isReship, memo, overdue }) => ({
        id, recipientName, address, senderName, items, hasGift, totalBoxes, status, isReship, memo, overdue,
      })),
    };
  }

  @Post('shipments/:id/packed') @Roles('admin', 'packer')
  async packed(@Param('id', ParseIntPipe) id: number, @Body() b: { packed?: boolean }, @CurrentUser() u: AuthUser) {
    const s = await this.ds.getRepository(Shipment).findOne({ where: { id }, relations: { order: true } });
    if (!s) throw new NotFoundException();
    if (s.status === 'shipped') throw new ConflictException('이미 발송된 건입니다');
    const r = blockReasons(s.order);
    if (r.length) throw new ConflictException(`포장할 수 없는 주문입니다: ${r.join(', ')}`);
    const packed = b?.packed !== false;
    await this.ds.getRepository(Shipment).update(id, packed ? { status: 'packed', packedAt: new Date(), packedBy: u.id } : { status: 'pending', packedAt: null, packedBy: null });
    return { id, status: packed ? 'packed' : 'pending' };
  }

  /** 발송 완료: 조건(R-10)을 서버에서 다시 검사 */
  @Post('shipping/shipped') @Roles('admin')
  async shipped(@Body() b: { ids: number[] }) {
    const ids = (b?.ids || []).map(Number);
    if (!ids.length) throw new ConflictException('선택된 배송 건이 없습니다');
    const today = todayKst();
    const ship = await this.settings.ship();
    const wd = new Date(today + 'T00:00:00Z').getUTCDay();
    const rows = await this.ds.getRepository(Shipment).find({ where: { id: In(ids) }, relations: { order: true, items: { product: true } } });
    const errors: string[] = [];
    for (const s of rows) {
      const r = blockReasons(s.order);
      // R-8: 발송 요일이 아니면 발송 불가 (금요일은 모든 품목이 금요일 허용일 때만)
      const fridayOk = wd === 5 && s.items.every((i) => i.product.allowFriday);
      if (!ship.shipWeekdays.includes(wd) && !fridayOk) r.push('오늘은 발송 요일이 아님');
      if (s.status === 'shipped') r.push('이미 발송됨');
      if (!s.shipDate || s.shipDate > today) r.push(`발송 예정일(${s.shipDate}) 전`);
      if (r.length) errors.push(`${s.recipientName}: ${r.join(', ')}`);
    }
    if (errors.length) throw new ConflictException({ message: '발송할 수 없는 건이 있습니다', details: errors });
    await this.ds.getRepository(Shipment).update({ id: In(ids) }, { status: 'shipped', shippedAt: new Date() });
    return { shipped: ids.length };
  }
}
