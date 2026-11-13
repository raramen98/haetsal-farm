import { BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Ip, Post } from '@nestjs/common';
import { Public } from './auth';
import { OrdersService, ShipmentInput } from './orders';
import { normalizePhone, todayKst } from './rules';
import { SettingsService } from './settings.service';
import { StockService } from './stock';

/** 요청 횟수 제한 (IP당 1분 10회) — 로그인 없이 열리는 화면이라 */
const hits = new Map<string, number[]>();
function rateLimit(ip: string, max = 10) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  if (arr.length >= max) throw new HttpException('잠시 후 다시 시도해 주세요', HttpStatus.TOO_MANY_REQUESTS);
  arr.push(now);
  hits.set(ip, arr);
}

/**
 * 고객용 주문서 (카톡 채널 링크로 열림, 로그인 없음)
 * - 경로는 카톡, 입력 방식은 '고객 작성', 상태는 항상 '확인필요' (정우 씨 확인 후 접수)
 * - 남은 수량 숫자는 보여 주지 않고 주문 가능 / 얼마 안 남음 / 품절 / 예약만
 */
@Controller('public')
export class PublicController {
  constructor(private orders: OrdersService, private stock: StockService, private settings: SettingsService) {}

  @Public() @Get('order-form')
  async form() {
    const today = todayKst();
    const s = await this.settings.all();
    const products = (await this.stock.list())
      .filter((p) => p.active)
      .map((p) => ({
        id: p.id,
        label: p.label,
        price: p.price,
        status: p.remaining <= 0 ? 'soldout' : today < p.variety.saleStartDate ? 'preorder' : p.remaining <= 5 ? 'few' : 'ok',
        saleStartDate: p.variety.saleStartDate,
      }));
    return { products, bankAccount: s.bank_account, cutoff: s.cutoff_time };
  }

  @Public() @Post('orders')
  async create(
    @Ip() ip: string,
    @Body() b: { ordererName: string; ordererPhone: string; senderName?: string; memo?: string; shipments: ShipmentInput[] },
  ) {
    rateLimit(ip || 'unknown');
    if (!normalizePhone(b?.ordererPhone)) throw new BadRequestException('전화번호를 정확히 입력해 주세요 (예: 010-1234-5678)');
    if (!Array.isArray(b?.shipments) || b.shipments.length > 10) throw new BadRequestException('받는 곳은 1~10곳까지 입력할 수 있어요');
    try {
      const o = await this.orders.create(
        {
          channel: 'kakao',
          inputBy: 'customer',
          ordererName: String(b.ordererName || '').slice(0, 30),
          ordererPhone: b.ordererPhone,
          senderName: b.senderName ? String(b.senderName).slice(0, 30) : null,
          paymentMethod: 'cash',
          rawText: b.memo ? `고객 메모: ${String(b.memo).slice(0, 500)}` : null,
          shipments: b.shipments.map((s) => ({ ...s, addressConfirmed: true })),
        },
        null,
        { forceStatus: 'needs_check' },
      );
      return {
        id: o.id,
        isReservation: o.isReservation,
        totalAmount: o.totalAmount,
        shipDates: o.shipments.map((s) => s.shipDate),
        bankAccount: (await this.settings.all()).bank_account,
      };
    } catch (e: any) {
      // 고객에게는 남은 수량 숫자를 알려 주지 않는다
      if (e?.getStatus?.() === 409 && e.getResponse?.()?.details)
        throw new HttpException({ message: '선택하신 상품 중 남은 수량이 부족한 것이 있어요. 박스 수를 줄이거나 다른 상품을 골라 주세요.' }, 409);
      if (e?.getStatus?.() === 409) throw new HttpException({ message: '주문을 저장하지 못했어요. 농원으로 연락 주세요.' }, 409);
      throw e;
    }
  }
}
