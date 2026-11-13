import { Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseIntPipe, Patch, Post, BadRequestException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Product, Variety } from './entities';
import { saleLimit } from './rules';
import { Roles } from './auth';
import { SettingsService } from './settings.service';

export interface Usage {
  reserved: number; // 예약
  ordered: number; // 일반 주문
  reshipped: number; // 재발송
}

export const GRADE_LABEL = { gift: '선물용', home: '가정용' } as const;
export const productLabel = (p: Product) => `${p.variety?.name ?? ''} ${GRADE_LABEL[p.grade]} ${p.boxKg}kg`;

/** R-6 남은 수량 계산·검사. 주문 생성·수정·다시 넣기·엑셀·재발송이 모두 이 서비스를 거친다 */
@Injectable()
export class StockService {
  constructor(@InjectDataSource() private ds: DataSource, private settings: SettingsService) {}

  async usage(m: EntityManager = this.ds.manager, productIds?: number[], excludeOrderId?: number): Promise<Map<number, Usage>> {
    const qb = m
      .createQueryBuilder()
      .select('si."productId"', 'productId')
      .addSelect(`COALESCE(SUM(CASE WHEN s."isReship" THEN si."qtyBoxes" ELSE 0 END),0)`, 'reshipped')
      .addSelect(`COALESCE(SUM(CASE WHEN NOT s."isReship" AND o."isReservation" THEN si."qtyBoxes" ELSE 0 END),0)`, 'reserved')
      .addSelect(`COALESCE(SUM(CASE WHEN NOT s."isReship" AND NOT o."isReservation" THEN si."qtyBoxes" ELSE 0 END),0)`, 'ordered')
      .from('shipment_items', 'si')
      .innerJoin('shipments', 's', 's.id = si."shipmentId"')
      .innerJoin('orders', 'o', 'o.id = s."orderId"')
      .where(`o.status <> 'cancelled'`)
      // 이번 판매 시즌 주문만 센다 (지난해 주문은 재고와 무관)
      .andWhere(`o."orderedAt" >= (:season)::timestamptz`, { season: `${(await this.settings.all()).season_start}T00:00:00+09:00` })
      .groupBy('si."productId"');
    if (productIds?.length) qb.andWhere('si."productId" IN (:...productIds)', { productIds });
    if (excludeOrderId) qb.andWhere('o.id <> :ex', { ex: excludeOrderId });
    const rows = await qb.getRawMany();
    const map = new Map<number, Usage>();
    for (const r of rows)
      map.set(Number(r.productId), { reserved: Number(r.reserved), ordered: Number(r.ordered), reshipped: Number(r.reshipped) });
    return map;
  }

  /**
   * 요청 수량이 남은 수량을 넘으면 409. 반드시 트랜잭션 안에서 호출한다.
   * products 행을 FOR UPDATE로 잠가 동시에 들어온 주문이 함께 한도를 넘지 못하게 한다.
   */
  async assertAvailable(m: EntityManager, requested: Map<number, number>, excludeOrderId?: number) {
    const ids = [...requested.keys()];
    if (!ids.length) return;
    const locked = await m
      .getRepository(Product)
      .createQueryBuilder('p')
      .setLock('pessimistic_write')
      .where('p.id IN (:...ids)', { ids })
      .orderBy('p.id')
      .getMany();
    const products = await m.getRepository(Product).find({ where: { id: In(ids) } }); // variety 포함
    if (locked.length !== ids.length) throw new BadRequestException('없는 상품이 포함되어 있습니다');
    const usage = await this.usage(m, ids, excludeOrderId);
    const errors: string[] = [];
    for (const p of products) {
      if (!p.active) errors.push(`${productLabel(p)}: 판매 중지된 상품입니다`);
      const u = usage.get(p.id) || { reserved: 0, ordered: 0, reshipped: 0 };
      const remaining = saleLimit(p) - u.reserved - u.ordered - u.reshipped;
      const want = requested.get(p.id) || 0;
      if (want > remaining) errors.push(`${productLabel(p)}: 남은 ${Math.max(remaining, 0)}박스, 요청 ${want}박스`);
    }
    if (errors.length) throw new ConflictException({ message: '남은 수량을 넘어 저장할 수 없습니다', details: errors });
  }

