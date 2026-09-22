import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ai-media-works · 댓글 읽기",
  description: "내 채널 시험 영상의 댓글을 읽고 분류·초안을 로컬에서 확인하는 도구",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
