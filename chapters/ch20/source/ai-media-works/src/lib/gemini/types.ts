import { CommentCategory } from "../comments/types";

export interface ClassifyOutput {
  category: string;
  /** The model's own signal that the comment mixes an auto-eligible tone with something else (e.g. cheer + question). */
  mixedSignals: boolean;
}

export interface DraftOutput {
  draft: string;
}

export interface ContextCheckOutput {
  passed: boolean;
  reason: string;
}

/**
 * Everything the comment pipeline needs from Gemini, kept as a narrow
 * interface so tests can supply a fake implementation and never touch
 * the network or the real SDK.
 */
export interface GeminiClient {
  classifyComment(commentText: string): Promise<ClassifyOutput>;
  generateDraft(commentText: string, category: CommentCategory): Promise<DraftOutput>;
  /** A request separate from generateDraft — checks whether the draft still fits the comment. */
  checkDraftContext(commentText: string, draft: string): Promise<ContextCheckOutput>;
}
