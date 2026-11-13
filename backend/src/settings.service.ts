import { Body, Controller, Get, Injectable, Patch } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './entities';
import { ShipRuleSettings } from './rules';
import { Roles } from './auth';

export const DEFAULT_SETTINGS: Record<string, string> = {
  cutoff_time: '15:00',
  ship_weekdays: '1,2,3,4',
  duplicate_window_days: '3',
  unpaid_warn_days: '3',
  incident_deadline_days: '2',
  default_safety_ratio: '0.70',
  bank_account: '농협 000-0000-0000-00 (햇살농원) — 가상 계좌',
  season_start: '2026-08-01', // 이번 판매 시즌 시작일: 이 날 이후 주문만 재고에서 차감
};

@Injectable()
export class SettingsService {
  constructor(@InjectRepository(Setting) private repo: Repository<Setting>) {}

  async all(): Promise<Record<string, string>> {
    const rows = await this.repo.find();
    const out = { ...DEFAULT_SETTINGS };
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  async num(key: string): Promise<number> {
    return Number((await this.all())[key]);
  }

  async ship(): Promise<ShipRuleSettings> {
    const s = await this.all();
    const [h, m] = s.cutoff_time.split(':').map(Number);
    return { cutoffMinutes: h * 60 + (m || 0), shipWeekdays: s.ship_weekdays.split(',').map(Number) };
  }

  async set(values: Record<string, string>) {
    for (const [key, value] of Object.entries(values)) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      await this.repo.upsert({ key, value: String(value) }, ['key']);
    }
    return this.all();
  }
}

@Controller('settings')
export class SettingsController {
  constructor(private s: SettingsService) {}
  @Get() @Roles('admin') get() {
    return this.s.all();
  }
  @Patch() @Roles('admin') patch(@Body() body: Record<string, string>) {
    return this.s.set(body || {});
  }
}
