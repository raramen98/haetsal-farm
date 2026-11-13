'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, homeFor, saveLogin } from '@/lib/api';
import { ErrorBox } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api('/auth/login', { body: { loginId, password } });
      saveLogin(r.token, r.user);
      router.replace(homeFor(r.user.role));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-box">
      <div className="card">
        <h1>햇살농원 로그인</h1>
        <p className="muted">주문·출고 관리</p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="field">
            아이디
            <input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoFocus autoComplete="username" />
          </label>
          <label className="field">
            비밀번호
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <ErrorBox error={error} />
          <button className="btn" disabled={busy || !loginId || !password}>
            {busy ? '로그인 중…' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  );
}
