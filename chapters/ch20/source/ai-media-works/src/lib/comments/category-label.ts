import { CommentCategory } from "./types";

/**
 * Korean display label for each closed comment category, shared by the
 * server-side classification reason text and the reader UI badge — so an
 * internal enum name like GENERAL_REACTION never reaches either surface.
 */
export const CATEGORY_LABEL: Record<CommentCategory | "UNKNOWN", string> = {
  GENERAL_REACTION: "일반 반응",
  FOLLOW_UP_REQUEST: "후속 요청",
  QUESTION: "질문",
  FACT_OR_COMPLAINT: "사실 지적·불만",
  AD_OR_UNRELATED: "광고·무관",
  UNKNOWN: "분류 확인 필요",
};

export function categoryLabel(category: CommentCategory | "UNKNOWN"): string {
  return CATEGORY_LABEL[category];
}
