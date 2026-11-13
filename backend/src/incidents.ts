import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { InjectDataSource } from '@nestjs/typeorm';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { AuthUser, CurrentUser, Roles } from './auth';
import { Incident, IncidentLog, IncidentPhoto, Order, Product, Shipment, ShipmentItem } from './entities';
import { calcShipDate, isIncidentLate } from './rules';
import { SettingsService } from './settings.service';
import { StockService, productLabel } from './stock';

const TYPE_LABEL = { broken: '깨짐', spoiled: '상함', other: '기타' };
const STATUS_LABEL = { received: '접수', in_progress: '처리중', done: '완료' };

/** R-11 배송 사고 (FR-6.1~6.4) */
@Controller('incidents')
export class IncidentsController {
  constructor(@InjectDataSource() private ds: DataSource, private stock: StockService, private settings: SettingsService) {}

  private async log(m: { getRepository: DataSource['getRepository'] }, incidentId: number, userId: number | null, action: string, memo = '') {
    await m.getRepository(IncidentLog).save({ incidentId, userId, action, memo });
  }

  @Get() @Roles('admin')
  async list() {
    const rows = await this.ds.getRepository(Incident).find({
      relations: { shipment: { order: true, items: { product: true } } },
      order: { reportedAt: 'DESC' },
    });
    return rows.map((i) => this.view(i));
  }

  private view(i: Incident) {
    return {
      ...i,
      typeLabel: TYPE_LABEL[i.type],
      statusLabel: STATUS_LABEL[i.status],
      needsApproval: i.isLate && !i.lateApprovedAt,
      ordererName: i.shipment?.order?.ordererName,
      recipientName: i.shipment?.recipientName,
      items: i.shipment?.items?.map((x) => ({ productId: x.productId, label: productLabel(x.product), qtyBoxes: x.qtyBoxes })),
    };
  }

