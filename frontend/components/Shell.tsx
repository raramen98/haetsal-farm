'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getUser, homeFor, logout, Role, User } from '@/lib/api';

/* ---------- 아이콘 (외곽선, 18px) ---------- */
const ICONS: Record<string, React.ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  order: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 10h6M9 14h6M9 18h3" /></>,
  truck: <><path d="M3 6h11v10H3z" /><path d="M14 9h4l3 3v4h-7" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>,
  box: <><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  spark: <><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z" /><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
  settings: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
  logout: <><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
};
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/* ---------- 메뉴 구성 ---------- */
type Item = { href: string; label: string; match: (p: string) => boolean };
type Entry =
  | { kind: 'link'; icon: string; item: Item }
  | { kind: 'group'; key: string; icon: string; label: string; items: Item[] };

const exact = (href: string) => (p: string) => p === href;
const prefix = (...hs: string[]) => (p: string) => hs.some((h) => p === h || p.startsWith(h + '/'));

const MENUS: Record<Role, Entry[]> = {
  admin: [
    { kind: 'link', icon: 'home', item: { href: '/', label: '홈', match: exact('/') } },
    {
      kind: 'group', key: 'order', icon: 'order', label: '주문',
      items: [
        // 전화 주문·엑셀 올리기는 홈 빠른 메뉴와 주문 목록 버튼으로 연다
        { href: '/orders', label: '주문 목록', match: (p) => p === '/import' || (p.startsWith('/orders') && p !== '/orders/new') },
        { href: '/phone-order', label: '전화 주문 입력', match: exact('/phone-order') },
        { href: '/orders/new', label: '카톡 주문 직접 입력', match: exact('/orders/new') },
        { href: '/payments', label: '입금 확인', match: exact('/payments') },
      ],
    },
    {
      kind: 'group', key: 'ship', icon: 'truck', label: '출고',
      items: [
        { href: '/shipping', label: '오늘 보낼 목록', match: exact('/shipping') },
        { href: '/packing', label: '포장 목록', match: exact('/packing') },
      ],
    },
    {
      kind: 'group', key: 'manage', icon: 'box', label: '관리',
      items: [
        { href: '/customers', label: '고객', match: prefix('/customers') },
        { href: '/stock', label: '상품·재고', match: exact('/stock') },
        { href: '/incidents', label: '배송 사고', match: prefix('/incidents') },
      ],
    },
    {
      kind: 'group', key: 'help', icon: 'spark', label: '도우미',
      items: [
        { href: '/qa', label: '답장 도우미', match: exact('/qa') },
        { href: '/notice', label: '안내 문자 초안', match: exact('/notice') },
      ],
    },
  ],
  packer: [
    { kind: 'link', icon: 'box', item: { href: '/packing', label: '포장 목록', match: exact('/packing') } },
    { kind: 'link', icon: 'phone', item: { href: '/phone-order', label: '전화 주문', match: exact('/phone-order') } },
  ],
  stock: [{ kind: 'link', icon: 'box', item: { href: '/stock', label: '상품·재고', match: exact('/stock') } }],
};

const ROLE_LABEL: Record<Role, string> = { admin: '관리자', packer: '포장', stock: '재고' };

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const isLogin = pathname === '/login';
  const isPublic = pathname === '/order'; // 고객 주문서: 로그인·메뉴 없음

  useEffect(() => {
    const u = getUser();
    setUser(u);
    setReady(true);
    if (!u && !isLogin && !isPublic) router.replace('/login');
  }, [pathname, isLogin, isPublic, router]);

  if (isLogin || isPublic) return <>{children}</>;
  if (!ready || !user) return <main className="container"><p className="muted">불러오는 중…</p></main>;

  const isAdmin = user.role === 'admin';
  const doLogout = () => {
    logout();
    router.replace('/login');
  };

  return (
    <div className={`layout ${isAdmin ? '' : 'big-ui'}`}>
      <aside className="sidebar no-print">
        <Link href={homeFor(user.role)} className="brand">
          <span className="brand-mark" aria-hidden="true" />
          햇살농원
        </Link>
        <div className="side-user">
          <span>{user.name}</span>
          <span className="muted small">{ROLE_LABEL[user.role]}</span>
        </div>

        <nav className="side-nav">
          {MENUS[user.role].map((e) => {
            if (e.kind === 'link') {
              return (
                <Link key={e.item.href} href={e.item.href} className={`side-top ${e.item.match(pathname) ? 'on' : ''}`}>
                  <Icon name={e.icon} />
                  {e.item.label}
                </Link>
              );
            }
            const isClosed = closed[e.key] && !e.items.some((i) => i.match(pathname));
            return (
              <div key={e.key} className="side-group">
                <button type="button" className="side-top" onClick={() => setClosed({ ...closed, [e.key]: !isClosed })} aria-expanded={!isClosed}>
                  <Icon name={e.icon} />
                  <span style={{ flex: 1 }}>{e.label}</span>
                  <span className={`side-chev ${isClosed ? '' : 'up'}`}>
                    <Icon name="chevron" size={16} />
                  </span>
                </button>
                {!isClosed &&
                  e.items.map((i) => (
                    <Link key={i.href} href={i.href} className={`side-item ${i.match(pathname) ? 'on' : ''}`}>
                      {i.label}
                    </Link>
                  ))}
              </div>
            );
          })}
        </nav>

        <div className="side-foot">
          {isAdmin && (
            <Link href="/settings" className={`side-top ${pathname === '/settings' ? 'on' : ''}`}>
              <Icon name="settings" />
              설정
            </Link>
          )}
          <button type="button" className="side-top" onClick={doLogout}>
            <Icon name="logout" />
            로그아웃
          </button>
        </div>
      </aside>
      <main className="container">{children}</main>
    </div>
  );
}
