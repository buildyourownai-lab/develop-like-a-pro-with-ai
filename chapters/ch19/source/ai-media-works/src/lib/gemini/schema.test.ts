import { describe, expect, it } from "vitest";
import {
  GeminiSchemaError,
  parseClassifyOutput,
  parseContextCheckOutput,
  parseDraftOutput,
} from "./schema";

/**
 * These are the fail-closed boundary tests the prior implementation was
 * missing: Boolean("false") === true and String([1,2]) === "1,2" both used
 * to turn a malformed Gemini response into something that looked valid.
 * Every case below must throw instead of returning a coerced value.
 */

describe("parseClassifyOutput", () => {
  it("accepts a well-formed response", () => {
    const result = parseClassifyOutput('{"category":"GENERAL_REACTION","mixedSignals":false}');
    expect(result).toEqual({ category: "GENERAL_REACTION", mixedSignals: false });
  });

  it("rejects malformed JSON", () => {
    expect(() => parseClassifyOutput("not json")).toThrow(GeminiSchemaError);
  });

  it("rejects a JSON array instead of an object", () => {
    expect(() => parseClassifyOutput('["GENERAL_REACTION", false]')).toThrow(GeminiSchemaError);
  });

  it("rejects a bare JSON null", () => {
    expect(() => parseClassifyOutput("null")).toThrow(GeminiSchemaError);
  });

  it("rejects a missing category field", () => {
    expect(() => parseClassifyOutput('{"mixedSignals":false}')).toThrow(GeminiSchemaError);
  });

  it("rejects a category outside the five fixed values", () => {
    expect(() => parseClassifyOutput('{"category":"SPAM","mixedSignals":false}')).toThrow(
      GeminiSchemaError,
    );
  });

  it("rejects a numeric category", () => {
    expect(() => parseClassifyOutput('{"category":1,"mixedSignals":false}')).toThrow(
      GeminiSchemaError,
    );
  });

  it("rejects mixedSignals given as the string \"false\" instead of throwing it away as truthy", () => {
    expect(() =>
      parseClassifyOutput('{"category":"GENERAL_REACTION","mixedSignals":"false"}'),
    ).toThrow(GeminiSchemaError);
  });

  it("rejects mixedSignals given as a number", () => {
    expect(() =>
      parseClassifyOutput('{"category":"GENERAL_REACTION","mixedSignals":0}'),
    ).toThrow(GeminiSchemaError);
  });

  it("rejects mixedSignals given as an array", () => {
    expect(() =>
      parseClassifyOutput('{"category":"GENERAL_REACTION","mixedSignals":[]}'),
    ).toThrow(GeminiSchemaError);
  });

  it("rejects a missing mixedSignals field", () => {
    expect(() => parseClassifyOutput('{"category":"GENERAL_REACTION"}')).toThrow(
      GeminiSchemaError,
    );
  });
});

describe("parseDraftOutput", () => {
  it("accepts a well-formed response", () => {
    expect(parseDraftOutput('{"draft":"응원 감사합니다!"}')).toEqual({
      draft: "응원 감사합니다!",
    });
  });

  it("rejects malformed JSON", () => {
    expect(() => parseDraftOutput("{not valid")).toThrow(GeminiSchemaError);
  });

  it("rejects a missing draft field", () => {
    expect(() => parseDraftOutput("{}")).toThrow(GeminiSchemaError);
  });

  it("rejects a null draft", () => {
    expect(() => parseDraftOutput('{"draft":null}')).toThrow(GeminiSchemaError);
  });

  it("rejects a numeric draft", () => {
    expect(() => parseDraftOutput('{"draft":123}')).toThrow(GeminiSchemaError);
  });

  it("rejects an empty or whitespace-only draft", () => {
    expect(() => parseDraftOutput('{"draft":""}')).toThrow(GeminiSchemaError);
    expect(() => parseDraftOutput('{"draft":"   "}')).toThrow(GeminiSchemaError);
  });

  it("rejects an array draft", () => {
    expect(() => parseDraftOutput('{"draft":["hi"]}')).toThrow(GeminiSchemaError);
  });
});

describe("parseContextCheckOutput", () => {
  it("passes only when passed is exactly boolean true", () => {
    expect(parseContextCheckOutput('{"passed":true,"reason":"괜찮습니다"}')).toEqual({
      passed: true,
      reason: "괜찮습니다",
    });
  });

  it("treats a legitimate boolean false as a real, non-thrown failure", () => {
    expect(parseContextCheckOutput('{"passed":false,"reason":"질문에 답합니다"}')).toEqual({
      passed: false,
      reason: "질문에 답합니다",
    });
  });

  it("defaults reason to an empty string when omitted", () => {
    expect(parseContextCheckOutput('{"passed":true}')).toEqual({ passed: true, reason: "" });
  });

  it("rejects malformed JSON instead of defaulting to a pass or a silent fail", () => {
    expect(() => parseContextCheckOutput("<<not json>>")).toThrow(GeminiSchemaError);
  });

  it("rejects the string \"true\" for passed instead of coercing it to boolean true", () => {
    expect(() => parseContextCheckOutput('{"passed":"true","reason":"x"}')).toThrow(
      GeminiSchemaError,
    );
  });

  it("rejects the string \"false\" for passed — Boolean(\"false\") is true, so this is the exact bug this schema exists to close", () => {
    expect(() => parseContextCheckOutput('{"passed":"false","reason":"x"}')).toThrow(
      GeminiSchemaError,
    );
  });

  it("rejects a numeric passed value", () => {
    expect(() => parseContextCheckOutput('{"passed":1,"reason":"x"}')).toThrow(GeminiSchemaError);
  });

  it("rejects a null passed value", () => {
    expect(() => parseContextCheckOutput('{"passed":null,"reason":"x"}')).toThrow(
      GeminiSchemaError,
    );
  });

  it("rejects an array passed value", () => {
    expect(() => parseContextCheckOutput('{"passed":[true],"reason":"x"}')).toThrow(
      GeminiSchemaError,
    );
  });

  it("rejects a missing passed field", () => {
    expect(() => parseContextCheckOutput('{"reason":"x"}')).toThrow(GeminiSchemaError);
  });

  it("rejects a non-string reason", () => {
    expect(() => parseContextCheckOutput('{"passed":true,"reason":123}')).toThrow(
      GeminiSchemaError,
    );
  });

  it("rejects a bare JSON array response", () => {
    expect(() => parseContextCheckOutput("[true, \"x\"]")).toThrow(GeminiSchemaError);
  });
});
