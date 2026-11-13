import { BadRequestException, Controller, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import { AuthUser, CurrentUser, Roles } from './auth';
import { Order, Product } from './entities';
import { OrdersService, ShipmentInput } from './orders';
import { parseGrade, parseKg } from './rules';
import { productLabel } from './stock';

const COLS = {
  orderNo: ['주문번호'],
  orderedAt: ['주문일시', '결제일'],
  productName: ['상품명'],
  option: ['옵션', '옵션정보'],
  qty: ['수량'],
  ordererName: ['주문자명', '구매자명'],
  ordererPhone: ['주문자연락처', '구매자연락처'],
  recipientName: ['수령인명', '수취인명'],
  recipientPhone: ['수령인연락처', '수취인연락처1'],
  address: ['배송지', '통합배송지', '주소'],
  payStatus: ['결제상태'],
};

function pick(row: Record<string, any>, keys: string[]) {
  for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k];
  return undefined;
}

function toDate(v: any): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // 엑셀 날짜 숫자 (KST 기준으로 입력된 값)
    const ms = Math.round((v - 25569) * 86400000);
    return new Date(ms - 9 * 3600000);
  }
  const s = String(v).trim().replace(/\./g, '-').replace(' ', 'T');
  const d = new Date(/[+Z]/.test(s.slice(10)) ? s : s + '+09:00');
  return isNaN(d.getTime()) ? null : d;
}

/** FR-1.1 스마트스토어 엑셀 업로드 (R-13) */
@Controller('imports')
export class ImportsController {
  constructor(@InjectDataSource() private ds: DataSource, private orders: OrdersService) {}

  @Post('smartstore') @Roles('admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async smartstore(@UploadedFile() file: Express.Multer.File, @Query('dryRun') dryRun: string, @CurrentUser() u: AuthUser) {
    if (!file) throw new BadRequestException('엑셀 파일을 선택해 주세요');
    let rows: Record<string, any>[];
    try {
      const wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: false });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
    } catch {
      throw new BadRequestException('엑셀 파일을 읽을 수 없습니다');
    }
    if (!rows.length) throw new BadRequestException('주문 행이 없습니다');
    if (pick(rows[0], COLS.orderNo) === undefined && !Object.keys(rows[0]).some((k) => COLS.orderNo.includes(k)))
      throw new BadRequestException('"주문번호" 칸을 찾을 수 없습니다. 스마트스토어 주문 엑셀인지 확인해 주세요');

    const products = await this.ds.getRepository(Product).find();
    const matchProduct = (name: string, option: string) => {
      const text = `${name} ${option}`;
      const grade = parseGrade(text);
      const kg = parseKg(text);
      const cands = products.filter((p) => text.includes(p.variety.name) && (!grade || p.grade === grade) && (kg == null || Number(p.boxKg) === kg));
      return cands.length === 1 ? cands[0] : null;
    };

    // 주문번호로 묶기
    const groups = new Map<string, { rows: number[]; data: Record<string, any>[] }>();
    rows.forEach((r, i) => {
      const no = String(pick(r, COLS.orderNo) ?? '').trim();
      if (!no) return;
      if (!groups.has(no)) groups.set(no, { rows: [], data: [] });
      groups.get(no)!.rows.push(i + 2);
      groups.get(no)!.data.push(r);
    });

    const existing = new Set(
      (await this.ds.getRepository(Order).find({ where: { channel: 'smartstore' }, select: { externalOrderNo: true } })).map((o) => o.externalOrderNo),
    );

    const results: any[] = [];
    for (const [no, g] of groups) {
      const first = g.data[0];
      const base = { orderNo: no, rows: g.rows, ordererName: String(pick(first, COLS.ordererName) || '') };
      if (existing.has(no)) {
        results.push({ ...base, result: 'skipped', message: '이미 등록된 주문번호' });
        continue;
      }
      const errs: string[] = [];
      const shipMap = new Map<string, ShipmentInput>();
      const labels: string[] = [];
      for (const r of g.data) {
        const p = matchProduct(String(pick(r, COLS.productName) || ''), String(pick(r, COLS.option) || ''));
        const qty = Number(pick(r, COLS.qty) || 0);
        if (!p) errs.push(`상품을 찾을 수 없음: ${pick(r, COLS.productName)} / ${pick(r, COLS.option)}`);
        if (!(qty >= 1)) errs.push('수량 오류');
        const key = `${pick(r, COLS.recipientName)}|${pick(r, COLS.address)}`;
        if (!shipMap.has(key))
          shipMap.set(key, {
            recipientName: String(pick(r, COLS.recipientName) || ''),
            recipientPhone: String(pick(r, COLS.recipientPhone) || ''),
            address: String(pick(r, COLS.address) || ''),
            items: [],
          });
        if (p && qty >= 1) {
          shipMap.get(key)!.items.push({ productId: p.id, qtyBoxes: qty });
          labels.push(`${productLabel(p)} ${qty}박스`);
        }
      }
      const orderedAt = toDate(pick(first, COLS.orderedAt));
      if (!orderedAt) errs.push('주문일시 오류');
      const pay = String(pick(first, COLS.payStatus) || '결제완료');
      const input = {
        channel: 'smartstore' as const,
        externalOrderNo: no,
        ordererName: base.ordererName,
        ordererPhone: String(pick(first, COLS.ordererPhone) || ''),
        paymentMethod: 'prepaid' as const,
        paymentStatus: (/입금대기|미결제/.test(pay) ? 'pending' : 'paid') as 'paid' | 'pending',
        orderedAt,
        shipments: [...shipMap.values()],
      };
      const summary = { ...base, items: labels.join(', '), shipments: shipMap.size };
      if (errs.length) {
        results.push({ ...summary, result: 'error', message: errs.join(' / ') });
        continue;
      }
      if (dryRun === 'true') {
        results.push({ ...summary, result: 'new', message: '등록 예정' });
        continue;
      }
      try {
        const o = await this.orders.create(input, u);
        existing.add(no);
        results.push({ ...summary, result: 'created', orderId: o.id, message: o.duplicateStatus === 'suspect' ? '등록 (중복 의심)' : '등록' });
      } catch (e: any) {
        const r = e?.getResponse?.();
        const msg = r?.details ? `${r.message}: ${r.details.join(', ')}` : r?.message || e.message;
        results.push({ ...summary, result: 'error', message: Array.isArray(msg) ? msg.join(', ') : msg });
      }
    }
    const count = (k: string) => results.filter((r) => r.result === k).length;
    return {
      dryRun: dryRun === 'true',
      summary: { total: results.length, created: count('created'), new: count('new'), skipped: count('skipped'), error: count('error') },
      results,
    };
  }
}
