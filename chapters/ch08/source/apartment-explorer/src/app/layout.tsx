import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "아파트 찾기",
  description: "최근 1년 실제 거래와 생활조건으로 확인하는 아파트 후보",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
