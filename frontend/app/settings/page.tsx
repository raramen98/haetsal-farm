'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorBox, Loading } from '@/components/ui';

const LABELS: Record<string, string> = {
  cutoff_time: '주문 마감 시각 (이후 주문은 다음 발송일)',
  ship_weekdays: '발송 요일 (1=월 … 4=목, 쉼표로)',
  duplicate_window_days: '중복 의심 기간 (일)',
  unpaid_warn_days: '입금 지연 표시 (일)',
  incident_deadline_days: '배송 사고 접수 기한 (받은 날 + 일)',
  default_safety_ratio: '기본 안전 비율 (0~1)',
  season_start: '이번 판매 시즌 시작일',
};

export default function SettingsPage() {
  const [s, setS] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<any>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api('/settings').then(setS).catch(setError);
  }, []);

  async function save() {
    setError(null);
    setNotice('');
    try {
      setS(await api('/settings', { method: 'PATCH', body: s }));
      setNotice('저장했습니다');
    } catch (e) {
      setError(e);
    }
  }

  if (!s) return error ? <ErrorBox error={error} /> : <Loading />;
  return (
    <>
      <h1>설정</h1>
      <ErrorBox error={error} />
      {notice && <div className="alert ok">{notice}</div>}
      <div className="card">
        <div className="fields">
          {Object.keys(s).map((k) => (
            <label key={k} className="field">
              {LABELS[k] || k}
              <input value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <button className="btn" style={{ marginTop: 12 }} onClick={save}>
          저장
        </button>
      </div>
    </>
  );
}
