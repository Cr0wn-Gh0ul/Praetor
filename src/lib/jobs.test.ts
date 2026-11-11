import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getJob, startRepoJob } from "./jobs";

describe("repository job queue", () => {
  it("serializes different job kinds and coalesces duplicate kinds", async () => {
    let releaseFirst: (() => void) | undefined;
    const first = startRepoJob("repo-a", "index", () => new Promise<void>((resolve) => { releaseFirst = resolve; }));
    const duplicate = startRepoJob("repo-a", "index", async () => undefined);
    const second = startRepoJob("repo-a", "ci-fix", async () => "fixed");

    expect(duplicate.id).toBe(first.id);
    expect(second.status).toBe("queued");
    await vi.waitFor(() => expect(getJob(first.id)?.status).toBe("running"));
    releaseFirst?.();
    await vi.waitFor(() => expect(getJob(second.id)?.status).toBe("completed"));
    expect(getJob(second.id)?.result).toBe("fixed");
  });
});