'use client';
import OrderFormPreview from '@/components/OrderFormPreview';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, CHANNEL_LABEL, fmtDateTime, fmtPhone, itemSummary, shipDates } from '@/lib/api';
import { Badges, ErrorBox, Loading } from '@/components/ui';

const FLAGS = [
  ['', '전체'],
  ['active', '진행 중'],
  ['needs_check', '확인필요'],
  ['phone_missing', '번호 확인 필요'],
  ['duplicate', '중복 의심'],
  ['unpaid', '입금대기'],
  ['unpaid_late', '입금 지연'],
  ['reservation', '예약'],
  ['cancelled', '취소'],
];
const CHANNELS = [
  ['', '모든 경로'],
  ['smartstore', '스마트스토어'],
  ['kakao', '카카오톡'],
  ['phone', '전화'],
];

function OrdersInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const flag = sp.get('flag') || '';
  const channel = sp.get('channel') || '';
  const q0 = sp.get('q') || '';
  const [q, setQ] = useState(q0);
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    setRows(null);
    const p = new URLSearchParams();
    if (flag) p.set('flag', flag);
    if (channel) p.set('channel', channel);
    if (q0) p.set('q', q0);
    api('/orders?' + p.toString()).then(setRows).catch(setError);
  }, [flag, channel, q0]);

  function go(next: Record<string, string>) {
    const p = new URLSearchParams({ flag, channel, q: q0, ...next });
    [...p.keys()].forEach((k) => !p.get(k) && p.delete(k));
    router.push('/orders?' + p.toString());
  }

  return (
    <>
      <div className="spread">
        <h1>주문 목록</h1>
        <div className="row">
          <OrderFormPreview />
          <Link className="btn secondary" href="/import">스마트스토어 엑셀 올리기</Link>
          <Link className="btn" href="/phone-order">+ 전화 주문</Link>
        </div>
      </div>
      <div className="chips">
        {FLAGS.map(([v, l]) => (
          <button key={v} className={`chip ${flag === v ? 'on' : ''}`} onClick={() => go({ flag: v })}>
            {l}
          </button>
        ))}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q });
        }}
      >
        <select value={channel} onChange={(e) => go({ channel: e.target.value })}>
          {CHANNELS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input placeholder="이름·전화번호·주문번호 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn secondary">검색</button>
      </form>
      <ErrorBox error={error} />
      {!rows ? (
        error ? null : <Loading />
      ) : rows.length === 0 ? (
        <p className="muted">해당하는 주문이 없습니다.</p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>경로</th>
                <th>주문자</th>
                <th>배송지</th>
                <th>품목</th>
                <th>발송 예정</th>
                <th>상태</th>
                <th>주문 시각</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className={`clickable ${o.badges?.includes('중복 의심') ? 'dup' : ''}`} onClick={() => router.push(`/orders/${o.id}`)}>
                  <td>{o.id}</td>
                  <td>
                    {CHANNEL_LABEL[o.channel]}
                    {o.externalOrderNo && <div className="muted small">{o.externalOrderNo}</div>}
                  </td>
                  <td>
                    <strong>{o.ordererName}</strong>
                    <div className="muted small">{fmtPhone(o.ordererPhone) || '번호 없음'}</div>
                  </td>
                  <td>{o.shipments?.filter((s: any) => !s.isReship).length}곳</td>
                  <td>{itemSummary(o)}</td>
                  <td>{shipDates(o)}</td>
                  <td>
                    <Badges list={o.badges} />
                  </td>
                  <td className="small">{fmtDateTime(o.orderedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <OrdersInner />
    </Suspense>
  );
}
