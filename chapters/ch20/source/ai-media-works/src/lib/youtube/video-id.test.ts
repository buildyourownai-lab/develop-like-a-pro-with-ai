import { describe, expect, it } from "vitest";
import { extractVideoId } from "./video-id";

describe("extractVideoId", () => {
  it("reads the v= query parameter", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("reads youtu.be short links", () => {
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("reads shorts links", () => {
    expect(extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("reads a bare 11-character ID", () => {
    expect(extractVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("returns null for an unrelated URL", () => {
    expect(extractVideoId("https://example.com/not-a-video")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(extractVideoId("not a url at all")).toBeNull();
  });
});
