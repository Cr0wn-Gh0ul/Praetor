"use client";

import { useState } from "react";
import { Check, CircleAlert, Clock, LoaderCircle, MessageSquare, Plus, X } from "lucide-react";
import { MarkdownEditor } from "@/components/markdown/MarkdownEditor";
import { formatRelativeTime } from "@/lib/format";
import type { IssueDetail, PullRequestReviewSummary, ReviewState } from "@/lib/types";

type ReviewEvent = "approve" | "request-changes" | "comment";

const stateStyles: Record<ReviewState, { label: string; className: string; Icon: typeof Check }> = {
  approved: { label: "Approved", className: "bg-[var(--success)]/12 text-[var(--success)]", Icon: Check },
  "changes-requested": { label: "Changes requested", className: "bg-[var(--warning)]/12 text-[var(--warning)]", Icon: X },
  commented: { label: "Commented", className: "bg-[var(--panel-2)] text-[var(--muted)]", Icon: MessageSquare },
  dismissed: { label: "Dismissed", className: "bg-[var(--panel-2)] text-[var(--muted)]", Icon: MessageSquare },
};

const decisionBadges: Record<PullRequestReviewSummary["decision"], { label: string; className: string }> = {
  approved: { label: "Approved", className: "bg-[var(--success)]/12 text-[var(--success)]" },
  "changes-requested": { label: "Changes requested", className: "bg-[var(--warning)]/12 text-[var(--warning)]" },
  "review-required": { label: "Review required", className: "bg-[var(--panel-2)] text-[var(--muted)]" },
  none: { label: "No reviews yet", className: "bg-[var(--panel-2)] text-[var(--muted)]" },
};

const reviewOptions: { id: ReviewEvent; label: string }[] = [
  { id: "comment", label: "Comment" },
  { id: "approve", label: "Approve" },
  { id: "request-changes", label: "Request changes" },
];

async function post(url: string, body: unknown): Promise<{ movedToAttention?: boolean }> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => null) as { movedToAttention?: boolean; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(result?.error?.message ?? "Request failed.");
  return result ?? {};
}

function Avatar({ login, url }: { login: string; url: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img src={url} alt="" className="size-7 shrink-0 rounded-full border border-[var(--line)]" />;
  return <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--panel-2)] text-[11px] font-semibold uppercase text-[var(--muted)]">{login.slice(0, 1)}</span>;
}

