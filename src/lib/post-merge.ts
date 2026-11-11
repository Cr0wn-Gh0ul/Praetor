import "server-only";

import { getConfig } from "./config";
import { addMarkedComment, getLatestMarkedComment, MARKERS, setAgentState } from "./github";
import { incrementalIndex } from "./indexer";
import { startRepoJob } from "./jobs";

export async function finalizeMergedIssue(issueNumber: number): Promise<void> {
  const existing = await getLatestMarkedComment(issueNumber, MARKERS.merged);
  if (existing) return;
  const config = await getConfig();
  await setAgentState(issueNumber, "done");
  startRepoJob(config.targetRepo.toLowerCase(), "post-merge-index", incrementalIndex);
  await addMarkedComment(issueNumber, MARKERS.merged, "Pull request merged. Repository context reindexing has been queued.");
}