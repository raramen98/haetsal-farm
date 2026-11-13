'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, fmtDateTime, fmtPhone } from '@/lib/api';
import { ErrorBox, Loading } from '@/components/ui';

export default function CustomersPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<any>(null);

  const load = (query = q) => {
    setRows(null);
    api('/customers' + (query ? `?q=${encodeURIComponent(query)}` : ''))
      .then(setRows)
      .catch(setError);
  };
  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <h1>고객</h1>
      <p className="muted small">고객은 주문자 전화번호로 묶습니다. 이름이 달라도 번호가 같으면 같은 고객입니다.</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <input placeholder="이름 또는 전화번호" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn secondary">검색</button>
      </form>
      <ErrorBox error={error} />
      {!rows ? (
        <Loading />
      ) : (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>전화번호</th>
                <th>쓰인 이름들</th>
                <th>주문 수</th>
                <th>마지막 주문</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => router.push(`/customers/${c.id}`)}>
                  <td>
                    <strong>{c.displayName}</strong>
                    {c.splitNote && <div className="muted small">{c.splitNote}</div>}
                  </td>
                  <td>{fmtPhone(c.phone)}</td>
                  <td>
                    {c.knownNames?.length > 1 ? (
                      <span className="badges">
                        {c.knownNames.map((n: string) => (
                          <span key={n} className="badge gray">
                            {n}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td>{c.orderCount}</td>
                  <td className="small">{c.lastOrderedAt ? fmtDateTime(c.lastOrderedAt) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
