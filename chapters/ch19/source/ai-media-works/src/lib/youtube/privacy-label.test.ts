import { describe, expect, it } from "vitest";
import { privacyDisplayLabel } from "./privacy-label";

describe("privacyDisplayLabel", () => {
  it("maps public to 공개", () => {
    expect(privacyDisplayLabel("public")).toBe("공개");
  });

  it("maps unlisted to 일부 공개", () => {
    expect(privacyDisplayLabel("unlisted")).toBe("일부 공개");
  });

  it("maps private to 확인 필요, never echoing the raw enum", () => {
    expect(privacyDisplayLabel("private")).toBe("확인 필요");
  });

  it("maps an unrecognized or malformed value to 확인 필요", () => {
    expect(privacyDisplayLabel("")).toBe("확인 필요");
    expect(privacyDisplayLabel("PUBLIC")).toBe("확인 필요");
    expect(privacyDisplayLabel("some-future-status")).toBe("확인 필요");
  });
});
