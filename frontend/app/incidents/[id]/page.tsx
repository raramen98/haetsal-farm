'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, fmtDate, fmtDateTime } from '@/lib/api';
import { ErrorBox, Loading } from '@/components/ui';

function Photo({ id }: { id: number }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let u = '';
    api(`/incidents/photos/${id}`, { raw: true })
      .then((r: Response) => r.blob())
      .then((b) => {
        u = URL.createObjectURL(b);
        setUrl(u);
      })
      .catch(() => {});
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  if (!url) return <div className="muted small">사진 불러오는 중…</div>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`사고 사진 ${id}`} style={{ maxWidth: 240, maxHeight: 240, borderRadius: 8, border: '1px solid var(--line)' }} />
    </a>
  );
}

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [i, setI] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState('');
  const [memo, setMemo] = useState('');

  useEffect(() => {
    api(`/incidents/${id}`)
      .then((d) => {
        setI(d);
        setStatus(d.status);
      })
      .catch(setError);
  }, [id]);

  async function act(fn: () => Promise<any>, msg: string) {
    setError(null);
    setNotice('');
    try {
      const d = await fn();
      setI(d);
      setStatus(d.status);
      setMemo('');
      setNotice(msg);
    } catch (e) {
      setError(e);
    }
  }

  if (!i) return error ? <ErrorBox error={error} /> : <Loading />;

  return (
    <>
      <div className="spread">
        <h1>
          배송 사고 #{i.id} · {i.typeLabel}{' '}
          <span className={i.status === 'done' ? 'badge green' : 'badge blue'}>{i.statusLabel}</span> {i.isLate && <span className="badge red">기한 초과</span>}
        </h1>
        <Link className="btn ghost" href="/incidents">목록</Link>
      </div>
      <ErrorBox error={error} />
      {notice && <div className="alert ok">{notice}</div>}

      {i.needsApproval && (
        <div className="alert warn">
          받은 날({fmtDate(i.receivedDate)}) + 2일이 지나 접수되었습니다. 처리·재발송하려면 예외 승인이 필요합니다.{' '}
          <button className="btn small" onClick={() => act(() => api(`/incidents/${i.id}/approve-late`, { body: { memo } }), '예외 승인했습니다')}>
            예외 승인
          </button>
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <h3>배송 건</h3>
          <div>
            주문 <Link href={`/orders/${i.shipment?.orderId}`}>#{i.shipment?.orderId}</Link> · {i.ordererName} → <strong>{i.recipientName}</strong>
          </div>
          <div className="muted">{i.shipment?.address}</div>
          <ul>
            {i.items?.map((x: any, k: number) => (
              <li key={k}>
                {x.label} × {x.qtyBoxes}박스
              </li>
            ))}
          </ul>
          <div>
            받은 날 {fmtDate(i.receivedDate)} · 접수 {fmtDateTime(i.reportedAt)}
          </div>
          {i.memo && <div>메모: {i.memo}</div>}
          {i.reship ? (
            <div className="alert info">
              재발송 건 만듦 — 발송 예정 {fmtDate(i.reship.shipDate)} ({i.reship.status === 'shipped' ? '발송완료' : '대기'})
            </div>
          ) : (
            <button
              className="btn"
              style={{ marginTop: 8 }}
              disabled={i.needsApproval}
              onClick={() => confirm('같은 품목으로 재발송 건을 만들까요? 재고에서 차감됩니다.') && act(() => api(`/incidents/${i.id}/reship`, { body: {} }), '재발송 건을 만들었습니다 (재고 차감)')}
            >
              재발송 만들기
            </button>
          )}
        </div>
        <div className="card">
          <h3>사진 {i.photos.length}장</h3>
          <div className="row">
            {i.photos.map((p: any) => (
              <Photo key={p.id} id={p.id} />
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>상태 변경 · 기록</h3>
        <div className="row">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="received">접수</option>
            <option value="in_progress">처리중</option>
            <option value="done">완료</option>
          </select>
          <input placeholder="메모 (선택)" value={memo} onChange={(e) => setMemo(e.target.value)} style={{ minWidth: 300 }} />
          <button
            className="btn"
            onClick={() =>
              act(
                () => api(`/incidents/${i.id}`, { method: 'PATCH', body: status !== i.status ? { status, memo } : { memo } }),
                status !== i.status ? '상태를 바꿨습니다' : '메모를 남겼습니다',
              )
            }
            disabled={status === i.status && !memo}
          >
            저장
          </button>
        </div>
        <h3>처리 기록</h3>
        <ul className="timeline">
          {i.logs.map((l: any) => (
            <li key={l.id}>
              <strong>{l.action}</strong> <span className="muted small">{fmtDateTime(l.createdAt)}</span>
              {l.memo && <div>{l.memo}</div>}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
