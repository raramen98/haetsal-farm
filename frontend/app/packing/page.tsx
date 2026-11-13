'use client';

import { useEffect, useState } from 'react';
import { api, fmtDate, nextShipDays, todayKst, weekday } from '@/lib/api';
import { ErrorBox, Loading } from '@/components/ui';

const WD = ['일', '월', '화', '수', '목', '금', '토'];

export default function PackingPage() {
  const [date, setDate] = useState<string>('');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<any>(null);

  const load = () =>
    api('/shipping/packing' + (date ? `?date=${date}` : ''))
      .then(setData)
      .catch(setError);
  useEffect(() => {
    setData(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function toggle(s: any) {
    setError(null);
    try {
      await api(`/shipments/${s.id}/packed`, { body: { packed: s.status !== 'packed' } });
      load();
    } catch (e) {
      setError(e);
    }
  }

  if (!data) return error ? <ErrorBox error={error} /> : <Loading />;
  const real = data.realToday || todayKst();
  const day = data.today;
  const isShipDay = [1, 2, 3, 4].includes(weekday(day));
  const done = data.list.filter((s: any) => s.status === 'packed').length;

  return (
    <>
      <h1>포장 목록 · {fmtDate(day)}</h1>
      {!isShipDay && <div className="alert warn banner">{day === real ? '오늘' : fmtDate(day)}은 {WD[weekday(day)]}요일 — 발송하지 않는 날입니다</div>}
      <div className="chips">
        <button className={`chip ${!date ? 'on' : ''}`} style={{ fontSize: 18 }} onClick={() => setDate('')}>
          오늘 {fmtDate(real)}
        </button>
        {nextShipDays(real, 4, false).map((d) => (
          <button key={d} className={`chip ${date === d ? 'on' : ''}`} style={{ fontSize: 18 }} onClick={() => setDate(d)}>
            {fmtDate(d)} 미리 보기
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      <p style={{ fontSize: 22 }}>
        모두 <strong>{data.list.length}</strong>곳 · 포장 끝 <strong>{done}</strong>곳
      </p>
      {data.list.length === 0 && <p className="muted">포장할 건이 없습니다.</p>}
      {data.list.map((s: any) => (
        <div key={s.id} className={`pack-card ${s.status === 'packed' ? 'done' : ''}`}>
          <div className="spread">
            <div className="who">{s.recipientName} 님</div>
            <div className="badges">
              {s.overdue && <span className="badge red">밀린 건</span>}
              {s.isReship && <span className="badge orange">재발송</span>}
            </div>
          </div>
          <div className="addr">{s.address}</div>
          {s.hasGift && <div className="gift-badge">선물용 · 보자기</div>}
          <div className="items">
            {s.items.map((i: any, k: number) => (
              <div key={k}>
                {i.label} — {i.qtyBoxes}박스
              </div>
            ))}
          </div>
          <div>
            보내는 사람: <strong>{s.senderName}</strong>
          </div>
          {s.memo && <div className="muted">메모: {s.memo}</div>}
          <button className={`btn big ${s.status === 'packed' ? 'secondary' : ''}`} style={{ marginTop: 12, width: '100%' }} onClick={() => toggle(s)}>
            {s.status === 'packed' ? '✓ 포장 끝 (누르면 취소)' : '포장 다 했어요'}
          </button>
        </div>
      ))}
    </>
  );
}
