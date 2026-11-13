'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { ErrorBox, Loading } from '@/components/ui';


const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const addDays = (d: string, n: number) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10);
const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + n, 1));
  return t.toISOString().slice(0, 7);
};

type Ev = { kind: 'ship' | 'shipped' | 'sale' | 'incident' | 'unpaid'; text: string; href: string };

export default function HomePage() {
  const [counts, setCounts] = useState<any>(null);
  const [ship, setShip] = useState<any>(null);
  const [next, setNext] = useState<any>(null);
  const [cal, setCal] = useState<any>(null);
  const [month, setMonth] = useState<string>('');
  const [selected, setSelected] = useState<string>('');
  const [varieties, setVarieties] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [unpaid, setUnpaid] = useState<any[]>([]);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      api('/orders/counts'),
      api('/shipping/today'),
      api('/incidents').catch(() => []),
      api('/varieties').catch(() => []),
      api('/orders?flag=unpaid').catch(() => []),
    ])
      .then(([c, s, i, v, u]) => {
        setCounts(c);
        setShip(s);
        setIncidents(i || []);
        setVarieties(v || []);
        setUnpaid(u || []);
        setMonth(c.today.slice(0, 7));
        setSelected(c.today);
        const nd = !s.isShipDay && s.upcoming?.[0]?.shipDate;
        if (nd) api(`/shipping/today?date=${nd}`).then(setNext).catch(() => {});
      })
      .catch(setError);
  }, []);

  useEffect(() => {
    if (month) api(`/shipping/calendar?month=${month}`).then(setCal).catch(() => setCal(null));
  }, [month]);

  // 날짜별 일정 (달력과 아래 상세에 같이 씀)
  const events = useMemo(() => {
    const map: Record<string, Ev[]> = {};
    const add = (d: string, e: Ev) => (map[d] ||= []).push(e);
    for (const d of cal?.days || []) {
      if (d.planned) add(d.date, { kind: 'ship', text: `발송 예정 ${d.planned}건${d.blocked ? ` (못 보내는 건 ${d.blocked})` : ''}`, href: `/shipping?date=${d.date}` });
      if (d.shipped) add(d.date, { kind: 'shipped', text: `발송 완료 ${d.shipped}건`, href: '/orders' });
    }
    for (const v of varieties) add(v.saleStartDate, { kind: 'sale', text: `${v.name} 판매 시작 (이전 주문은 예약)`, href: '/stock' });
    for (const i of incidents.filter((x) => x.status !== 'done'))
      add(addDays(i.receivedDate, 2), { kind: 'incident', text: `사고 접수 기한 · ${i.recipientName} (${i.typeLabel})`, href: `/incidents/${i.id}` });
    for (const o of unpaid)
      add(addDays(kstDate(o.orderedAt), 3), { kind: 'unpaid', text: `입금 3일째 · ${o.ordererName}`, href: `/orders/${o.id}` });
    return map;
  }, [cal, varieties, incidents, unpaid]);

  if (error) return <ErrorBox error={error} />;
  if (!counts || !ship) return <Loading />;

  const today = counts.today;
  const target = !ship.isShipDay ? next : null;
  const base = target || ship;
  const dayLabel = target ? fmtDate(target.today) : '오늘';
  const openIncidents = incidents.filter((i) => i.status !== 'done');
  const needApproval = incidents.filter((i) => i.needsApproval).length;

  // 오늘 할 일: 데이터에서 나온 할 일 (0건이면 끝난 것으로 표시)
  const todos = [
    ship.isShipDay
      ? { n: base.ready.length, title: '오늘 보낼 건 포장·발송 완료 처리', desc: '오후 3시 택배 수거 전', href: '/shipping' }
      : { n: base.ready.length, title: `${dayLabel} 보낼 건 포장 준비`, desc: '오늘은 발송 없는 날 — 미리 확인', href: `/shipping?date=${target?.today || ''}` },
    { n: base.blocked.length, title: `${dayLabel}까지 못 보내는 건 해결`, desc: '입금 전·번호 없음·확인 전', href: target ? `/shipping?date=${target.today}` : '/shipping' },
    { n: counts.needsCheck, title: '확인필요 주문 확인', desc: '어머니 전화 주문 등 — 확인해야 접수', href: '/orders?flag=needs_check' },
    { n: counts.phoneMissing, title: '번호 확인 필요 주문에 번호 넣기', desc: '번호를 넣기 전엔 발송 불가', href: '/orders?flag=phone_missing' },
    { n: counts.duplicate, title: '중복 의심 주문 처리', desc: '고객 확인 후 합치기·유지 (자동 취소 없음)', href: '/orders?flag=duplicate' },
    { n: counts.unpaid, title: '입금 확인', desc: counts.unpaidLate ? `그중 3일 넘은 ${counts.unpaidLate}건은 연락 필요` : '통장 입금 내역과 맞춰 보기', href: '/payments' },
    { n: openIncidents.length, title: '배송 사고 처리', desc: needApproval ? `기한 초과 승인 필요 ${needApproval}건` : '재발송·처리 기록', href: '/incidents' },
  ];
  const left = todos.filter((t) => t.n > 0);
  const done = todos.filter((t) => t.n === 0);

  // 달력 칸
  const first = `${month}-01`;
  const startWd = new Date(first + 'T00:00:00Z').getUTCDay();
  const [y, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(startWd).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => addDays(first, i))];
  while (cells.length % 7) cells.push(null);
  const shipDays: number[] = cal?.shipWeekdays || [1, 2, 3, 4];
  const sel = events[selected] || [];
  const selWd = selected ? new Date(selected + 'T00:00:00Z').getUTCDay() : 0;

  return (
    <>
      <h1>{fmtDate(today)} · 햇살농원</h1>
      {!ship.isShipDay && (
        <div className="alert warn">
          오늘은 발송하지 않는 날이에요 (발송 요일: 월~목).
          {target && <> 다음 발송일은 <strong>{fmtDate(target.today)}</strong>이에요.</>}
        </div>
      )}

      <div className="quick">
        <span className="quick-label">빠른 메뉴</span>
        <Link className="btn" href="/phone-order">+ 전화 주문 입력</Link>
        <Link className="btn secondary" href="/import">스마트스토어 엑셀 올리기</Link>
        <Link className="btn secondary" href="/qa">답장 도우미</Link>
      </div>

      <div className="home-grid">
        <section className="card todo">
          <div className="spread" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>오늘 할 일</h2>
            <span className="muted small">남은 일 {left.length}개</span>
          </div>
          <ul className="todo-list">
            {left.map((t) => (
              <li key={t.title}>
                <Link href={t.href} className="todo-row">
                  <span className="todo-box" aria-hidden="true" />
                  <span className="todo-text">
                    <span className="todo-title">
                      {t.title} <span className="todo-count">{t.n}건</span>
                    </span>
                    <span className="todo-desc">{t.desc}</span>
                  </span>
                  <span className="todo-go" aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
            {done.map((t) => (
              <li key={t.title}>
                <div className="todo-row done">
                  <span className="todo-box checked" aria-hidden="true">✓</span>
                  <span className="todo-text">
                    <span className="todo-title">{t.title}</span>
                    <span className="todo-desc">할 일 없음</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card cal">
          <div className="spread" style={{ marginBottom: 8 }}>
            <button className="btn small ghost" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="이전 달">‹</button>
            <h2 style={{ margin: 0 }}>{y}년 {mo}월</h2>
            <button className="btn small ghost" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="다음 달">›</button>
          </div>
          <div className="cal-grid">
            {WEEK.map((w, i) => (
              <div key={w} className={`cal-wd ${shipDays.includes(i) ? '' : 'off'}`}>{w}</div>
            ))}
            {cells.map((d, i) => {
              if (!d) return <div key={'e' + i} />;
              const wd = i % 7;
              const ev = events[d] || [];
              const kinds = new Set(ev.map((e) => e.kind));
              return (
                <button
                  key={d}
                  type="button"
                  className={`cal-day ${d === today ? 'today' : ''} ${d === selected ? 'sel' : ''} ${shipDays.includes(wd) ? '' : 'off'} ${d < today ? 'past' : ''}`}
                  onClick={() => setSelected(d)}
                >
                  <span className="cal-num">{Number(d.slice(8))}</span>
                  <span className="cal-dots">
                    {kinds.has('ship') && <i className="dot ship" />}
                    {kinds.has('sale') && <i className="dot sale" />}
                    {(kinds.has('incident') || kinds.has('unpaid')) && <i className="dot warn" />}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="cal-legend">
            <span><i className="dot ship" />발송 예정</span>
            <span><i className="dot sale" />판매 시작</span>
            <span><i className="dot warn" />기한</span>
            <span><i className="dot off" />발송 없는 날</span>
          </div>

          <div className="cal-detail">
            <div className="cal-detail-title">
              {fmtDate(selected)} {selected === today && <span className="badge red">오늘</span>}
              {!shipDays.includes(selWd) && <span className="badge gray">발송 없는 날</span>}
            </div>
            {sel.length === 0 ? (
              <p className="muted small" style={{ margin: '4px 0 0' }}>이 날 일정이 없어요.</p>
            ) : (
              <ul className="cal-events">
                {sel.map((e, k) => (
                  <li key={k}>
                    <i className={`dot ${e.kind === 'incident' || e.kind === 'unpaid' ? 'warn' : e.kind === 'shipped' ? 'done' : e.kind}`} />
                    <Link href={e.href}>{e.text}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
