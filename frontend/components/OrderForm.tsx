'use client';

import { useEffect, useState } from 'react';
import { api, fmtPhone } from '@/lib/api';

export interface ItemForm {
  productId: number | '';
  qtyBoxes: number | '';
  rawText?: string;
}
export interface ShipForm {
  recipientName: string;
  recipientPhone: string;
  address: string;
  addressConfirmed: boolean;
  memo?: string;
  items: ItemForm[];
}
export interface OrderFormValue {
  channel: 'kakao' | 'phone' | 'smartstore';
  ordererName: string;
  ordererPhone: string;
  senderName: string;
  senderTouched?: boolean;
  paymentMethod: 'prepaid' | 'cash';
  rawText: string;
  customerId?: number | null;
  source?: 'reorder' | null;
  shipments: ShipForm[];
}

export const emptyShipment = (name = ''): ShipForm => ({
  recipientName: name,
  recipientPhone: '',
  address: '',
  addressConfirmed: true,
  items: [{ productId: '', qtyBoxes: 1 }],
});

export const emptyOrder = (): OrderFormValue => ({
  channel: 'kakao',
  ordererName: '',
  ordererPhone: '',
  senderName: '',
  paymentMethod: 'cash',
  rawText: '',
  shipments: [emptyShipment()],
});

/** 폼 값 → API body */
export function toBody(v: OrderFormValue) {
  return {
    channel: v.channel,
    ordererName: v.ordererName,
    ordererPhone: v.ordererPhone || null,
    senderName: v.senderName || v.ordererName,
    paymentMethod: v.paymentMethod,
    rawText: v.rawText || null,
    customerId: v.customerId ?? undefined,
    source: v.source || undefined,
    shipments: v.shipments.map((s) => ({
      recipientName: s.recipientName,
      recipientPhone: s.recipientPhone || null,
      address: s.address,
      addressConfirmed: s.addressConfirmed,
      memo: s.memo || null,
      items: s.items.map((i) => ({ productId: Number(i.productId), qtyBoxes: Number(i.qtyBoxes) })),
    })),
  };
}

export function useProducts() {
  const [products, setProducts] = useState<any[]>([]);
  const reload = () => api('/products').then(setProducts).catch(() => {});
  useEffect(() => {
    reload();
  }, []);
  return { products, reload };
}

