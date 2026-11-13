'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, CHANNEL_LABEL, fmtDate, fmtDateTime, fmtPhone, itemSummary, shipDates, SHIP_STATUS_LABEL, won } from '@/lib/api';
import OrderForm, { OrderFormValue, toBody, useProducts } from '@/components/OrderForm';
import { Badges, ErrorBox, Loading } from '@/components/ui';

function orderToForm(o: any): OrderFormValue {
  return {
    channel: o.channel,
    ordererName: o.ordererName,
    ordererPhone: fmtPhone(o.ordererPhone),
    senderName: o.senderName,
    senderTouched: o.senderName !== o.ordererName,
    paymentMethod: o.paymentMethod,
    rawText: o.rawText || '',
    customerId: o.customerId,
    source: null,
    shipments: o.shipments
      .filter((s: any) => !s.isReship)
      .map((s: any) => ({
        recipientName: s.recipientName,
        recipientPhone: fmtPhone(s.recipientPhone),
        address: s.address,
        addressConfirmed: true,
        memo: s.memo || '',
        items: s.items.map((i: any) => ({ productId: i.productId, qtyBoxes: i.qtyBoxes })),
      })),
  };
}

function OrderBrief({ o, title }: { o: any; title: string }) {
  return (
    <div className="card">
      <h3>
        {title} <Link href={`/orders/${o.id}`}>#{o.id}</Link>
      </h3>
      <div>
        {CHANNEL_LABEL[o.channel]} · {fmtDateTime(o.orderedAt)}
      </div>
      <div>
        <strong>{o.ordererName}</strong> {fmtPhone(o.ordererPhone)}
      </div>
      <div>{itemSummary(o)}</div>
      <div className="muted small">
        배송지: {o.shipments.filter((s: any) => !s.isReship).map((s: any) => `${s.recipientName} (${s.address})`).join(' / ')}
      </div>
      <div className="muted small">발송 예정 {shipDates(o)}</div>
      <Badges list={o.badges} />
    </div>
  );
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [o, setO] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [notice, setNotice] = useState<string>('');
  const [phone, setPhone] = useState('');
  const [depositor, setDepositor] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<OrderFormValue | null>(null);
  const { products, reload: reloadProducts } = useProducts();

  const load = () => api(`/orders/${id}`).then((d) => { setO(d); setDepositor((x) => x || d.ordererName); }).catch(setError);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(fn: () => Promise<any>, okMsg: string) {
    setError(null);
    setNotice('');
    try {
      const r = await fn();
      if (r && r.id) setO(r);
      else await load();
      let msg = okMsg;
      if (r?.depositorNameMismatch) msg += ' — 입금자 이름이 주문자와 다릅니다 (표시만, 확인해 두세요)';
      setNotice(msg);
      reloadProducts();
    } catch (e) {
      setError(e);
    }
  }

  if (error && !o) return <ErrorBox error={error} />;
  if (!o) return <Loading />;

  const cancelled = o.status === 'cancelled';
  return (
    <>
      <div className="spread">
        <h1>
          주문 #{o.id} <Badges list={o.badges} />
        </h1>
        <div className="row">
          <Link className="btn ghost" href="/orders">목록</Link>
          {o.customerId && <Link className="btn ghost" href={`/customers/${o.customerId}`}>고객 보기</Link>}
          <Link className="btn secondary" href={`/orders/new?reorder=${o.id}`}>다시 넣기</Link>
        </div>
      </div>
      <ErrorBox error={error} />
      {notice && <div className="alert ok">{notice}</div>}

      {o.blockReasons?.length > 0 && !cancelled && (
        <div className="alert error">
          <strong>지금은 발송할 수 없습니다:</strong> {o.blockReasons.join(' · ')}
        </div>
      )}

      {/* 중복 의심 처리 */}
      {o.duplicateStatus === 'suspect' && o.duplicateOf && !cancelled && (
        <div className="card warn">
          <h2 style={{ marginTop: 0 }}>중복 의심 — 같은 고객이 다른 경로로 같은 품목을 3일 안에 주문했습니다</h2>
          <p>
            <strong>자동 취소하지 않습니다 — 고객에게 확인한 뒤 선택하세요.</strong> 처리 전에는 발송 목록에서 주황색으로 표시됩니다.
            <br />
            <span className="small">같은 주문을 두 번 넣은 거면 <strong>한 건으로 합치기</strong>(남길 주문을 고르면 다른 한 건이 취소되고 재고가 돌아와요). 따로 보내는 주문이면 <strong>둘 다 유지</strong>.</span>
          </p>
          <div className="grid2">
            <OrderBrief o={o} title="이 주문" />
            <OrderBrief o={o.duplicateOf} title="상대 주문" />
          </div>
          <div className="row">
            <button className="btn" onClick={() => act(() => api(`/orders/${o.id}/duplicate`, { body: { action: 'keep' } }), '둘 다 유지했습니다')}>
              둘 다 유지 (따로 보냄)
            </button>
            <button
              className="btn danger"
              onClick={() => confirm(`이 주문 #${o.id}을 취소하고 상대 주문만 남길까요?`) && act(() => api(`/orders/${o.id}/duplicate`, { body: { action: 'merge', cancelId: o.id } }), `#${o.id}을 취소했습니다`)}
            >
              합치기 — 상대 주문(#{o.duplicateOf.id})만 남기기
            </button>
            <button
              className="btn danger"
              onClick={() =>
                confirm(`상대 주문 #${o.duplicateOf.id}을 취소하고 이 주문만 남길까요?`) &&
                act(() => api(`/orders/${o.id}/duplicate`, { body: { action: 'merge', cancelId: o.duplicateOf.id } }), `#${o.duplicateOf.id}을 취소했습니다`)
              }
            >
              합치기 — 이 주문(#{o.id})만 남기기
            </button>
          </div>
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <h3>주문 정보</h3>
          <table>
            <tbody>
              <tr><th>경로</th><td>{CHANNEL_LABEL[o.channel]} {o.externalOrderNo && <span className="muted">({o.externalOrderNo})</span>}</td></tr>
              <tr><th>주문 시각</th><td>{fmtDateTime(o.orderedAt)}</td></tr>
              <tr><th>주문자</th><td><strong>{o.ordererName}</strong> {fmtPhone(o.ordererPhone) || <span className="badge red">번호 없음</span>} {o.nameMismatch && <span className="badge gray">이름 다름 (고객: {o.customer?.displayName})</span>}</td></tr>
              <tr><th>보내는 사람</th><td>{o.senderName}</td></tr>
              <tr><th>결제</th><td>{o.paymentMethod === 'cash' ? '현금(계좌이체)' : '선결제'} · {o.paymentStatus === 'paid' ? `입금 확인${o.depositorName ? ` (입금자 ${o.depositorName})` : ''}` : '입금대기'} · {won(o.totalAmount)}</td></tr>
              <tr><th>상태</th><td>{cancelled ? '취소' : o.status === 'needs_check' ? '확인필요' : '접수'}{o.isReservation && ' · 예약'}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>처리</h3>
          {cancelled ? (
            <p className="muted">취소된 주문입니다.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {o.status === 'needs_check' && (
                <div className="row">
                  <button className="btn" onClick={() => act(() => api(`/orders/${o.id}/confirm`, { method: 'POST' }), '주문을 확정(접수)했습니다')}>
                    내용 확인 완료 → 접수
                  </button>
                  <span className="muted small">
                    어머니가 받은 전화 주문, 고객이 주문서로 넣은 주문은 <b>확인필요</b>로 들어와요. 주소·수량·금액을 확인하고 누르면 접수되어 발송 목록에 올라가요.
                  </span>
                </div>
              )}
              {!o.ordererPhone && (
                <div className="row">
                  <input placeholder="주문자 번호 010-…" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  <button className="btn" disabled={!phone} onClick={() => act(() => api(`/orders/${o.id}/phone`, { method: 'PATCH', body: { phone } }), '번호를 입력했습니다')}>
                    번호 입력
                  </button>
                </div>
              )}
              {o.paymentStatus === 'pending' && (
                <div className="row">
                  <input placeholder="입금자명" value={depositor} onChange={(e) => setDepositor(e.target.value)} />
                  <button className="btn" disabled={!depositor} onClick={() => act(() => api(`/orders/${o.id}/payment`, { body: { depositorName: depositor } }), '입금 확인했습니다')}>
                    입금 확인
                  </button>
                </div>
              )}
              <div className="row">
                <button
                  className="btn secondary"
                  onClick={() => {
                    setForm(orderToForm(o));
                    setEditing(true);
                  }}
                >
                  수정
                </button>
                <button className="btn danger" onClick={() => confirm('이 주문을 취소할까요? (재고가 다시 돌아옵니다)') && act(() => api(`/orders/${o.id}/cancel`, { method: 'POST' }), '주문을 취소했습니다')}>
                  주문 취소
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {editing && form ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>주문 수정</h2>
          <OrderForm value={form} onChange={setForm} products={products} showChannel={false} />
          <ErrorBox error={error} />
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn"
              onClick={() =>
                act(async () => {
                  const r = await api(`/orders/${o.id}`, { method: 'PATCH', body: toBody(form) });
                  setEditing(false);
                  return r;
                }, '수정했습니다')
              }
            >
              수정 저장
            </button>
            <button className="btn ghost" onClick={() => setEditing(false)}>
              닫기
            </button>
          </div>
        </div>
      ) : (
        <>
          <h2>배송지 {o.shipments.length}곳</h2>
          {o.shipments.map((s: any) => (
            <div className="card" key={s.id}>
              <div className="spread">
                <strong>
                  {s.recipientName} {fmtPhone(s.recipientPhone)} {s.isReship && <span className="badge orange">재발송</span>}
                </strong>
                <span>
                  발송 예정 <strong>{fmtDate(s.shipDate)}</strong> · <span className={s.status === 'pending' ? 'badge gray' : 'badge green'}>{SHIP_STATUS_LABEL[s.status]}</span>
                </span>
              </div>
              <div>{s.address}</div>
              <ul>
                {s.items.map((i: any) => (
                  <li key={i.id}>
                    {i.label} × {i.qtyBoxes}박스 {i.product?.grade === 'gift' && <span className="badge blue">선물용 · 보자기</span>}
                  </li>
                ))}
              </ul>
              {s.memo && <div className="muted small">메모: {s.memo}</div>}
            </div>
          ))}
        </>
      )}

      {o.rawText && (
        <div className="card">
          <h3>원문 메모 (카톡 원문 · 전화 메모 · 고객 메모)</h3>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>{o.rawText}</pre>
        </div>
      )}
    </>
  );
}
