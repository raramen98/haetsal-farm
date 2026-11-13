'use client';

import { useEffect, useState } from 'react';

/** 주문 목록의 [고객 주문서 미리보기]: 고객이 보는 화면(휴대폰 틀)과 사용 흐름 */
export default function OrderFormPreview() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState('/order');

  useEffect(() => setUrl(`${window.location.origin}/order`), []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  return (
    <>
      <button type="button" className="btn secondary" onClick={() => setOpen(true)}>
        고객 주문서 미리보기
      </button>
      {open && (
        <div className="modal-back" onClick={() => setOpen(false)}>
          <div className="modal" role="dialog" aria-label="고객 주문서 미리보기" onClick={(e) => e.stopPropagation()}>
            <div className="spread" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>고객 주문서 미리보기</h2>
              <button className="btn small ghost" onClick={() => setOpen(false)} aria-label="닫기">
                닫기 ✕
              </button>
            </div>
            <div className="preview-wrap">
              <div className="phone">
                <div className="phone-notch" />
                <iframe src="/order?preview=1" title="고객 주문서 화면" />
              </div>
              <div className="preview-side">
                <h3>고객은 이렇게 주문해요</h3>
                <ol className="steps">
                  <li>
                    <strong>카톡 채널에서 "주문하기"</strong>
                    <span>채널 자동 응답·하단 메뉴에 걸어 둔 링크를 눌러요. 로그인은 필요 없어요.</span>
                  </li>
                  <li>
                    <strong>이름·전화번호 입력</strong>
                    <span>번호는 필수예요. 같은 번호면 기존 고객으로 묶여요.</span>
                  </li>
                  <li>
                    <strong>받는 곳과 상품 고르기</strong>
                    <span>명절 선물은 "받는 곳 추가"로 여러 곳. 상품에는 품절·얼마 안 남음·예약만 보여요.</span>
                  </li>
                  <li>
                    <strong>주문 보내기</strong>
                    <span>합계와 입금 계좌, 발송 예정일이 안내돼요. 남은 수량을 넘으면 그 자리에서 막혀요.</span>
                  </li>
                </ol>
                <h3>정우 씨 화면에는</h3>
                <p className="small" style={{ margin: 0 }}>
                  주문 목록에 <span className="badge blue">고객 작성</span> <span className="badge red">확인필요</span>{' '}
                  <span className="badge yellow">입금대기</span>로 바로 들어와요. 내용을 확인하고 <strong>확정</strong>하면 접수돼요.
                </p>
                <div className="preview-link">
                  <span className="muted small">채널에 걸어 둔 링크</span>
                  <code>{url}</code>
                  <button
                    className="btn small secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(url);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      } catch {}
                    }}
                  >
                    {copied ? '복사됨' : '복사'}
                  </button>
                </div>
                <p className="muted small" style={{ margin: 0 }}>미리보기에서는 "주문 보내기"를 눌러도 저장되지 않아요.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
