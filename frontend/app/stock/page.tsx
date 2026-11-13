'use client';

import { useEffect, useState } from 'react';
import { api, fmtDate, getUser } from '@/lib/api';
import { ErrorBox, Loading } from '@/components/ui';

function NumCell({ value, onSave, step = 1, placeholder }: { value: any; onSave: (v: string) => Promise<void>; step?: number; placeholder?: string }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const changed = String(v) !== String(value ?? '');
  return (
    <span className="row" style={{ flexWrap: 'nowrap' }}>
      <input type="number" step={step} style={{ width: 90 }} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} />
      {changed && (
        <button className="btn small" onClick={() => onSave(String(v))}>
          저장
        </button>
      )}
    </span>
  );
}

export default function StockPage() {
  const [products, setProducts] = useState<any[] | null>(null);
  const [varieties, setVarieties] = useState<any[]>([]);
  const [error, setError] = useState<any>(null);
  const [notice, setNotice] = useState('');
  const isAdmin = getUser()?.role === 'admin';

  const load = () =>
    Promise.all([api('/products'), api('/varieties')])
      .then(([p, v]) => {
        setProducts(p);
        setVarieties(v);
      })
      .catch(setError);
  useEffect(() => {
    load();
  }, []);

  async function save(fn: () => Promise<any>, msg: string) {
    setError(null);
    setNotice('');
    try {
      await fn();
      setNotice(msg);
      await load();
    } catch (e) {
      setError(e);
    }
  }

  if (!products) return error ? <ErrorBox error={error} /> : <Loading />;

  return (
    <>
      <h1>상품·재고</h1>
      <p className="muted small">
        판매 한도 = 예상 수확량 × 안전 비율 (실제 수확량을 넣으면 실제 수확량이 한도가 됩니다). 남은 수량 = 판매 한도 − (예약 + 주문 + 재발송). 남은 수량을 넘는 주문은 서버가 받지 않습니다. 단위: 박스
      </p>
      <ErrorBox error={error} />
      {notice && <div className="alert ok">{notice}</div>}

      <h2>판매 시작일</h2>
      <div className="row">
        {varieties.map((v) => (
          <div key={v.id} className="card" style={{ marginBottom: 0 }}>
            <div>
              <strong>
                {v.crop} · {v.name}
              </strong>
            </div>
            <input
              type="date"
              defaultValue={v.saleStartDate}
              onChange={(e) => e.target.value && save(() => api(`/varieties/${v.id}`, { method: 'PATCH', body: { saleStartDate: e.target.value } }), `${v.name} 판매 시작일을 ${fmtDate(e.target.value)}로 바꿨습니다`)}
            />
            <div className="muted small">이 날 전 주문은 예약</div>
          </div>
        ))}
      </div>

      <h2>상품별 수량</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>상품</th>
              <th>예상 수확량</th>
              <th>안전 비율</th>
              <th>실제 수확량</th>
              <th>판매 한도</th>
              <th>예약</th>
              <th>주문</th>
              <th>재발송</th>
              <th>남은 수량</th>
              {isAdmin && <th>금요일 발송</th>}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} style={p.active ? undefined : { opacity: 0.5 }}>
                <td>
                  <strong>{p.label}</strong>
                  <div className="muted small">
                    {p.price?.toLocaleString()}원 · 판매 시작 {fmtDate(p.variety?.saleStartDate)}
                    {!p.active && ' · 판매 중지'}
                  </div>
                </td>
                <td>
                  <NumCell value={p.expectedHarvestBoxes} onSave={(v) => save(() => api(`/products/${p.id}/stock`, { method: 'PATCH', body: { expectedHarvestBoxes: Number(v) } }), `${p.label} 예상 수확량 저장`)} />
                </td>
                <td>
                  <NumCell value={p.safetyRatio} step={0.05} onSave={(v) => save(() => api(`/products/${p.id}/stock`, { method: 'PATCH', body: { safetyRatio: Number(v) } }), `${p.label} 안전 비율 저장`)} />
                  <div className="muted small">{Math.round(p.safetyRatio * 100)}%</div>
                </td>
                <td>
                  <NumCell
                    value={p.actualHarvestBoxes}
                    placeholder="미입력"
                    onSave={(v) => save(() => api(`/products/${p.id}/stock`, { method: 'PATCH', body: { actualHarvestBoxes: v === '' ? null : Number(v) } }), `${p.label} 실제 수확량 저장`)}
                  />
                </td>
                <td>
                  <strong>{p.saleLimit}</strong>
                </td>
                <td>{p.reserved}</td>
                <td>{p.ordered}</td>
                <td>{p.reshipped}</td>
                <td>
                  {p.remaining < 0 ? (
                    <span className="badge red" style={{ fontSize: 14 }}>
                      초과 {-p.remaining}박스 — 고객 연락 필요
                    </span>
                  ) : (
                    <strong style={{ fontSize: 18, color: p.remaining <= 3 ? 'var(--orange)' : undefined }}>{p.remaining}</strong>
                  )}
                </td>
                {isAdmin && (
                  <td>
                    <label>
                      <input
                        type="checkbox"
                        checked={p.allowFriday}
                        onChange={(e) => save(() => api(`/products/${p.id}`, { method: 'PATCH', body: { allowFriday: e.target.checked } }), `${p.label} 금요일 발송 ${e.target.checked ? '허용' : '안 함'}`)}
                      />{' '}
                      허용
                    </label>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
