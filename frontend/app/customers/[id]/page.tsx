'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, CHANNEL_LABEL, fmtDateTime, fmtPhone, shipDates } from '@/lib/api';
import { Badges, ErrorBox, Loading } from '@/components/ui';

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [c, setC] = useState<any>(null);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    api(`/customers/${id}`).then(setC).catch(setError);
  }, [id]);

  if (!c) return error ? <ErrorBox error={error} /> : <Loading />;

  const byYear = new Map<string, any[]>();
  for (const o of c.orders) {
    const y = String(new Date(new Date(o.orderedAt).getTime() + 9 * 3600000).getUTCFullYear());
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(o);
  }

  return (
    <>
      <h1>
        {c.displayName} <span className="muted">{fmtPhone(c.phone)}</span>
      </h1>
      <div className="card">
        <div>
          지금까지 쓰인 이름:{' '}
          <span className="badges">
            {c.knownNames.map((n: string) => (
              <span key={n} className={n === c.displayName ? 'badge blue' : 'badge gray'}>
                {n}
                {n !== c.displayName && ' · 이름 다름'}
              </span>
            ))}
          </span>
        </div>
        {c.knownNames.length > 1 && <p className="muted small">번호가 같아 같은 고객으로 묶었습니다. 실제로 다른 사람이면 고객 분리가 필요합니다.</p>}
        {c.samePhoneCount > 1 && <p className="small">이 번호를 쓰는 고객 기록이 {c.samePhoneCount}개 있습니다 (분리됨).</p>}
        {c.splitNote && <p className="muted small">메모: {c.splitNote}</p>}
      </div>

      <h2>지난 주문 {c.orders.length}건</h2>
      {[...byYear.entries()].map(([y, orders]) => (
        <div key={y}>
          <h3>{y}년</h3>
          {orders.map((o: any) => (
            <div className="card" key={o.id}>
              <div className="spread">
                <div>
                  <Link href={`/orders/${o.id}`}>
                    <strong>#{o.id}</strong>
                  </Link>{' '}
                  {CHANNEL_LABEL[o.channel]} · {fmtDateTime(o.orderedAt)} · 주문자 이름 “{o.ordererName}” <Badges list={o.badges} />
                </div>
                <Link className="btn small" href={`/orders/new?reorder=${o.id}`}>
                  다시 넣기
                </Link>
              </div>
              <ul style={{ margin: '6px 0 0' }}>
                {o.shipments.map((s: any) => (
                  <li key={s.id}>
                    {s.recipientName} · {s.address} — {s.items.map((i: any) => `${i.label} ${i.qtyBoxes}박스`).join(', ')}
                    {s.isReship && <span className="badge orange"> 재발송</span>}
                  </li>
                ))}
              </ul>
              <div className="muted small">발송 예정 {shipDates(o)}</div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
