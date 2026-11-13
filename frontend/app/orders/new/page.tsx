'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, fmtDateTime, fmtPhone } from '@/lib/api';
import OrderForm, { emptyOrder, emptyShipment, OrderFormValue, toBody, useProducts } from '@/components/OrderForm';
import { ErrorBox, Loading } from '@/components/ui';

function draftToForm(d: any, base: OrderFormValue): OrderFormValue {
  return {
    ...base,
    channel: d.channel === 'phone' ? 'phone' : base.channel,
    ordererName: d.ordererName || '',
    ordererPhone: fmtPhone(d.ordererPhone) || '',
    senderName: d.senderName || d.ordererName || '',
    senderTouched: !!d.senderName && d.senderName !== d.ordererName,
    paymentMethod: d.paymentMethod || base.paymentMethod,
    rawText: d.rawText ?? base.rawText,
    customerId: d.customerId ?? null,
    source: d.source === 'reorder' ? 'reorder' : null,
    shipments: (d.shipments?.length ? d.shipments : [emptyShipment(d.ordererName)]).map((s: any) => ({
      recipientName: s.recipientName || '',
      recipientPhone: fmtPhone(s.recipientPhone) || '',
      address: s.address || '',
      addressConfirmed: d.source === 'reorder' ? false : true,
      items: (s.items?.length ? s.items : [{ productId: '', qtyBoxes: 1 }]).map((i: any) => ({
        productId: i.productId ?? '',
        qtyBoxes: i.qtyBoxes ?? '',
        rawText: i.rawText,
      })),
    })),
  };
}

function NewOrderInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const reorderId = sp.get('reorder');
  const { products } = useProducts();
  const [form, setForm] = useState<OrderFormValue>(emptyOrder());
  const [error, setError] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<any>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function loadReorder(id: string | number) {
    setError(null);
    try {
      const d = await api(`/orders/reorder/${id}`, { method: 'POST' });
      setForm((f) => draftToForm({ ...d, rawText: f.rawText, channel: f.channel }, f));
      setWarnings(d.warnings || []);
    } catch (e) {
      setError(e);
    }
  }

  useEffect(() => {
    if (reorderId) loadReorder(reorderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reorderId]);

  async function parseKakao() {
    setAiBusy(true);
    setError(null);
    setAi(null);
    try {
      const r = await api('/ai/parse-kakao', { body: { text: form.rawText } });
      setAi(r);
      if (r.ok) setForm((f) => draftToForm({ ...r.draft, channel: f.channel, paymentMethod: f.paymentMethod }, f));
    } catch (e) {
      setError(e);
    } finally {
      setAiBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const o = await api('/orders', { body: toBody(form) });
      router.push(`/orders/${o.id}?created=1`);
    } catch (e) {
      setError(e);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>{form.source === 'reorder' ? '다시 넣기 (지난 주문 복사)' : '카톡 주문 직접 입력 (대화로 온 주문)'}</h1>
      <ErrorBox error={error} />
      {warnings.length > 0 && (
        <div className="alert warn">
          <strong>확인할 점</strong>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h3>{form.source === 'reorder' ? '고객 요청 메모 (선택)' : '카톡 원문'}</h3>
        <textarea
          value={form.rawText}
          placeholder="카카오톡 대화를 그대로 붙여 넣으세요. 'AI로 정리'를 누르면 아래 칸을 채워 줍니다 (저장은 사람이 확인한 뒤)."
          onChange={(e) => setForm({ ...form, rawText: e.target.value })}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn secondary" disabled={aiBusy || form.rawText.trim().length < 5} onClick={parseKakao}>
            {aiBusy ? 'AI가 정리하는 중…' : 'AI로 정리'}
          </button>
          <span className="muted small">AI는 초안만 만듭니다. 재고·발송일·고객 묶기는 저장할 때 서버가 확인합니다.</span>
        </div>
        {ai && !ai.ok && <div className="alert error">{ai.message}</div>}
        {ai?.ok && ai.uncertain?.length > 0 && (
          <div className="alert warn">
            <strong>AI가 확실하지 않은 부분 — 직접 확인해 주세요</strong>
            <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
              {ai.uncertain.map((u: string, i: number) => (
                <li key={i}>
                  <label>
                    <input type="checkbox" /> {u}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        {ai?.ok && ai.sameAsLastTime && (
          <div className="alert info">
            “지난번처럼” 주문으로 보입니다.{' '}
            {ai.reorderCandidate ? (
              <>
                지난 주문 #{ai.reorderCandidate.orderId} ({fmtDateTime(ai.reorderCandidate.orderedAt)}){' '}
                <button className="btn small" onClick={() => loadReorder(ai.reorderCandidate.orderId)}>
                  지난 주문 다시 넣기
                </button>
              </>
            ) : (
              '이 번호로 된 지난 주문을 찾지 못했습니다.'
            )}
          </div>
        )}
      </div>

      <div className="card">
        <OrderForm value={form} onChange={setForm} products={products} />
      </div>
      <ErrorBox error={error} />
      <div className="row">
        <button className="btn big" disabled={busy} onClick={submit}>
          {busy ? '저장 중…' : '주문 저장'}
        </button>
        <span className="muted small">남은 수량을 넘으면 서버가 거부합니다.</span>
      </div>
    </>
  );
}

export default function NewOrderPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewOrderInner />
    </Suspense>
  );
}
