import type { PullRequestReview, PullRequestReviewSummary, ReviewState } from "./types";

export type RawReview = {
  id: number;
  reviewer: string;
  avatarUrl: string | null;
  /** GitHub review state, e.g. APPROVED or CHANGES_REQUESTED. */
  state: string;
  body: string;
  submittedAt: string | null;
  htmlUrl: string;
};

const DECISIONS: Record<string, ReviewState> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  DISMISSED: "dismissed",
};

export const EMPTY_REVIEW_SUMMARY: PullRequestReviewSummary = {
  reviews: [],
  requestedReviewers: [],
  approvals: 0,
  changesRequested: 0,
  decision: "none",
};

/**
 * Reduces a pull request's review history to one entry per reviewer. Like GitHub, only approvals,
 * change requests, and dismissals replace a reviewer's standing decision; plain comments never do.
 */
export function summarizeReviews(raw: RawReview[], requestedReviewers: string[]): PullRequestReviewSummary {
  const submitted = raw
    .filter((review) => review.state !== "PENDING" && review.submittedAt)
    .sort((left, right) => (left.submittedAt ?? "").localeCompare(right.submittedAt ?? "") || left.id - right.id);

  const byReviewer = new Map<string, PullRequestReview>();
  for (const review of submitted) {
    const decision = DECISIONS[review.state];
    const existing = byReviewer.get(review.reviewer);
    if (!decision && existing && existing.state !== "commented") continue;
    byReviewer.set(review.reviewer, {
      id: review.id,
      reviewer: review.reviewer,
      avatarUrl: review.avatarUrl,
      state: decision ?? "commented",
      body: review.body,
      submittedAt: review.submittedAt,
      htmlUrl: review.htmlUrl,
    });
  }

  const reviews = [...byReviewer.values()]
    .filter((review) => review.state !== "dismissed")
    .sort((left, right) => (right.submittedAt ?? "").localeCompare(left.submittedAt ?? ""));
  const approvals = reviews.filter((review) => review.state === "approved").length;
  const changesRequested = reviews.filter((review) => review.state === "changes-requested").length;
  const awaiting = requestedReviewers.filter((login) => !reviews.some((review) => review.reviewer === login && review.state !== "commented"));

  return {
    reviews,
    requestedReviewers: awaiting,
    approvals,
    changesRequested,
    decision: changesRequested > 0 ? "changes-requested" : approvals > 0 && awaiting.length === 0 ? "approved" : approvals > 0 || awaiting.length > 0 ? "review-required" : "none",
  };
}
