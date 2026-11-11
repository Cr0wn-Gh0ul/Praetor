import { describe, expect, it } from "vitest";
import { summarizeReviews, type RawReview } from "./reviews";

let nextId = 1;
function review(reviewer: string, state: string, submittedAt: string, body = ""): RawReview {
  return { id: nextId++, reviewer, avatarUrl: null, state, body, submittedAt, htmlUrl: `https://github.com/o/r/pull/1#review-${nextId}` };
}

describe("summarizeReviews", () => {
  it("returns no decision when nobody has reviewed", () => {
    const summary = summarizeReviews([], []);
    expect(summary).toMatchObject({ approvals: 0, changesRequested: 0, decision: "none", reviews: [] });
  });

  it("counts approvals from multiple reviewers", () => {
    const summary = summarizeReviews([
      review("ada", "APPROVED", "2026-01-01T10:00:00Z"),
      review("grace", "APPROVED", "2026-01-01T11:00:00Z"),
    ], []);
    expect(summary.approvals).toBe(2);
    expect(summary.decision).toBe("approved");
  });

  it("uses each reviewer's latest decision", () => {
    const summary = summarizeReviews([
      review("ada", "CHANGES_REQUESTED", "2026-01-01T10:00:00Z"),
      review("ada", "APPROVED", "2026-01-01T12:00:00Z"),
    ], []);
    expect(summary.approvals).toBe(1);
    expect(summary.changesRequested).toBe(0);
  });

  it("does not let a later comment replace a standing decision", () => {
    const summary = summarizeReviews([
      review("ada", "CHANGES_REQUESTED", "2026-01-01T10:00:00Z"),
      review("ada", "COMMENTED", "2026-01-01T12:00:00Z", "still looking"),
    ], []);
    expect(summary.changesRequested).toBe(1);
    expect(summary.reviews[0]?.state).toBe("changes-requested");
    expect(summary.decision).toBe("changes-requested");
  });

  it("lets any outstanding change request override approvals", () => {
    const summary = summarizeReviews([
      review("ada", "APPROVED", "2026-01-01T10:00:00Z"),
      review("grace", "CHANGES_REQUESTED", "2026-01-01T11:00:00Z"),
    ], []);
    expect(summary.decision).toBe("changes-requested");
  });

  it("drops dismissed reviews and ignores pending drafts", () => {
    const summary = summarizeReviews([
      review("ada", "CHANGES_REQUESTED", "2026-01-01T10:00:00Z"),
      review("ada", "DISMISSED", "2026-01-01T11:00:00Z"),
      { ...review("grace", "PENDING", "2026-01-01T11:00:00Z"), submittedAt: null },
    ], []);
    expect(summary.reviews).toEqual([]);
    expect(summary.decision).toBe("none");
  });

  it("keeps requested reviewers awaiting until they decide", () => {
    const summary = summarizeReviews([review("ada", "APPROVED", "2026-01-01T10:00:00Z")], ["ada", "grace"]);
    expect(summary.requestedReviewers).toEqual(["grace"]);
    expect(summary.decision).toBe("review-required");
  });
});
