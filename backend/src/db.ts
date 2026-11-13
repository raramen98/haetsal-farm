import 'dotenv/config';
import { DataSourceOptions } from 'typeorm';
import { types } from 'pg';

// DATE 칸은 'YYYY-MM-DD' 문자열 그대로 (시간대 변환 방지)
types.setTypeParser(1082, (v: string) => v);
import { ENTITIES } from './entities';

export function dbOptions(): DataSourceOptions & { type: 'postgres' } {
  const url = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/haetsal8';
  const local = /localhost|127\.0\.0\.1/.test(url);
  // Render 내부 주소(dpg-xxx-a)는 SSL 없이, 외부 주소는 SSL 필요
  const internal = /@dpg-[^.]+\/|@dpg-[^.]+:/.test(url) && !/render\.com/.test(url);
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    synchronize: true, // 해커톤: 엔티티 기준으로 테이블 자동 생성
    ssl: local || internal || process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  };
}
