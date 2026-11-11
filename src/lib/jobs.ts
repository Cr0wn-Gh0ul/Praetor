import "server-only";

import { randomUUID } from "node:crypto";
import type { JobStatus } from "./types";

type JobWork<T> = (update: (progress: number, message: string) => void) => Promise<T>;
type RepoJob = { status: JobStatus; work: JobWork<unknown> };

const jobs = new Map<string, JobStatus>();
const activeJobs = new Map<string, string>();
const queuedJobs = new Map<string, RepoJob[]>();

function makeJob<T>(kind: string): JobStatus<T> {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    kind,
    status: "queued",
    progress: 0,
    message: "Waiting to start.",
    createdAt: now,
    updatedAt: now,
  };
}

function runJob<T>(repoKey: string, job: JobStatus<T>, work: JobWork<T>): void {
  queueMicrotask(() => {
    job.status = "running";
    job.updatedAt = new Date().toISOString();
    void work((progress, message) => {
      job.progress = Math.max(0, Math.min(100, progress));
      job.message = message;
      job.updatedAt = new Date().toISOString();
    }).then((result) => {
      job.status = "completed";
      job.progress = 100;
      job.message = "Completed.";
      job.result = result;
      job.updatedAt = new Date().toISOString();
    }).catch((error: unknown) => {
      job.status = "failed";
      job.message = "Failed.";
      job.error = error instanceof Error ? error.message : "Job failed.";
      job.updatedAt = new Date().toISOString();
    }).finally(() => {
      if (activeJobs.get(repoKey) === job.id) activeJobs.delete(repoKey);
      const queue = queuedJobs.get(repoKey);
      const next = queue?.shift();
      if (queue?.length === 0) queuedJobs.delete(repoKey);
      if (next) {
        activeJobs.set(repoKey, next.status.id);
        runJob(repoKey, next.status, next.work);
      }
    });
  });
}

export function startRepoJob<T>(repoKey: string, kind: string, work: JobWork<T>): JobStatus<T> {
  const activeId = activeJobs.get(repoKey);
  const active = activeId ? jobs.get(activeId) : undefined;
  if (active?.kind === kind) return active as JobStatus<T>;
  const queue = queuedJobs.get(repoKey);
  const existingQueued = queue?.find((item) => item.status.kind === kind);
  if (existingQueued) return existingQueued.status as JobStatus<T>;

  const job = makeJob<T>(kind);
  jobs.set(job.id, job);
  const queued = { status: job as JobStatus, work: work as JobWork<unknown> };
  if (active) queuedJobs.set(repoKey, [...(queue ?? []), queued]);
  else {
    activeJobs.set(repoKey, job.id);
    runJob(repoKey, job, work);
  }
  return job;
}

export function getJob<T = unknown>(jobId: string): JobStatus<T> | null {
  const job = jobs.get(jobId);
  return job ? { ...job } as JobStatus<T> : null;
}