export function PullRequestReviews({ issue, onChanged }: { issue: IssueDetail; onChanged: () => void }) {
  const [inviting, setInviting] = useState(false);
  const [composing, setComposing] = useState(false);
  const [reviewerInput, setReviewerInput] = useState("");
  const [comment, setComment] = useState("");
  const [event, setEvent] = useState<ReviewEvent>("comment");
  const [busy, setBusy] = useState<ReviewEvent | "reviewers" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pullRequest = issue.pullRequest;
  if (!pullRequest) return null;
  const { reviews, requestedReviewers, decision } = pullRequest.reviews;
  const open = pullRequest.state === "open";
  const badge = decisionBadges[decision];
  const needsText = event !== "approve" && !comment.trim();

  async function requestReviewers(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    const logins = [...new Set(reviewerInput.split(/[\s,]+/).map((login) => login.replace(/^@/, "")).filter(Boolean))];
    if (!logins.length) return;
    setBusy("reviewers");
    setError("");
    setNotice("");
    try {
      await post(`/api/issues/${issue.number}/reviewers`, { reviewers: logins });
      setReviewerInput("");
      setInviting(false);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not request reviewers.");
    } finally {
      setBusy(null);
    }
  }

  async function submitReview(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    if (needsText) return;
    setBusy(event);
    setError("");
    setNotice("");
    try {
      const result = await post(`/api/issues/${issue.number}/reviews`, { event, ...(comment.trim() ? { body: comment.trim() } : {}) });
      setComment("");
      setEvent("comment");
      setComposing(false);
      setNotice(result.movedToAttention ? "Changes requested. The issue moved to Needs attention." : "Review submitted.");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit the review.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Reviews" className="card mt-4 overflow-hidden">
      <header className="flex items-center gap-3 px-5 py-3">
        <h2 className="text-sm font-semibold">Reviews</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badge.className}`}>{badge.label}</span>
        {open && !inviting && <button type="button" onClick={() => setInviting(true)} className="btn btn-ghost btn-sm ml-auto"><Plus size={13} />Request reviewer</button>}
      </header>

      {inviting && <form onSubmit={(formEvent) => void requestReviewers(formEvent)} className="flex gap-2 border-t border-[var(--line)] px-5 py-3">
        <label htmlFor="reviewer-logins" className="sr-only">GitHub usernames</label>
        <input id="reviewer-logins" autoFocus value={reviewerInput} onChange={(inputEvent) => setReviewerInput(inputEvent.target.value)} placeholder="GitHub usernames, comma separated" className="setup-input min-h-0 min-w-0 flex-1 py-1.5 text-sm" />
        <button type="submit" disabled={busy !== null || !reviewerInput.trim()} className="btn btn-primary btn-sm h-auto">{busy === "reviewers" && <LoaderCircle size={13} className="animate-spin" />}Request</button>
        <button type="button" onClick={() => { setInviting(false); setReviewerInput(""); }} aria-label="Cancel" className="btn btn-ghost btn-sm btn-icon h-auto"><X size={14} /></button>
      </form>}

      <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
        {reviews.map((review) => {
          const { label, className, Icon } = stateStyles[review.state];
          return <li key={review.id} className="px-5 py-3">
            <div className="flex items-center gap-3">
              <Avatar login={review.reviewer} url={review.avatarUrl} />
              <a href={review.htmlUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium hover:text-[var(--accent)]">{review.reviewer}</a>
              {review.submittedAt && <span className="hidden text-[11px] text-[var(--faint)] sm:inline">{formatRelativeTime(review.submittedAt)}</span>}
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}><Icon size={11} strokeWidth={2.5} />{label}</span>
            </div>
            {review.body && <p className="mt-2 line-clamp-4 whitespace-pre-wrap pl-10 text-xs leading-5 text-[var(--muted)]">{review.body}</p>}
          </li>;
        })}
        {requestedReviewers.map((login) => <li key={login} className="flex items-center gap-3 px-5 py-3">
          <Avatar login={login} url={null} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{login}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--panel-2)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]"><Clock size={11} />Awaiting</span>
        </li>)}
        {reviews.length === 0 && requestedReviewers.length === 0 && <li className="px-5 py-4 text-sm text-[var(--muted)]">Nobody has reviewed this pull request yet.</li>}
      </ul>

      {open && <div className="border-t border-[var(--line)] bg-[var(--panel-2)]/60 px-5 py-3">
        {!composing ? <button type="button" onClick={() => setComposing(true)} className="btn btn-secondary btn-sm"><MessageSquare size={13} />Write a review</button> : <form onSubmit={(formEvent) => void submitReview(formEvent)}>
          <MarkdownEditor id="review-comment" label="Review comment" hideLabel autoFocus value={comment} onChange={setComment} rows={4} placeholder={event === "approve" ? "Leave a comment (optional)" : "Leave a comment (required)"} />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Review type" className="flex rounded-lg border border-[var(--line-strong)] bg-[var(--panel)] p-0.5">
              {reviewOptions.map((option) => <button key={option.id} type="button" role="radio" aria-checked={event === option.id} onClick={() => setEvent(option.id)} className={`h-7 rounded-md px-2.5 text-xs font-semibold transition-colors ${event === option.id ? "bg-[var(--panel-2)] text-[var(--ink)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>{option.label}</button>)}
            </div>
            <button type="button" onClick={() => { setComposing(false); setComment(""); setEvent("comment"); }} className="btn btn-ghost btn-sm ml-auto">Cancel</button>
            <button type="submit" disabled={busy !== null || needsText} title={event === "request-changes" ? "Moves the issue to Needs attention" : undefined} className={`btn btn-sm ${event === "request-changes" ? "btn-danger" : "btn-primary"}`}>
              {busy === event && <LoaderCircle size={13} className="animate-spin" />}Submit
            </button>
          </div>
        </form>}
      </div>}

      {(notice || error) && <div className="border-t border-[var(--line)] px-5 py-3">
        {notice && <p role="status" className="flex items-start gap-2 text-xs leading-5 text-[var(--success)]"><Check size={14} className="mt-0.5 shrink-0" />{notice}</p>}
        {error && <p role="alert" className="flex items-start gap-2 text-xs leading-5 text-[var(--warning)]"><CircleAlert size={14} className="mt-0.5 shrink-0" />{error}</p>}
      </div>}
    </section>
  );
}
