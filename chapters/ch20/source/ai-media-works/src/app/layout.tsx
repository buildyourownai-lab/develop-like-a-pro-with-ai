import type { Metadata } from "next";
import "./globals.css";

/**
 * The finished product this metadata describes: reading and classifying one
 * video's comments locally (chapter 19), and sending a bounded number of
 * replies a person approved (chapter 20). Kept out of search results either
 * way — locally there is nothing for a crawler to reach, and a deployed server
 * serves only the notice page in src/app/page.tsx plus operator-secret routes.
 */
export const metadata: Metadata = {
  title: "ai-media-works · 댓글 미리보기와 한도 있는 답글",
  description:
    "내 채널 영상 한 편의 댓글을 읽고 분류·초안을 확인한 뒤, 사람이 승인한 답글만 정해진 한도 안에서 보내는 도구",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
