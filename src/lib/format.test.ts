import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./format";

const now = Date.parse("2026-06-15T12:00:00.000Z");

describe("formatRelativeTime", () => {
  it("formats recent times compactly", () => {
    expect(formatRelativeTime("2026-06-15T11:59:50.000Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-06-15T11:55:00.000Z", now)).toBe("5m ago");
    expect(formatRelativeTime("2026-06-15T09:00:00.000Z", now)).toBe("3h ago");
    expect(formatRelativeTime("2026-06-13T12:00:00.000Z", now)).toBe("2d ago");
  });

  it("falls back to a date for older values and ignores invalid input", () => {
    expect(formatRelativeTime("2026-05-01T12:00:00.000Z", now)).toMatch(/May|5/);
    expect(formatRelativeTime("not a date", now)).toBe("");
  });
});
