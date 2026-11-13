'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { ErrorBox } from '@/components/ui';
import DocsViewer from '@/components/DocsViewer';

const EXAMPLES = ['사과 냉장고에 넣어야 해요? 몇 주 가요?', '부사 냉장 보관 얼마나 돼요?', '감자 냉장고에 넣어도 돼요?', '사과로 잼 만드는 법 알려주세요'];

export default function QaPage() {
  const [question, setQuestion] = useState('');
  const [res, setRes] = useState<any>(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function ask(q = question) {
    setQuestion(q);
    setBusy(true);
    setError(null);
    setRes(null);
    setCopied(false);
    try {
      const r = await api('/qa/ask', { body: { question: q } });
      setRes(r);
      setReply(r.replyDraft || '');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(reply);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <h1>답장 도우미</h1>
      <p className="muted small">농원 쪽지를 먼저 찾고, 없을 때만 농업기술센터 자료를 봅니다. 자료에 없으면 지어내지 않고 “자료에 없음”이라고 알려 줍니다.</p>
      <div className="card">
        <textarea value={question} placeholder="고객 질문을 붙여 넣으세요" onChange={(e) => setQuestion(e.target.value)} style={{ minHeight: 70 }} />
        <div className="chips">
          {EXAMPLES.map((e) => (
            <button key={e} className="chip" onClick={() => ask(e)} disabled={busy}>
              {e}
            </button>
          ))}
        </div>
        <button className="btn" disabled={busy || question.trim().length < 2} onClick={() => ask()}>
          {busy ? '자료 찾는 중…' : '답 찾기'}
        </button>
      </div>
      <ErrorBox error={error} />

      {res && (
        <>
          {!res.found ? (
            <div className="alert error banner">자료에 없음 — 확인 필요</div>
          ) : null}
          <div className="card">
            <h3>답변</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{res.answer}</p>
            {res.aiError && <p className="small" style={{ color: 'var(--red)' }}>AI 답변 생성 실패 — 아래 근거를 직접 확인하세요</p>}
          </div>

          {res.sources?.length > 0 && (
            <>
              <h3>근거 자료</h3>
              {res.sources.map((s: any, i: number) => {
                const farm = s.sourceLabel?.includes('쪽지') || s.source === 'farm_note';
                return (
                  <div key={i} className={`card source ${farm ? 'farm' : 'center'}`}>
                    <div className="row">
                      <span className={farm ? 'badge green' : 'badge gray'}>{s.sourceLabel || (farm ? '농원 쪽지' : '농업기술센터 자료')}</span>
                      <strong>{s.title}</strong>
                      {s.variety && <span className="muted">· {s.variety}</span>}
                      {s.page != null && <span className="badge gray">{s.page}쪽</span>}
                    </div>
                    <p className="small" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{s.content}</p>
                  </div>
                );
              })}
            </>
          )}

          {res.found && (
            <div className="card">
              <h3>답장 초안 (카톡용)</h3>
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} />
              <div className="row">
                <button className="btn secondary" disabled={!reply} onClick={copy}>
                  복사
                </button>
                {copied && <span className="small" style={{ color: 'var(--green)' }}>복사했습니다</span>}
              </div>
            </div>
          )}
        </>
      )}
      <DocsViewer />
    </>
  );
}
