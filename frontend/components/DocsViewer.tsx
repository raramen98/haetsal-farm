'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Doc = {
  id: number;
  source: 'farm_note' | 'center';
  sourceLabel: string;
  title: string;
  variety: string | null;
  content: { id: number; page: number | null; text: string }[];
};

/** 답장 도우미가 근거로 쓰는 자료 원문 보기 (농원 쪽지 / 농업기술센터 자료) */
export default function DocsViewer() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'farm_note' | 'center'>('farm_note');
  const [sel, setSel] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || docs.length) return;
    api('/qa/docs')
      .then((d: Doc[]) => {
        setDocs(d);
        setSel(d.find((x) => x.source === 'farm_note')?.id ?? null);
      })
      .catch(() => setError('자료를 불러오지 못했어요'));
  }, [open, docs.length]);

  const list = docs.filter((d) => d.source === tab);
  const cur = docs.find((d) => d.id === sel && d.source === tab) || list[0];
  const notes = docs.filter((d) => d.source === 'farm_note').length;
  const centerPages = docs.filter((d) => d.source === 'center').reduce((a, d) => a + d.content.length, 0);

  return (
    <div className="card">
      <div className="spread">
        <div>
          <h3 style={{ margin: 0 }}>참고 자료 원문</h3>
          <span className="muted small">답장 도우미가 근거로 찾는 자료예요. 농원 쪽지가 먼저예요.</span>
        </div>
        <button className="btn small secondary" onClick={() => setOpen(!open)}>
          {open ? '접기' : '자료 보기'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          {error && <div className="alert error">{error}</div>}
          <div className="doc-tabs">
            <button className={tab === 'farm_note' ? 'on' : ''} onClick={() => setTab('farm_note')}>
              농원 쪽지 {notes ? `${notes}장` : ''}
            </button>
            <button className={tab === 'center' ? 'on' : ''} onClick={() => setTab('center')}>
              농업기술센터 자료 {centerPages ? `${centerPages}쪽` : ''}
            </button>
          </div>
          {list.length > 1 && (
            <div className="chips">
              {list.map((d) => (
                <button key={d.id} className={`chip ${cur?.id === d.id ? 'on' : ''}`} onClick={() => setSel(d.id)}>
                  {d.title.split('— ')[1] || d.variety || d.title}
                </button>
              ))}
            </div>
          )}
          {cur && (
            <div className={`doc-body source ${cur.source === 'farm_note' ? 'farm' : 'center'}`}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{cur.title}</div>
              {cur.content.map((c) => (
                <p key={c.id}>
                  {c.page != null && <span className="badge gray" style={{ marginRight: 6 }}>{c.page}쪽</span>}
                  {c.text}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
