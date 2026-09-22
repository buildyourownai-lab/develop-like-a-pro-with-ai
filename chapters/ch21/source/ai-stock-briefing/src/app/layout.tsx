import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "국내 주식 한눈에",
  description: "금융위원회 공식 주식 데이터로 국내 증시와 관심 종목을 확인합니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="page">{children}</div>
      </body>
    </html>
  );
}
