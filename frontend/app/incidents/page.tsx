'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, fmtDate, fmtDateTime, todayKst } from '@/lib/api';
import { ErrorBox, Loading } from '@/components/ui';

export default function IncidentsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<any[] | null>(null);
  const [cands, setCands] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<any>(null);
  const [f, setF] = useState({ shipmentId: '', type: 'broken', receivedDate: todayKst(), memo: '' });
  const [photos, setPhotos] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/incidents').then(setRows).catch(setError);
  }, []);

  async function openNew() {
    setShowNew(true);
    try {
      setCands(await api('/incidents/candidates/shipments'));
    } catch (e) {
      setError(e);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => fd.append(k, v));
      if (photos) Array.from(photos).forEach((p) => fd.append('photos', p));
      const r = await api('/incidents', { body: fd });
      router.push(`/incidents/${r.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="spread">
        <h1>배송 사고</h1>
        {!showNew && (
          <button className="btn" onClick={openNew}>
            + 사고 접수
          </button>
        )}
      </div>
      <ErrorBox error={error} />

      {showNew && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>사고 접수</h2>
          <p className="muted small">사진은 반드시 1장 이상. 받은 날 + 2일이 지나면 “기한 초과”로 표시되고 예외 승인이 필요합니다.</p>
          <div className="fields">
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              발송된 배송 건 *
              <select value={f.shipmentId} onChange={(e) => setF({ ...f, shipmentId: e.target.value })}>
                <option value="">선택</option>
                {cands.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.orderId} {c.ordererName} → {c.recipientName} · {c.items} · 발송 {fmtDateTime(c.shippedAt)}
                  </option>
                ))}
              </select>
              {cands.length === 0 && <span className="small">발송 완료된 배송 건이 없습니다.</span>}
            </label>
            <label className="field">
              종류 *
              <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                <option value="broken">깨짐</option>
                <option value="spoiled">상함</option>
                <option value="other">기타</option>
              </select>
            </label>
            <label className="field">
              받은 날 *
              <input type="date" value={f.receivedDate} onChange={(e) => setF({ ...f, receivedDate: e.target.value })} />
            </label>
            <label className="field">
              사진 * (최대 5장)
              <input type="file" accept="image/*" multiple onChange={(e) => setPhotos(e.target.files)} />
            </label>
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              메모
              <textarea value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} style={{ minHeight: 60 }} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" disabled={busy || !f.shipmentId} onClick={submit}>
              접수
            </button>
            <button className="btn ghost" onClick={() => setShowNew(false)}>
              닫기
            </button>
          </div>
        </div>
      )}

      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="muted">접수된 사고가 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>주문자 → 받는 분</th>
                <th>품목</th>
                <th>종류</th>
                <th>받은 날</th>
                <th>접수</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="clickable" onClick={() => router.push(`/incidents/${i.id}`)}>
                  <td>{i.id}</td>
                  <td>
                    {i.ordererName} → {i.recipientName}
                  </td>
                  <td className="small">{i.items?.map((x: any) => `${x.label} ${x.qtyBoxes}박스`).join(', ')}</td>
                  <td>{i.typeLabel}</td>
                  <td>{fmtDate(i.receivedDate)}</td>
                  <td className="small">{fmtDateTime(i.reportedAt)}</td>
                  <td>
                    <span className="badges">
                      <span className={i.status === 'done' ? 'badge green' : 'badge blue'}>{i.statusLabel}</span>
                      {i.isLate && <span className="badge red">기한 초과</span>}
                      {i.needsApproval && <span className="badge orange">승인 필요</span>}
                      {i.reshipShipmentId && <span className="badge gray">재발송</span>}
                    </span>
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
