'use client';

import { errInfo } from '@/lib/api';

export function badgeClass(b: string) {
  if (b === '확인필요' || b === '번호 확인 필요' || b === '취소') return 'badge red';
  if (b === '중복 의심') return 'badge orange';
  if (b === '입금대기' || b === '입금 지연') return 'badge yellow';
  if (b === '예약' || b === '고객 작성') return 'badge blue';
  if (b === '포장완료' || b === '발송완료') return 'badge green';
  return 'badge gray';
}

export function Badges({ list }: { list?: string[] }) {
  if (!list?.length) return null;
  return (
    <span className="badges">
      {list.map((b) => (
        <span key={b} className={badgeClass(b)}>
          {b}
        </span>
      ))}
    </span>
  );
}

/** 서버 에러 표시 (details 목록 포함 — 재고 초과 등) */
export function ErrorBox({ error }: { error: any }) {
  if (!error) return null;
  const { message, details } = errInfo(error);
  return (
    <div className="alert error" role="alert">
      <strong>{message}</strong>
      {details.length > 0 && (
        <ul>
          {details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Loading() {
  return <p className="muted">불러오는 중…</p>;
}