  async list() {
    const products = await this.ds.getRepository(Product).find({ order: { varietyId: 'ASC', grade: 'ASC', boxKg: 'ASC' } });
    const usage = await this.usage();
    return products.map((p) => {
      const u = usage.get(p.id) || { reserved: 0, ordered: 0, reshipped: 0 };
      const limit = saleLimit(p);
      return {
        ...p,
        label: productLabel(p),
        saleLimit: limit,
        ...u,
        remaining: limit - u.reserved - u.ordered - u.reshipped,
      };
    });
  }
}

@Controller()
export class StockController {
  constructor(
    private stock: StockService,
    @InjectRepository(Product) private products: Repository<Product>,
    @InjectRepository(Variety) private varieties: Repository<Variety>,
  ) {}

  @Get('products') @Roles('admin', 'packer', 'stock')
  list() {
    return this.stock.list();
  }

  @Get('varieties') @Roles('admin', 'packer', 'stock')
  listVarieties() {
    return this.varieties.find({ order: { id: 'ASC' } });
  }

  /** 아버지: 예상·실제 수확량, 안전 비율 (FR-3.2) */
  @Patch('products/:id/stock') @Roles('admin', 'stock')
  async updateStock(
    @Param('id', ParseIntPipe) id: number,
    @Body() b: { expectedHarvestBoxes?: number; safetyRatio?: number; actualHarvestBoxes?: number | null },
  ) {
    const p = await this.products.findOne({ where: { id } });
    if (!p) throw new NotFoundException();
    if (b.expectedHarvestBoxes !== undefined) {
      if (!Number.isInteger(+b.expectedHarvestBoxes) || +b.expectedHarvestBoxes < 0) throw new BadRequestException('예상 수확량은 0 이상 정수(박스)');
      p.expectedHarvestBoxes = +b.expectedHarvestBoxes;
    }
    if (b.safetyRatio !== undefined) {
      const r = Number(b.safetyRatio);
      if (!(r > 0 && r <= 1)) throw new BadRequestException('안전 비율은 0~1 사이');
      p.safetyRatio = r;
    }
    if (b.actualHarvestBoxes !== undefined) {
      if (b.actualHarvestBoxes === null || (b.actualHarvestBoxes as any) === '') p.actualHarvestBoxes = null;
      else if (!Number.isInteger(+b.actualHarvestBoxes) || +b.actualHarvestBoxes < 0) throw new BadRequestException('실제 수확량은 0 이상 정수(박스)');
      else p.actualHarvestBoxes = +b.actualHarvestBoxes;
    }
    await this.products.save(p);
    return (await this.stock.list()).find((x) => x.id === id);
  }

  /** 아버지: 판매 시작일 (FR-3.3) */
  @Patch('varieties/:id') @Roles('admin', 'stock')
  async updateVariety(@Param('id', ParseIntPipe) id: number, @Body() b: { saleStartDate?: string }) {
    const v = await this.varieties.findOne({ where: { id } });
    if (!v) throw new NotFoundException();
    if (b.saleStartDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.saleStartDate)) throw new BadRequestException('날짜 형식 YYYY-MM-DD');
      v.saleStartDate = b.saleStartDate;
    }
    return this.varieties.save(v);
  }

  /** 관리자: 상품 추가 (FR-3.1) */
  @Post('products') @Roles('admin')
  async create(@Body() b: Partial<Product>) {
    if (!b.varietyId || !b.grade || !b.boxKg) throw new BadRequestException('품종·등급·규격은 필수');
    const p = this.products.create({
      varietyId: b.varietyId,
      grade: b.grade,
      boxKg: b.boxKg,
      price: b.price || 0,
      expectedHarvestBoxes: b.expectedHarvestBoxes || 0,
      safetyRatio: b.safetyRatio || 0.7,
      allowFriday: !!b.allowFriday,
    });
    return this.products.save(p);
  }

  /** 관리자: 가격·금요일 허용·판매 중지 (FR-4.3) */
  @Patch('products/:id') @Roles('admin')
  async update(@Param('id', ParseIntPipe) id: number, @Body() b: { price?: number; allowFriday?: boolean; active?: boolean }) {
    const p = await this.products.findOne({ where: { id } });
    if (!p) throw new NotFoundException();
    if (b.price !== undefined) p.price = +b.price;
    if (b.allowFriday !== undefined) p.allowFriday = !!b.allowFriday;
    if (b.active !== undefined) p.active = !!b.active;
    return this.products.save(p);
  }
}
