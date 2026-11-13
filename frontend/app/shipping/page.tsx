'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, fmtDate, fmtPhone, nextShipDays, SHIP_STATUS_LABEL, todayKst, weekday } from '@/lib/api';
import { ErrorBox, Loading } from '@/components/ui';

const WD = ['일', '월', '화', '수', '목', '금', '토'];

function ShippingInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const date = sp.get('date') || '';
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [notice, setNotice] = useState('');
  const [sel, setSel] = useState<Set<number>>(new Set());

  const load = () => {
    setData(null);
    api('/shipping/today' + (date ? `?date=${date}` : ''))
      .then((d) => {
        setData(d);
        setSel(new Set());
      })
      .catch(setError);
  };
  useEffect(load, [date]);

  async function markShipped() {
    setError(null);
    setNotice('');
    try {
      const r = await api('/shipping/shipped', { body: { ids: [...sel] } });
      setNotice(`${r.shipped}건 발송 완료 처리했습니다`);
      load();
    } catch (e) {
      setError(e);
    }
  }

  if (!data) return error ? <ErrorBox error={error} /> : <Loading />;
  const real = data.realToday || todayKst();
  const preview = data.today !== real;
  const dates = Array.from(new Set([...nextShipDays(real, 4, true), ...data.upcoming.map((u: any) => u.shipDate)])).sort().slice(0, 6);
  const upCount = (d: string) => data.upcoming.find((u: any) => u.shipDate === d)?.count;

  return (
    <>
      <div className="spread no-print">
        <h1>
          {preview ? `${fmtDate(data.today)} 보낼 목록 (미리 보기)` : `오늘 보낼 목록 · ${fmtDate(data.today)}`}
        </h1>
        <button className="btn ghost" onClick={() => window.print()}>인쇄</button>
      </div>

      {!data.isShipDay && (
        <div className="alert warn banner">
          {preview ? `${fmtDate(data.today)}` : '오늘'}은 {WD[weekday(data.today)]}요일 — 발송하지 않는 날입니다 (발송: 월~목)
        </div>
      )}
      {preview && <div className="alert info">미리 보기입니다. 발송 완료 처리는 발송 예정일 당일부터 할 수 있습니다.</div>}

      <div className="chips no-print">
        <button className={`chip ${!date ? 'on' : ''}`} onClick={() => router.push('/shipping')}>
          오늘 {fmtDate(real)}
        </button>
        {dates
          .filter((d) => d !== real)
          .map((d) => (
            <button key={d} className={`chip ${date === d ? 'on' : ''}`} onClick={() => router.push(`/shipping?date=${d}`)}>
              {fmtDate(d)}
              {upCount(d) ? ` · 새로 ${upCount(d)}건` : ''}
            </button>
          ))}
        <input type="date" value={date || real} onChange={(e) => router.push(`/shipping?date=${e.target.value}`)} />
      </div>

      <ErrorBox error={error} />
      {notice && <div className="alert ok">{notice}</div>}

      <h2>
        보낼 수 있는 건 {data.ready.length}건 <span className="muted small">(박스 합계 {data.ready.reduce((a: number, s: any) => a + s.totalBoxes, 0)})</span>
      </h2>
      {data.ready.length === 0 ? (
        <p className="muted">없습니다.</p>
      ) : (
        <>
          <div className="row no-print" style={{ marginBottom: 8 }}>
            <button className="btn small ghost" onClick={() => setSel(new Set(data.ready.map((s: any) => s.id)))}>전체 선택</button>
            <button className="btn small ghost" onClick={() => setSel(new Set())}>선택 해제</button>
            <button className="btn" disabled={!sel.size} onClick={markShipped}>
              선택 {sel.size}건 발송 완료
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="no-print"></th>
                  <th>받는 분</th>
                  <th>주소</th>
                  <th>품목</th>
                  <th>보내는 사람</th>
                  <th>예정일</th>
                  <th>포장</th>
                  <th>주문</th>
                </tr>
              </thead>
              <tbody>
                {data.ready.map((s: any) => (
                  <tr key={s.id} className={s.duplicateSuspect ? 'dup' : ''}>
                    <td className="no-print">
                      <input
                        type="checkbox"
                        checked={sel.has(s.id)}
                        onChange={(e) => {
                          const n = new Set(sel);
                          e.target.checked ? n.add(s.id) : n.delete(s.id);
                          setSel(n);
                        }}
                      />
                    </td>
                    <td>
                      <strong>{s.recipientName}</strong>
                      <div className="small muted">{fmtPhone(s.recipientPhone)}</div>
                    </td>
                    <td>{s.address}</td>
                    <td>
                      {s.items.map((i: any, k: number) => (
                        <div key={k}>
                          {i.label} × <strong>{i.qtyBoxes}</strong>
                        </div>
                      ))}
                      <div className="badges">
                        {s.hasGift && <span className="badge blue">선물용 · 보자기</span>}
                        {s.duplicateSuspect && <span className="badge orange">중복 의심 — 고객 확인</span>}
                        {s.overdue && <span className="badge red">밀린 건</span>}
                        {s.isReship && <span className="badge orange">재발송</span>}
                      </div>
                    </td>
                    <td>{s.senderName}</td>
                    <td>{fmtDate(s.shipDate)}</td>
                    <td>
                      <span className={s.status === 'packed' ? 'badge green' : 'badge gray'}>{SHIP_STATUS_LABEL[s.status]}</span>
                    </td>
                    <td>
                      <Link href={`/orders/${s.orderId}`}>#{s.orderId}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>못 보내는 건과 이유 {data.blocked.length}건</h2>
      {data.blocked.length === 0 ? (
        <p className="muted">없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>받는 분</th>
                <th>주문자</th>
                <th>품목</th>
                <th>예정일</th>
                <th>못 보내는 이유</th>
                <th>주문</th>
              </tr>
            </thead>
            <tbody>
              {data.blocked.map((s: any) => (
                <tr key={s.id} className={s.duplicateSuspect ? 'dup' : ''}>
                  <td>{s.recipientName}</td>
                  <td>
                    {s.ordererName} <span className="small muted">{fmtPhone(s.ordererPhone) || '번호 없음'}</span>
                  </td>
                  <td>{s.items.map((i: any) => `${i.label} ×${i.qtyBoxes}`).join(', ')}</td>
                  <td>{fmtDate(s.shipDate)}</td>
                  <td>
                    {s.reasons.map((r: string) => (
                      <span key={r} className="badge red" style={{ marginRight: 4 }}>
                        {r}
                      </span>
                    ))}
                  </td>
                  <td>
                    <Link href={`/orders/${s.orderId}`}>처리하기 #{s.orderId}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.upcoming.length > 0 && (
        <p className="muted small no-print">
          다가오는 발송일: {data.upcoming.map((u: any) => `${fmtDate(u.shipDate)} ${u.count}건`).join(' · ')}
        </p>
      )}
    </>
  );
}

export default function ShippingPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ShippingInner />
    </Suspense>
  );
}
