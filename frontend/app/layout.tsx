import './globals.css';
import type { Metadata } from 'next';
import Shell from '@/components/Shell';

export const metadata: Metadata = {
  title: '햇살농원 주문·출고 관리',
  description: '스마트스토어·카카오톡·전화 주문을 한곳에서',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