export default function OrderForm({
  value,
  onChange,
  products,
  showChannel = true,
}: {
  value: OrderFormValue;
  onChange: (v: OrderFormValue) => void;
  products: any[];
  showChannel?: boolean;
}) {
  const [lookup, setLookup] = useState<any>(null);
  const set = (patch: Partial<OrderFormValue>) => onChange({ ...value, ...patch });
  const setShip = (i: number, patch: Partial<ShipForm>) => set({ shipments: value.shipments.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const setItem = (si: number, ii: number, patch: Partial<ItemForm>) =>
    setShip(si, { items: value.shipments[si].items.map((it, k) => (k === ii ? { ...it, ...patch } : it)) });

  // 같은 상품을 여러 배송지에 걸쳐 고른 총량 (남은 수량 비교용)
  const totalFor = (pid: number) => value.shipments.reduce((a, s) => a + s.items.filter((i) => Number(i.productId) === pid).reduce((b, i) => b + Number(i.qtyBoxes || 0), 0), 0);

  async function doLookup() {
    const d = value.ordererPhone.replace(/\D/g, '');
    if (d.length < 10) {
      setLookup(null);
      return;
    }
    try {
      setLookup(await api('/customers/lookup?phone=' + encodeURIComponent(value.ordererPhone)));
    } catch (e: any) {
      setLookup({ error: e.message });
    }
  }

  return (
    <div>
      <div className="fields">
        {showChannel && (
          <label className="field">
            주문 경로
            {(value as any).source === 'reorder' ? (
              // 다시 넣기: "작년이랑 같은 걸로"는 카톡·전화 어느 쪽으로도 올 수 있음
              <select value={value.channel} onChange={(e) => set({ channel: e.target.value as any })}>
                <option value="kakao">카카오톡</option>
                <option value="phone">전화</option>
              </select>
            ) : (
              <input value="카카오톡 (전화 주문은 [전화 주문 입력]에서)" readOnly disabled />
            )}
          </label>
        )}
        <label className="field">
          주문자 이름 *
          <input
            value={value.ordererName}
            onChange={(e) => {
              const n = e.target.value;
              const patch: Partial<OrderFormValue> = { ordererName: n };
              if (!value.senderTouched) patch.senderName = n;
              set(patch);
            }}
          />
        </label>
        <label className="field">
          주문자 전화번호
          <input value={value.ordererPhone} placeholder="010-0000-0000 (없으면 비워 두기)" onChange={(e) => set({ ordererPhone: e.target.value })} onBlur={doLookup} />
        </label>
        <label className="field">
          보내는 사람 (기본 = 주문자)
          <input value={value.senderName} onChange={(e) => set({ senderName: e.target.value, senderTouched: true })} />
        </label>
        <label className="field">
          결제 방식
          <select value={value.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value as any })}>
            <option value="cash">현금(계좌이체) — 입금대기</option>
            <option value="prepaid">선결제 완료</option>
          </select>
        </label>
      </div>
      {!value.ordererPhone.trim() && <p className="small" style={{ color: 'var(--red)' }}>번호가 없으면 "번호 확인 필요"로 저장되고, 번호를 넣기 전에는 발송할 수 없습니다.</p>}

      {lookup?.error && <p className="small" style={{ color: 'var(--red)' }}>{lookup.error}</p>}
      {lookup?.customers?.length > 0 && (
        <div className="alert info">
          {lookup.customers.map((c: any) => (
            <div key={c.id}>
              기존 고객: <strong>{c.displayName}</strong> ({fmtPhone(lookup.phone)})
              {c.displayName !== value.ordererName && value.ordererName && <span className="badge gray" style={{ marginLeft: 6 }}>이름 다름 — 같은 번호라 같은 고객으로 묶입니다</span>}
              {c.addresses.length > 0 && (
                <div className="small" style={{ marginTop: 4 }}>
                  지난 배송지 (누르면 첫 배송지에 채움):
                  <div className="chips">
                    {c.addresses.map((a: any, k: number) => (
                      <button
                        type="button"
                        key={k}
                        className="chip"
                        onClick={() => setShip(0, { recipientName: a.recipientName, recipientPhone: fmtPhone(a.recipientPhone), address: a.address })}
                      >
                        {a.recipientName} · {a.address}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {lookup && lookup.customers?.length === 0 && <p className="muted small">처음 주문하는 번호입니다 — 새 고객으로 등록됩니다.</p>}

      <h3>배송지 {value.shipments.length}곳</h3>
      {value.shipments.map((s, si) => (
        <div className="ship-card" key={si}>
          <div className="spread">
            <strong>배송지 {si + 1}</strong>
            {value.shipments.length > 1 && (
              <button type="button" className="btn small danger" onClick={() => set({ shipments: value.shipments.filter((_, k) => k !== si) })}>
                배송지 삭제
              </button>
            )}
          </div>
          <div className="fields" style={{ marginTop: 6 }}>
            <label className="field">
              받는 분 *
              <input value={s.recipientName} onChange={(e) => setShip(si, { recipientName: e.target.value })} />
            </label>
            <label className="field">
              받는 분 번호
              <input value={s.recipientPhone} onChange={(e) => setShip(si, { recipientPhone: e.target.value })} />
            </label>
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              주소 *
              <input value={s.address} onChange={(e) => setShip(si, { address: e.target.value })} />
            </label>
          </div>
          {value.source === 'reorder' && (
            <label className="alert warn" style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={s.addressConfirmed} onChange={(e) => setShip(si, { addressConfirmed: e.target.checked })} />
              <strong>주소 확인</strong> — 지난 주소 그대로입니다. 고객에게 확인했으면 체크하세요 (필수)
            </label>
          )}
          {s.items.map((it, ii) => {
            const p = products.find((x) => x.id === Number(it.productId));
            const over = p && totalFor(p.id) > p.remaining;
            return (
              <div className="item-row" key={ii}>
                <select value={it.productId} onChange={(e) => setItem(si, ii, { productId: e.target.value ? Number(e.target.value) : '' })}>
                  <option value="">상품 선택</option>
                  {products
                    .filter((x) => x.active || x.id === Number(it.productId))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label} · {x.price?.toLocaleString()}원 · 남은 {x.remaining}박스
                      </option>
                    ))}
                </select>
                <input type="number" min={1} value={it.qtyBoxes} onChange={(e) => setItem(si, ii, { qtyBoxes: e.target.value ? Number(e.target.value) : '' })} />
                박스
                {it.rawText && <span className="muted small">원문: “{it.rawText}”</span>}
                {p && <span className={over ? 'badge red' : 'badge gray'}>남은 {p.remaining}박스</span>}
                {over && <span className="small" style={{ color: 'var(--red)' }}>남은 수량 초과 — 저장 시 거부됩니다</span>}
                {s.items.length > 1 && (
                  <button type="button" className="btn small ghost" onClick={() => setShip(si, { items: s.items.filter((_, k) => k !== ii) })}>
                    삭제
                  </button>
                )}
              </div>
            );
          })}
          <button type="button" className="btn small secondary" onClick={() => setShip(si, { items: [...s.items, { productId: '', qtyBoxes: 1 }] })}>
            + 품목 추가
          </button>
        </div>
      ))}
      <button type="button" className="btn secondary" onClick={() => set({ shipments: [...value.shipments, emptyShipment()] })}>
        + 배송지 추가
      </button>
    </div>
  );
}
