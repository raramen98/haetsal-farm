'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ErrorBox } from '@/components/ui';

const RESULT: Record<string, [string, string]> = {
  new: ['등록 예정', 'badge blue'],
  created: ['등록됨', 'badge green'],
  skipped: ['이미 등록', 'badge gray'],
  error: ['오류', 'badge red'],
};

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      setRes(await api('/imports/smartstore' + (dryRun ? '?dryRun=true' : ''), { body: fd }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>스마트스토어 엑셀 업로드</h1>
      <div className="card">
        <p className="muted">스마트스토어에서 내려받은 주문 엑셀(.xlsx)을 올리면 먼저 미리 보기를 보여 줍니다. 같은 주문번호는 다시 등록하지 않습니다.</p>
        <div className="row">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setRes(null);
            }}
          />
          <button className="btn secondary" disabled={!file || busy} onClick={() => send(true)}>
            미리 보기
          </button>
          <button className="btn" disabled={!file || busy || !res?.dryRun || !res.summary.new} onClick={() => send(false)}>
            등록하기
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      {busy && <p className="muted">처리 중…</p>}
      {res && (
        <>
          <div className={`alert ${res.dryRun ? 'info' : 'ok'}`}>
            {res.dryRun ? '미리 보기' : '등록 결과'} — 전체 {res.summary.total}건 ·{' '}
            {res.dryRun ? `등록 예정 ${res.summary.new}` : `등록 ${res.summary.created}`} · 건너뜀 {res.summary.skipped} · 오류 {res.summary.error}
            {res.dryRun && res.summary.new > 0 && ' — 확인했으면 "등록하기"를 누르세요'}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>엑셀 행</th>
                  <th>주문번호</th>
                  <th>주문자</th>
                  <th>품목</th>
                  <th>배송지</th>
                  <th>판정</th>
                  <th>내용</th>
                </tr>
              </thead>
              <tbody>
                {res.results.map((r: any) => (
                  <tr key={r.orderNo}>
                    <td>{r.rows?.join(', ')}</td>
                    <td>{r.orderId ? <Link href={`/orders/${r.orderId}`}>{r.orderNo}</Link> : r.orderNo}</td>
                    <td>{r.ordererName}</td>
                    <td>{r.items}</td>
                    <td>{r.shipments ? `${r.shipments}곳` : ''}</td>
                    <td>
                      <span className={RESULT[r.result]?.[1]}>{RESULT[r.result]?.[0] || r.result}</span>
                    </td>
                    <td className="small">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
