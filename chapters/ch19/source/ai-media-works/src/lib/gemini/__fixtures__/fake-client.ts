import { CommentCategory } from "../../comments/types";
import { ClassifyOutput, ContextCheckOutput, DraftOutput, GeminiClient } from "../types";

export interface FakeGeminiScript {
  classify?: (text: string) => ClassifyOutput | Promise<ClassifyOutput>;
  draft?: (text: string, category: CommentCategory) => DraftOutput | Promise<DraftOutput>;
  contextCheck?: (
    text: string,
    draft: string,
  ) => ContextCheckOutput | Promise<ContextCheckOutput>;
}

/**
 * A scripted stand-in for Gemini used only in tests. It never touches the
 * network — every response is whatever the test told it to say — and it
 * records every call so a test can assert what was, and was not, sent.
 */
export class FakeGeminiClient implements GeminiClient {
  readonly classifyCalls: string[] = [];
  readonly draftCalls: Array<{ text: string; category: CommentCategory }> = [];
  readonly contextCheckCalls: Array<{ text: string; draft: string }> = [];

  constructor(private readonly script: FakeGeminiScript) {}

  async classifyComment(commentText: string): Promise<ClassifyOutput> {
    this.classifyCalls.push(commentText);
    if (!this.script.classify) {
      throw new Error(`FakeGeminiClient has no classify script for: ${commentText}`);
    }
    return this.script.classify(commentText);
  }

  async generateDraft(commentText: string, category: CommentCategory): Promise<DraftOutput> {
    this.draftCalls.push({ text: commentText, category });
    if (!this.script.draft) {
      throw new Error("FakeGeminiClient has no draft script");
    }
    return this.script.draft(commentText, category);
  }

  async checkDraftContext(commentText: string, draft: string): Promise<ContextCheckOutput> {
    this.contextCheckCalls.push({ text: commentText, draft });
    if (!this.script.contextCheck) {
      throw new Error("FakeGeminiClient has no contextCheck script");
    }
    return this.script.contextCheck(commentText, draft);
  }
}
