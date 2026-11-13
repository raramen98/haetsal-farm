'use client';

import { useEffect, useState } from 'react';
import { api, fmtPhone } from '@/lib/api';
import { ErrorBox } from '@/components/ui';

// 자주 쓰는 사유 (누르면 사유 칸에 채움)
const REASONS: Record<string, string[]> = {
  delay: [
    '비가 많이 와서 수확이 며칠 밀렸어요',
    '태풍 때문에 수확이 늦어졌어요',
    '서리·냉해로 수확이 늦어졌어요',
    '명절 주문이 많아 발송이 밀렸어요',
    '택배사 사정으로 발송이 늦어졌어요',
  ],
  harvest: ['올해 첫 수확을 시작했어요', '날씨가 좋아 당도가 높아요', '예약 주문부터 순서대로 보내 드려요'],
};

export default function NoticePage() {
  const [varieties, setVarieties] = useState<any[]>([]);
  const [f, setF] = useState({ varietyId: '', kind: 'harvest', reason: '', newDate: '' });
  const [res, setRes] = useState<any>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/varieties').then(setVarieties).catch(setError);
  }, []);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const r = await api('/ai/notice-draft', { body: { ...f, varietyId: Number(f.varietyId) } });
      setRes(r);
      setDraft(r.draft || '');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>수확·지연 안내 문자 초안</h1>
      <p className="muted small">초안만 만듭니다. 실제 문자는 보내지 않습니다.</p>
      <div className="card">
        <div className="fields">
          <label className="field">
            품종
            <select value={f.varietyId} onChange={(e) => setF({ ...f, varietyId: e.target.value })}>
              <option value="">선택</option>
              {varieties.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.crop} · {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            안내 종류
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="harvest">수확 시작</option>
              <option value="delay">수확·발송 지연</option>
            </select>
          </label>
          <label className="field">
            새 발송 예정일
            <input type="date" value={f.newDate} onChange={(e) => setF({ ...f, newDate: e.target.value })} />
          </label>
          <label className="field">
            사유
            <input value={f.reason} placeholder="예: 서리로 수확이 늦어짐" onChange={(e) => setF({ ...f, reason: e.target.value })} />
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <span className="muted small">자주 쓰는 사유</span>
          <div className="chips">
            {REASONS[f.kind].map((r) => (
              <button key={r} type="button" className={`chip ${f.reason === r ? 'on' : ''}`} onClick={() => setF({ ...f, reason: r })}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <button className="btn" style={{ marginTop: 6 }} disabled={!f.varietyId || busy} onClick={make}>
          {busy ? '만드는 중…' : '초안 만들기'}
        </button>
      </div>
      <ErrorBox error={error} />
      {res && (
        <div className="grid2">
          <div className="card">
            <h3>대상 {res.targets.length}명 (아직 발송 안 된 주문)</h3>
            <ul>
              {res.targets.map((t: any) => (
                <li key={t.orderId}>
                  #{t.orderId} {t.name} {fmtPhone(t.phone)}
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h3>문자 초안</h3>
            {res.message && <div className="alert warn">{res.message}</div>}
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button className="btn secondary" onClick={() => navigator.clipboard?.writeText(draft)}>
              복사
            </button>
          </div>
        </div>
      )}
    </>
  );
}
