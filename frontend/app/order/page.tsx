'use client';

/* 고객 주문서 (S-19) — 카톡 채널 "주문하기" 링크로 열림, 로그인 없음
   저장은 서버가 경로 카톡 · 고객 작성 · 확인필요로 고정 (R-15) */

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, errInfo, fmtDate } from '@/lib/api';

type P = { id: number; label: string; price: number; status: 'ok' | 'few' | 'soldout' | 'preorder'; saleStartDate: string };
type Line = { productId: string; qtyBoxes: number };
type Ship = { recipientName: string; recipientPhone: string; address: string; lines: Line[] };

const STATUS_TEXT: Record<P['status'], string> = { ok: '', few: ' · 얼마 안 남음', soldout: ' · 품절', preorder: '' };
const won = (n: number) => n.toLocaleString('ko-KR') + '원';
const emptyShip = (): Ship => ({ recipientName: '', recipientPhone: '', address: '', lines: [{ productId: '', qtyBoxes: 1 }] });

export default function CustomerOrderPage() {
  return (
    <Suspense fallback={null}>
      <CustomerOrder />
    </Suspense>
  );
}

function CustomerOrder() {
  const preview = useSearchParams().get('preview') === '1'; // 정우 씨 화면의 미리보기: 저장하지 않음
  const [form, setForm] = useState<{ products: P[]; bankAccount: string; cutoff: string } | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [sender, setSender] = useState('');
  const [memo, setMemo] = useState('');
  const [ships, setShips] = useState<Ship[]>([emptyShip()]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);

  useEffect(() => {
    api('/public/order-form').then(setForm).catch(() => setErr('주문서를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'));
  }, []);

  const products = form?.products || [];
  const price = (id: string) => products.find((p) => String(p.id) === id)?.price || 0;
  const total = ships.reduce((a, s) => a + s.lines.reduce((b, l) => b + price(l.productId) * l.qtyBoxes, 0), 0);
  const upd = (i: number, patch: Partial<Ship>) => setShips(ships.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const updLine = (i: number, j: number, patch: Partial<Line>) =>
    upd(i, { lines: ships[i].lines.map((l, k) => (k === j ? { ...l, ...patch } : l)) });

  async function submit() {
    setErr('');
    const digits = phone.replace(/\D/g, '');
    if (!name.trim()) return setErr('주문하시는 분 이름을 적어 주세요.');
    if (!/^0\d{9,10}$/.test(digits)) return setErr('전화번호를 정확히 적어 주세요. (예: 010-1234-5678)');
    for (const [i, s] of ships.entries()) {
      if (!s.address.trim()) return setErr(`받는 곳 ${i + 1}의 주소를 적어 주세요.`);
      if (s.lines.some((l) => !l.productId)) return setErr(`받는 곳 ${i + 1}의 상품을 골라 주세요.`);
    }
    if (preview) {
      // 미리보기: 서버에 저장하지 않고 완료 화면만 보여 줌
      const ds = ships.flatMap((x) => x.lines.map((l) => products.find((p) => String(p.id) === l.productId)));
      setDone({ totalAmount: total, isReservation: ds.some((p) => p?.status === 'preorder'), shipDates: [], bankAccount: form?.bankAccount, preview: true });
      return;
    }
    setBusy(true);
    try {
      const r = await api('/public/orders', {
        body: {
          ordererName: name.trim(),
          ordererPhone: phone,
          senderName: sender.trim() || null,
          memo: memo.trim() || null,
          shipments: ships.map((s) => ({
            recipientName: s.recipientName.trim() || name.trim(),
            recipientPhone: s.recipientPhone || (s.recipientName.trim() ? '' : phone),
            address: s.address.trim(),
            items: s.lines.map((l) => ({ productId: Number(l.productId), qtyBoxes: l.qtyBoxes })),
          })),
        },
      });
      setDone(r);
    } catch (e) {
      setErr(errInfo(e).message);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="cust">
        <div className="cust-card" style={{ textAlign: 'center' }}>
          <div className="cust-check" aria-hidden="true">✓</div>
          <h1>주문이 접수됐어요</h1>
          <p>
            합계 <strong>{won(done.totalAmount)}</strong>
            <br />
            {done.isReservation ? '예약 주문이에요. 판매 시작 후 ' : '입금 확인 후 '}
            <strong>{done.preview ? '(발송 예정일)' : (done.shipDates || []).map(fmtDate).join(', ')}</strong> 발송 예정이에요.
          </p>
          <div className="cust-bank">입금 계좌: {done.bankAccount}</div>
          <p className="muted small">농원에서 주문 내용을 확인한 뒤 카톡으로 연락드릴게요.</p>
          {done.preview && <div className="alert info">미리보기라서 실제로 저장되지 않았어요.</div>}
          <button className="btn secondary" onClick={() => { setDone(null); setShips([emptyShip()]); setMemo(''); }}>
            주문 하나 더 하기
          </button>
        </div>
      </div>
    );

  return (
    <div className="cust">
      {preview && <div className="alert info" style={{ marginTop: 0 }}>미리보기 — 주문이 저장되지 않아요</div>}
      <div className="cust-head">
        <span className="brand-mark" aria-hidden="true" />
        <strong>햇살농원</strong> 주문서
      </div>
      <p className="muted small" style={{ margin: '0 0 12px' }}>
        오후 {form?.cutoff || '15:00'} 전 주문은 그날, 이후 주문은 다음 발송일에 보내 드려요. 발송은 월~목만 해요.
      </p>

      <div className="cust-card">
        <label className="field">
          주문하시는 분 *
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="김순자" />
        </label>
        <label className="field">
          전화번호 *
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-1234-5678" inputMode="tel" />
        </label>
      </div>

      {ships.map((s, i) => (
        <div className="cust-card" key={i}>
          <div className="spread">
            <strong>받는 곳 {ships.length > 1 ? i + 1 : ''}</strong>
            {ships.length > 1 && (
              <button className="btn small ghost" onClick={() => setShips(ships.filter((_, k) => k !== i))}>
                삭제
              </button>
            )}
          </div>
          <label className="field">
            받는 분 (비우면 주문하신 분)
            <input value={s.recipientName} onChange={(e) => upd(i, { recipientName: e.target.value })} placeholder="박영자" />
          </label>
          <label className="field">
            받는 분 전화번호
            <input value={s.recipientPhone} onChange={(e) => upd(i, { recipientPhone: e.target.value })} placeholder="010-0000-0000" inputMode="tel" />
          </label>
          <label className="field">
            주소 *
            <input value={s.address} onChange={(e) => upd(i, { address: e.target.value })} placeholder="경기도 수원시 팔달로 12, 301호" />
          </label>
          {s.lines.map((l, j) => (
            <div key={j} className="cust-line">
              <select value={l.productId} onChange={(e) => updLine(i, j, { productId: e.target.value })}>
                <option value="">상품 고르기</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.status === 'soldout'}>
                    {p.label} · {won(p.price)}
                    {STATUS_TEXT[p.status]}
                    {p.status === 'preorder' ? ` · ${fmtDate(p.saleStartDate)}부터 (예약)` : ''}
                  </option>
                ))}
              </select>
              <div className="cust-qty">
                <button className="btn secondary small" onClick={() => updLine(i, j, { qtyBoxes: Math.max(1, l.qtyBoxes - 1) })}>−</button>
                <span>{l.qtyBoxes}</span>
                <button className="btn secondary small" onClick={() => updLine(i, j, { qtyBoxes: Math.min(50, l.qtyBoxes + 1) })}>+</button>
                <span className="muted small">박스</span>
                {s.lines.length > 1 && (
                  <button className="btn small ghost" onClick={() => upd(i, { lines: s.lines.filter((_, k) => k !== j) })}>빼기</button>
                )}
              </div>
            </div>
          ))}
          <button className="btn small ghost" onClick={() => upd(i, { lines: [...s.lines, { productId: '', qtyBoxes: 1 }] })}>
            + 상품 추가
          </button>
        </div>
      ))}
      <button className="btn secondary" style={{ width: '100%', marginBottom: 12 }} onClick={() => setShips([...ships, emptyShip()])}>
        + 받는 곳 추가 (선물 여러 곳)
      </button>

      <div className="cust-card">
        <label className="field">
          보내는 사람 (비우면 주문하신 분)
          <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder={name || '김순자'} />
        </label>
        <label className="field">
          남기실 말
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="경비실에 맡겨 주세요" style={{ minHeight: 60 }} />
        </label>
      </div>

      {err && <div className="alert error">{err}</div>}
      <div className="cust-total">
        <span>합계</span>
        <strong>{won(total)}</strong>
      </div>
      <p className="muted small">결제: 계좌이체 (입금 확인 후 발송)</p>
      <button className="btn big" style={{ width: '100%' }} disabled={busy} onClick={submit}>
        {busy ? '보내는 중…' : '주문 보내기'}
      </button>
    </div>
  );
}
