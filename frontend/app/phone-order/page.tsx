'use client';

import { useEffect, useState } from 'react';
import { api, fmtDate, fmtPhone, getUser } from '@/lib/api';
import { ErrorBox } from '@/components/ui';

interface Line {
  productId: number | '';
  qtyBoxes: number;
}

export default function PhoneOrderPage() {
  const [phone, setPhone] = useState('');
  const [lookup, setLookup] = useState<any>(null);
  const [name, setName] = useState('');
  const [addrIdx, setAddrIdx] = useState<number | 'new' | null>(null);
  const [recipient, setRecipient] = useState({ recipientName: '', recipientPhone: '', address: '' });
  const [lines, setLines] = useState<Line[]>([{ productId: '', qtyBoxes: 1 }]);
  const [memo, setMemo] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [error, setError] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/products').then(setProducts).catch(setError);
  }, []);

  async function find() {
    setError(null);
    setLookup(null);
    setAddrIdx(null);
    try {
      const r = await api('/customers/lookup?phone=' + encodeURIComponent(phone));
      setLookup(r);
      const c = r.customers?.[0];
      if (c) setName(c.displayName);
      if (!c || !c.addresses.length) setAddrIdx('new');
    } catch (e) {
      setError(e);
    }
  }

  const addresses: any[] = lookup?.customers?.flatMap((c: any) => c.addresses) || [];

  function pickAddr(i: number | 'new') {
    setAddrIdx(i);
    if (i === 'new') setRecipient({ recipientName: name, recipientPhone: '', address: '' });
    else setRecipient({ recipientName: addresses[i].recipientName, recipientPhone: fmtPhone(addresses[i].recipientPhone), address: addresses[i].address });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api('/orders/phone', {
        body: {
          channel: 'phone',
          ordererName: name,
          ordererPhone: phone || null,
          senderName: name,
          paymentMethod: 'cash',
          rawText: memo ? `[전화 메모] ${memo}` : null,
          shipments: [
            {
              recipientName: recipient.recipientName || name,
              recipientPhone: recipient.recipientPhone || null,
              address: recipient.address,
              memo: memo || null,
              items: lines.map((l) => ({ productId: Number(l.productId), qtyBoxes: Number(l.qtyBoxes) })),
            },
          ],
        },
      });
      setDone(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPhone('');
    setLookup(null);
    setName('');
    setAddrIdx(null);
    setRecipient({ recipientName: '', recipientPhone: '', address: '' });
    setLines([{ productId: '', qtyBoxes: 1 }]);
    setMemo('');
    setDone(null);
    setError(null);
    api('/products').then(setProducts).catch(() => {});
  }

  if (done)
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <h1>저장했어요</h1>
        <p style={{ fontSize: 22 }}>{done.status === 'needs_check' ? '정우 씨가 확인하면 접수됩니다.' : '바로 접수됐어요.'}</p>
        <p className="muted">발송 예정: {(done.shipDates || []).map(fmtDate).join(', ')}</p>
        <button className="btn big" onClick={reset}>
          다른 전화 주문 받기
        </button>
      </div>
    );

  const canSave = name.trim() && recipient.address.trim() && lines.every((l) => l.productId && l.qtyBoxes > 0);

  return (
    <div className="big-ui">
      <h1>전화 주문 입력</h1>

      <div className="step">① 전화번호</div>
      <div className="row">
        <input inputMode="tel" placeholder="010-1234-5678" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()} style={{ fontSize: 26, width: 300 }} />
        <button className="btn big" onClick={find} disabled={phone.replace(/\D/g, '').length < 10}>
          찾기
        </button>
      </div>
      <ErrorBox error={error} />

      {lookup && (
        <>
          {lookup.customers.length > 0 ? (
            <p style={{ fontSize: 22 }}>
              <strong>{lookup.customers[0].displayName}</strong> 님 — 전에 주문하신 분이에요
            </p>
          ) : (
            <p style={{ fontSize: 22 }}>처음 주문하시는 분이에요</p>
          )}
          <label className="field" style={{ fontSize: 18 }}>
            주문하신 분 이름
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <div className="step">② 어디로 보낼까요?</div>
          {addresses.map((a, i) => (
            <button key={i} className={`big-choice ${addrIdx === i ? 'on' : ''}`} onClick={() => pickAddr(i)}>
              <strong>{a.recipientName}</strong> · {a.address}
            </button>
          ))}
          <button className={`big-choice ${addrIdx === 'new' ? 'on' : ''}`} onClick={() => pickAddr('new')}>
            + 새 주소로 보내기
          </button>
          {addrIdx !== null && (
            <div className="fields" style={{ marginTop: 10 }}>
              <label className="field">
                받는 분
                <input value={recipient.recipientName} onChange={(e) => setRecipient({ ...recipient, recipientName: e.target.value })} />
              </label>
              <label className="field">
                받는 분 번호
                <input value={recipient.recipientPhone} onChange={(e) => setRecipient({ ...recipient, recipientPhone: e.target.value })} />
              </label>
              <label className="field" style={{ gridColumn: '1 / -1' }}>
                주소
                <input value={recipient.address} onChange={(e) => setRecipient({ ...recipient, address: e.target.value })} />
              </label>
            </div>
          )}

          <div className="step">③ 무엇을 몇 박스?</div>
          {lines.map((l, i) => {
            const p = products.find((x) => x.id === Number(l.productId));
            return (
              <div key={i} className="row" style={{ margin: '8px 0' }}>
                <select value={l.productId} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, productId: e.target.value ? Number(e.target.value) : '' } : x)))}>
                  <option value="">상품 고르기</option>
                  {products
                    .filter((x) => x.active)
                    .map((x) => (
                      <option key={x.id} value={x.id} disabled={x.remaining <= 0}>
                        {x.label} (남은 {Math.max(x.remaining, 0)}박스)
                      </option>
                    ))}
                </select>
                <button className="btn" onClick={() => setLines(lines.map((x, k) => (k === i ? { ...x, qtyBoxes: Math.max(1, x.qtyBoxes - 1) } : x)))}>
                  −
                </button>
                <span style={{ fontSize: 26, fontWeight: 800, minWidth: 40, textAlign: 'center' }}>{l.qtyBoxes}</span>
                <button className="btn" onClick={() => setLines(lines.map((x, k) => (k === i ? { ...x, qtyBoxes: x.qtyBoxes + 1 } : x)))}>
                  +
                </button>
                박스
                {p && l.qtyBoxes > p.remaining && <span className="badge red" style={{ fontSize: 16 }}>남은 {Math.max(p.remaining, 0)}박스뿐이에요</span>}
                {lines.length > 1 && (
                  <button className="btn ghost" onClick={() => setLines(lines.filter((_, k) => k !== i))}>
                    빼기
                  </button>
                )}
              </div>
            );
          })}
          <button className="btn secondary" onClick={() => setLines([...lines, { productId: '', qtyBoxes: 1 }])}>
            + 다른 상품 추가
          </button>

          <div className="step">④ 메모</div>
          <textarea value={memo} placeholder="예: 입금은 내일, 경비실에 맡겨 달라고 함" onChange={(e) => setMemo(e.target.value)} />

          <ErrorBox error={error} />
          <button className="btn big" style={{ width: '100%', marginTop: 16 }} disabled={!canSave || busy} onClick={save}>
            {busy ? '저장 중…' : '저장하기'}
          </button>
          <p className="muted">{getUser()?.role === 'admin' ? '저장하면 바로 접수됩니다.' : '저장하면 “확인필요”로 들어가고, 정우 씨가 확인한 뒤 접수됩니다.'}</p>
        </>
      )}
    </div>
  );
}
