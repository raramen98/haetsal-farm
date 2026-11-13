import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { Roles } from './auth';
import { Customer, Order } from './entities';
import { normalizePhone } from './rules';
import { OrdersService } from './orders';
import { SettingsService } from './settings.service';

@Controller('customers')
export class CustomersController {
  constructor(@InjectDataSource() private ds: DataSource, private orders: OrdersService, private settings: SettingsService) {}

  /** 고객 목록 (FR-1.4, 2.1) */
  @Get() @Roles('admin')
  async list(@Query('q') q?: string) {
    const qb = this.ds
      .getRepository(Customer)
      .createQueryBuilder('c')
      .leftJoin('c.orders', 'o', `o.status <> 'cancelled'`)
      .select(['c.id', 'c.phone', 'c.displayName', 'c.knownNames', 'c.splitNote'])
      .addSelect('COUNT(o.id)', 'orderCount')
      .addSelect('MAX(o.orderedAt)', 'lastOrderedAt')
      .groupBy('c.id')
      .orderBy('MAX(o.orderedAt)', 'DESC', 'NULLS LAST')
      .limit(300);
    if (q) {
      const digits = q.replace(/\D/g, '');
      if (digits.length >= 3) qb.where('c.phone LIKE :d', { d: `%${digits}%` });
      else qb.where(`(c.displayName ILIKE :n OR array_to_string(c.knownNames, ',') ILIKE :n)`, { n: `%${q}%` });
    }
    const { entities, raw } = await qb.getRawAndEntities();
    return entities.map((c, i) => ({ ...c, orderCount: Number(raw[i].orderCount), lastOrderedAt: raw[i].lastOrderedAt }));
  }

  /** 어머니 전화 주문용: 번호로 고객·지난 배송지 찾기 (이름·배송지만) */
  @Get('lookup') @Roles('admin', 'packer')
  async lookup(@Query('phone') phoneRaw: string) {
    const phone = normalizePhone(phoneRaw);
    if (!phone) throw new BadRequestException('전화번호 형식이 올바르지 않습니다');
    const customers = await this.ds.getRepository(Customer).find({ where: { phone } });
    const out: any[] = [];
    for (const c of customers) {
      const orders = await this.ds.getRepository(Order).find({
        where: { customerId: c.id },
        relations: { shipments: true },
        order: { orderedAt: 'DESC' },
        take: 10,
      });
      const seen = new Set<string>();
      const addresses: any[] = [];
      for (const o of orders)
        for (const s of o.shipments) {
          const k = s.recipientName + '|' + s.address;
          if (seen.has(k)) continue;
          seen.add(k);
          addresses.push({ recipientName: s.recipientName, recipientPhone: s.recipientPhone, address: s.address });
        }
      out.push({ id: c.id, displayName: c.displayName, splitNote: c.splitNote, addresses: addresses.slice(0, 8) });
    }
    return { phone, customers: out };
  }

  /** 고객 상세 + 지난 주문 이력 (FR-2.1) */
  @Get(':id') @Roles('admin')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const c = await this.ds.getRepository(Customer).findOne({ where: { id } });
    if (!c) throw new NotFoundException('고객을 찾을 수 없습니다');
    const orders = await this.orders.list({ customerId: String(id) });
    const samePhone = await this.ds.getRepository(Customer).count({ where: { phone: c.phone } });
    return { ...c, samePhoneCount: samePhone, orders };
  }

  /** 같은 번호 다른 사람 수동 분리 (FR-1.5) */
  @Post(':id/split') @Roles('admin')
  async split(@Param('id', ParseIntPipe) id: number, @Body() b: { displayName: string; splitNote?: string; orderIds: number[] }) {
    const c = await this.ds.getRepository(Customer).findOne({ where: { id } });
    if (!c) throw new NotFoundException();
    if (!b?.displayName?.trim() || !Array.isArray(b.orderIds) || !b.orderIds.length)
      throw new BadRequestException('새 고객 이름과 옮길 주문을 선택해 주세요');
    return this.ds.transaction(async (m) => {
      const nc = await m.getRepository(Customer).save(
        m.getRepository(Customer).create({ phone: c.phone, displayName: b.displayName.trim(), knownNames: [b.displayName.trim()], splitNote: b.splitNote || null }),
      );
      await m.getRepository(Order).update({ id: In(b.orderIds), customerId: c.id }, { customerId: nc.id, nameMismatch: false });
      return nc;
    });
  }
}