  @Get(':id') @Roles('admin')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const i = await this.ds.getRepository(Incident).findOne({
      where: { id },
      relations: { shipment: { order: true, items: { product: true } }, photos: true, logs: true },
    });
    if (!i) throw new NotFoundException();
    i.logs.sort((a, b) => a.id - b.id);
    const reship = i.reshipShipmentId ? await this.ds.getRepository(Shipment).findOne({ where: { id: i.reshipShipmentId } }) : null;
    return { ...this.view(i), photos: i.photos.map((p) => ({ id: p.id, mimeType: p.mimeType })), reship };
  }

  /** 사진은 DB에서 꺼내 내려준다 */
  @Get('photos/:id') @Roles('admin')
  async photo(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const p = await this.ds.getRepository(IncidentPhoto).createQueryBuilder('p').addSelect('p.data').where('p.id = :id', { id }).getOne();
    if (!p) throw new NotFoundException();
    res.setHeader('Content-Type', p.mimeType);
    res.send(p.data);
  }

  /** 접수: 사진 필수, 받은 날 + 2일 초과면 기한 초과 */
  @Post() @Roles('admin')
  @UseInterceptors(FilesInterceptor('photos', 5, { limits: { fileSize: 5 * 1024 * 1024 } }))
  async create(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() b: { shipmentId: string; type: string; receivedDate: string; memo?: string },
    @CurrentUser() u: AuthUser,
  ) {
    if (!files?.length) throw new BadRequestException('사진은 반드시 1장 이상 첨부해야 합니다');
    if (files.some((f) => !/^image\//.test(f.mimetype))) throw new BadRequestException('사진(이미지) 파일만 올릴 수 있습니다');
    if (!['broken', 'spoiled', 'other'].includes(b.type)) throw new BadRequestException('사고 종류를 선택해 주세요');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.receivedDate || '')) throw new BadRequestException('받은 날을 입력해 주세요');
    const sh = await this.ds.getRepository(Shipment).findOne({ where: { id: +b.shipmentId } });
    if (!sh) throw new BadRequestException('배송 건을 찾을 수 없습니다');
    const now = new Date();
    const deadline = await this.settings.num('incident_deadline_days');
    const isLate = isIncidentLate(b.receivedDate, now, deadline);
    const id = await this.ds.transaction(async (m) => {
      const inc = await m.getRepository(Incident).save(
        m.getRepository(Incident).create({ shipmentId: sh.id, type: b.type as any, receivedDate: b.receivedDate, reportedAt: now, isLate, memo: b.memo || '' }),
      );
      for (const f of files) await m.getRepository(IncidentPhoto).save({ incidentId: inc.id, mimeType: f.mimetype, data: f.buffer });
      await m.getRepository(Shipment).update(sh.id, { receivedDate: b.receivedDate });
      await this.log(m, inc.id, u.id, '접수', `${TYPE_LABEL[b.type]}, 사진 ${files.length}장${isLate ? `, 기한 초과(받은 날 + ${deadline}일 지남)` : ''}`);
      return inc.id;
    });
    return this.detail(id);
  }

  @Post(':id/approve-late') @Roles('admin')
  async approveLate(@Param('id', ParseIntPipe) id: number, @Body() b: { memo?: string }, @CurrentUser() u: AuthUser) {
    const i = await this.ds.getRepository(Incident).findOne({ where: { id } });
    if (!i) throw new NotFoundException();
    if (!i.isLate) throw new ConflictException('기한 초과 건이 아닙니다');
    await this.ds.getRepository(Incident).update(id, { lateApprovedBy: u.id, lateApprovedAt: new Date() });
    await this.log(this.ds, id, u.id, '예외승인', b?.memo || '');
    return this.detail(id);
  }

  @Patch(':id') @Roles('admin')
  async update(@Param('id', ParseIntPipe) id: number, @Body() b: { status?: string; memo?: string }, @CurrentUser() u: AuthUser) {
    const i = await this.ds.getRepository(Incident).findOne({ where: { id } });
    if (!i) throw new NotFoundException();
    if (b.status) {
      if (!['received', 'in_progress', 'done'].includes(b.status)) throw new BadRequestException('상태 값이 올바르지 않습니다');
      if (i.isLate && !i.lateApprovedAt && b.status !== 'received') throw new ConflictException('기한 초과 건은 예외 승인 후 처리할 수 있습니다');
      await this.ds.getRepository(Incident).update(id, { status: b.status as any });
      await this.log(this.ds, id, u.id, '상태변경', `${STATUS_LABEL[i.status]} → ${STATUS_LABEL[b.status]}${b.memo ? ` · ${b.memo}` : ''}`);
    } else if (b.memo) {
      await this.log(this.ds, id, u.id, '메모', b.memo);
    }
    return this.detail(id);
  }

  /** 재발송 = 새 배송 건 + 재고 차감 (부족하면 409) */
  @Post(':id/reship') @Roles('admin')
  async reship(@Param('id', ParseIntPipe) id: number, @Body() b: { items?: { productId: number; qtyBoxes: number }[] }, @CurrentUser() u: AuthUser) {
    const inc = await this.ds.getRepository(Incident).findOne({ where: { id }, relations: { shipment: { order: true, items: { product: true } } } });
    if (!inc) throw new NotFoundException();
    if (inc.isLate && !inc.lateApprovedAt) throw new ConflictException('기한 초과 건은 예외 승인 후 재발송할 수 있습니다');
    if (inc.reshipShipmentId) throw new ConflictException('이미 재발송 건이 있습니다');
    const items = (b?.items?.length ? b.items : inc.shipment.items.map((x) => ({ productId: x.productId, qtyBoxes: x.qtyBoxes }))).map((x) => ({
      productId: +x.productId,
      qtyBoxes: +x.qtyBoxes,
    }));
    if (items.some((x) => !x.productId || !Number.isInteger(x.qtyBoxes) || x.qtyBoxes < 1)) throw new BadRequestException('재발송 품목을 확인해 주세요');
    const ship = await this.settings.ship();
    await this.ds.transaction(async (m) => {
      const req = new Map<number, number>();
      items.forEach((x) => req.set(x.productId, (req.get(x.productId) || 0) + x.qtyBoxes));
      await this.stock.assertAvailable(m, req);
      const products = await m.getRepository(Product).find();
      const ps = items.map((x) => products.find((p) => p.id === x.productId)!);
      const src = inc.shipment;
      const sh = await m.getRepository(Shipment).save(
        m.getRepository(Shipment).create({
          orderId: src.orderId,
          recipientName: src.recipientName,
          recipientPhone: src.recipientPhone,
          address: src.address,
          addressConfirmed: true,
          isReship: true,
          memo: `사고 #${inc.id} 재발송`,
          shipDate: calcShipDate(new Date(), { allowFriday: ps.every((p) => p.allowFriday) }, ship),
        }),
      );
      for (const x of items) await m.getRepository(ShipmentItem).save({ shipmentId: sh.id, productId: x.productId, qtyBoxes: x.qtyBoxes, unitPrice: 0 });
      await m.getRepository(Incident).update(id, { reshipShipmentId: sh.id, status: 'in_progress' });
      await this.log(m, id, u.id, '재발송', `${ps.map((p, k) => `${productLabel(p)} ${items[k].qtyBoxes}박스`).join(', ')} · 발송 예정 ${sh.shipDate}`);
    });
    return this.detail(id);
  }

  /** 접수 화면용: 발송된 배송 건 검색 */
  @Get('candidates/shipments') @Roles('admin')
  async candidates() {
    const rows = await this.ds
      .getRepository(Shipment)
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.order', 'o')
      .leftJoinAndSelect('s.items', 'i')
      .leftJoinAndSelect('i.product', 'p')
      .leftJoinAndSelect('p.variety', 'v')
      .where(`s.status = 'shipped'`)
      .orderBy('s.shippedAt', 'DESC')
      .take(100)
      .getMany();
    return rows.map((s) => ({
      id: s.id,
      orderId: s.orderId,
      ordererName: s.order.ordererName,
      recipientName: s.recipientName,
      address: s.address,
      shippedAt: s.shippedAt,
      items: s.items.map((i) => `${productLabel(i.product)} ${i.qtyBoxes}박스`).join(', '),
    }));
  }
}

export { Order };
