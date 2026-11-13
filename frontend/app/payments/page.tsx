'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, fmtDateTime, fmtPhone, itemSummary, won } from '@/lib/api';
import { Badges, ErrorBox, Loading } from '@/components/ui';

export default function PaymentsPage() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [names, setNames] = useState<Record<number, string>>({});
  const [error, setError] = useState<any>(null);
  const [notice, setNotice] = useState('');

  const load = () => api('/orders?flag=unpaid').then(setRows).catch(setError);
  useEffect(() => {
    load();
  }, []);

  async function confirmPay(o: any) {
    setError(null);
    setNotice('');
    const depositorName = names[o.id] ?? o.ordererName;
    try {
      const r = await api(`/orders/${o.id}/payment`, { body: { depositorName } });
      setNotice(`#${o.id} ${o.ordererName} 입금 확인${r.depositorNameMismatch ? ` — 입금자 이름(${depositorName})이 주문자와 다릅니다 (표시만)` : ''}`);
      load();
    } catch (e) {
      setError(e);
    }
  }

  const days = (t: string) => Math.floor((Date.now() - new Date(t).getTime()) / 86400000);

  return (
    <>
      <h1>입금 확인</h1>
      <p className="muted small">현금 주문은 입금을 확인해야 발송됩니다. 3일 넘게 입금이 없으면 “입금 지연”으로 표시만 하고, 자동 취소하지 않습니다.</p>
      <ErrorBox error={error} />
      {notice && <div className="alert ok">{notice}</div>}
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="muted">입금 기다리는 주문이 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>주문</th>
                <th>주문자</th>
                <th>품목</th>
                <th>금액</th>
                <th>주문일</th>
                <th>경과</th>
                <th>입금자명</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/orders/${o.id}`}>#{o.id}</Link>
                  </td>
                  <td>
                    <strong>{o.ordererName}</strong>
                    <div className="small muted">{fmtPhone(o.ordererPhone) || '번호 없음'}</div>
                    <Badges list={o.badges} />
                  </td>
                  <td className="small">{itemSummary(o)}</td>
                  <td>{won(o.totalAmount)}</td>
                  <td className="small">{fmtDateTime(o.orderedAt)}</td>
                  <td>
                    <strong style={{ color: days(o.orderedAt) >= 3 ? 'var(--red)' : undefined }}>{days(o.orderedAt)}일</strong>
                  </td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <input style={{ width: 110 }} value={names[o.id] ?? o.ordererName} onChange={(e) => setNames({ ...names, [o.id]: e.target.value })} />
                      <button className="btn small" onClick={() => confirmPay(o)}>
                        확인
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
