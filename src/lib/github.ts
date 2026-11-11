import "server-only";

import { Octokit } from "@octokit/rest";
import { AGENT_BRANCH_PREFIX, AGENT_LABELS, COMMENT_MARKERS } from "./constants";
import { getConfig, saveConfig } from "./config";
import { ciStatusFromRuns, excludeAgentRuns, type CiStatus, type WorkflowRunSummary } from "./ci-status";
import { getGitHubToken } from "./github-auth";
import { parseIssueTemplate, type IssueTemplate } from "./issue-templates";
import { EMPTY_REVIEW_SUMMARY, summarizeReviews } from "./reviews";
import type { AgentState, FileChange, IssueDetail, IssueSummary, PullRequestReviewSummary } from "./types";
import { initialIssueLabels, replaceAgentLabel, stateFromLabels } from "./state";

type GitHubContext = {
  octokit: Octokit;
  owner: string;
  repo: string;
};

export type AvailableRepository = {
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
};

export async function listAvailableRepositories(): Promise<AvailableRepository[]> {
  const octokit = await createOctokit();
  const repositories = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
    visibility: "all",
    affiliation: "owner,collaborator,organization_member",
    per_page: 100,
  });
  return repositories
    .filter((repository) => repository.permissions?.push === true)
    .map((repository) => ({
      fullName: repository.full_name,
      defaultBranch: repository.default_branch,
      isPrivate: repository.private,
    }))
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

export async function selectRepository(fullName: string): Promise<AvailableRepository> {
  const repository = (await listAvailableRepositories()).find((item) => item.fullName.toLowerCase() === fullName.toLowerCase());
  if (!repository) throw new Error("Select a repository you have write access to.");
  await saveConfig({ targetRepo: repository.fullName, baseBranch: repository.defaultBranch });
  return repository;
}

export async function createOctokit(): Promise<Octokit> {
  return new Octokit({ auth: await getGitHubToken(), userAgent: "codeless-ide" });
}

export async function createGitHubContext(): Promise<GitHubContext> {
  const config = await getConfig();
  const [owner, repo] = config.targetRepo.split("/");
  if (!owner || !repo) throw new Error("Choose a repository first.");
  return { octokit: await createOctokit(), owner, repo };
}

export function isNotFound(error: unknown): boolean {
  return error instanceof Error && "status" in error && error.status === 404;
}

function labelNames(labels: Array<string | { name?: string | null }>): string[] {
  return labels.flatMap((label) => {
    const name = typeof label === "string" ? label : label.name;
    return name ? [name] : [];
  });
}

function toIssueSummary(issue: Awaited<ReturnType<Octokit["rest"]["issues"]["get"]>>["data"]): IssueSummary {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    state: issue.state === "closed" ? "closed" : "open",
    htmlUrl: issue.html_url,
    updatedAt: issue.updated_at,
    labels: labelNames(issue.labels),
  };
}

export async function listAgentIssues(state: "open" | "closed" | "all" = "open", agentOnly = true): Promise<IssueSummary[]> {
  const { octokit, owner, repo } = await createGitHubContext();
  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, { owner, repo, state, per_page: 100 });
  return issues
    .filter((issue) => !issue.pull_request)
    .map(toIssueSummary)
    .filter((issue) => !agentOnly || issue.labels.some((label) => label.startsWith("agent: ")))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getIssue(issueNumber: number): Promise<IssueSummary> {
  const { octokit, owner, repo } = await createGitHubContext();
  const response = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
  if (response.data.pull_request) throw new Error(`Issue #${issueNumber} is a pull request, not an issue.`);
  return toIssueSummary(response.data);
}

const META_COMMENT = /\n*<!-- agent:meta \{[^\n]*?\} -->\s*$/;

function stripMeta(body: string): string {
  return body.replace(META_COMMENT, "").trimEnd();
}

export async function getIssueDetail(issueNumber: number): Promise<IssueDetail> {
  const issue = await getIssue(issueNumber);
  const [marked, pullRequest, branchCiStatus] = await Promise.all([
    getLatestMarkedComments(issueNumber, [COMMENT_MARKERS.plan, COMMENT_MARKERS.selfReview, COMMENT_MARKERS.error]),
    getPullRequestForIssue(issueNumber),
    getBranchCiStatus(`${AGENT_BRANCH_PREFIX}${issueNumber}`),
  ]);
  const plan = marked[COMMENT_MARKERS.plan];
  const review = marked[COMMENT_MARKERS.selfReview];
  const error = marked[COMMENT_MARKERS.error];
  const latestOther = [plan, review].reduce((latest, item) => (item && item.createdAt > latest ? item.createdAt : latest), "");
  return {
    ...issue,
    agentState: stateFromLabels(issue.labels),
    latestPlan: plan ? stripMeta(plan.body) : null,
    latestSelfReview: review ? stripMeta(review.body) : null,
    latestAgentError: error && error.createdAt > latestOther ? { message: error.body, createdAt: error.createdAt } : null,
    pullRequest,
    branchCiStatus,
  };
}

async function getBranchCiStatus(branch: string): Promise<CiStatus | null> {
  const { octokit, owner, repo } = await createGitHubContext();
  try {
    const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    return await getCiStatus(ref.data.object.sha, branch);
  } catch (error) {
    if (isNotFound(error)) return null;
    return "unknown";
  }
}

export async function getPullRequestForIssue(issueNumber: number): Promise<IssueDetail["pullRequest"]> {
  const { octokit, owner, repo } = await createGitHubContext();
  const response = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "all",
    head: `${owner}:${AGENT_BRANCH_PREFIX}${issueNumber}`,
    per_page: 1,
  });
  const pullRequest = response.data[0];
  if (!pullRequest) return null;
  const pullDetails = await octokit.rest.pulls.get({ owner, repo, pull_number: pullRequest.number });

  const [ciStatus, reviews] = await Promise.all([
    getCiStatus(pullRequest.head.sha, pullRequest.head.ref),
    getPullRequestReviews(pullRequest.number).catch(() => EMPTY_REVIEW_SUMMARY),
  ]);

  return {
    number: pullRequest.number,
    htmlUrl: pullRequest.html_url,
    state: pullDetails.data.merged ? "merged" : pullRequest.state === "closed" ? "closed" : "open",
    headRef: pullRequest.head.ref,
    author: pullRequest.user?.login ?? "Unknown",
    ciStatus,
    reviews,
  };
}

export async function getPullRequestReviews(pullNumber: number): Promise<PullRequestReviewSummary> {
  const { octokit, owner, repo } = await createGitHubContext();
  const [reviews, requested] = await Promise.all([
    octokit.paginate(octokit.rest.pulls.listReviews, { owner, repo, pull_number: pullNumber, per_page: 100 }),
    octokit.rest.pulls.listRequestedReviewers({ owner, repo, pull_number: pullNumber }),
  ]);
  return summarizeReviews(
    reviews.map((review) => ({
      id: review.id,
      reviewer: review.user?.login ?? "Unknown",
      avatarUrl: review.user?.avatar_url ?? null,
      state: review.state,
      body: review.body ?? "",
      submittedAt: review.submitted_at ?? null,
      htmlUrl: review.html_url,
    })),
    requested.data.users.map((user) => user.login),
  );
}

async function requireOpenPullRequest(issueNumber: number) {
  const pullRequest = await getPullRequestForIssue(issueNumber);
  if (!pullRequest || pullRequest.state !== "open") throw new Error("An open pull request was not found for this issue.");
  return pullRequest;
}

export async function requestPullRequestReviewers(issueNumber: number, reviewers: string[]): Promise<void> {
  const pullRequest = await requireOpenPullRequest(issueNumber);
  const { octokit, owner, repo } = await createGitHubContext();
  await octokit.rest.pulls.requestReviewers({ owner, repo, pull_number: pullRequest.number, reviewers });
}

export async function submitPullRequestReview(issueNumber: number, event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT", body: string): Promise<void> {
  const pullRequest = await requireOpenPullRequest(issueNumber);
  const { octokit, owner, repo } = await createGitHubContext();
  await octokit.rest.pulls.createReview({ owner, repo, pull_number: pullRequest.number, event, ...(body ? { body } : {}) });
}

/** CI status for a commit from Actions workflow runs, falling back to the Checks API when allowed. */
export async function getCiStatus(headSha: string, branch: string): Promise<CiStatus> {
  const { octokit, owner, repo } = await createGitHubContext();
  try {
    const response = await octokit.rest.actions.listWorkflowRunsForRepo({ owner, repo, branch, head_sha: headSha, per_page: 50 });
    const runs: WorkflowRunSummary[] = response.data.workflow_runs.map((run) => ({
      id: run.id,
      name: run.name ?? "",
      workflowId: run.workflow_id,
      status: run.status,
      conclusion: run.conclusion,
      headSha: run.head_sha,
      createdAt: run.created_at,
    }));
    const status = ciStatusFromRuns(excludeAgentRuns(runs), headSha);
    if (status !== "unknown") return status;
  } catch {
    // Fall through to commit statuses.
  }
  try {
    const statuses = await octokit.rest.repos.getCombinedStatusForRef({ owner, repo, ref: headSha });
    if (statuses.data.total_count === 0) return "unknown";
    if (statuses.data.state === "success") return "success";
    return statuses.data.state === "pending" ? "pending" : "failure";
  } catch {
    return "unknown";
  }
}

export async function mergePullRequest(issueNumber: number): Promise<void> {
  const pullRequest = await getPullRequestForIssue(issueNumber);
  if (!pullRequest || pullRequest.state !== "open") throw new Error("An open pull request was not found for this issue.");
  if (pullRequest.ciStatus !== "success") throw new Error("Pull request checks must pass before merging.");
  if (pullRequest.reviews.changesRequested > 0) throw new Error("A reviewer has requested changes. Resolve them before merging.");
  const { octokit, owner, repo } = await createGitHubContext();
  const result = await octokit.rest.pulls.merge({ owner, repo, pull_number: pullRequest.number, merge_method: "squash" });
  if (!result.data.merged) throw new Error("GitHub did not merge the pull request.");
}

export async function createIssue(title: string, body: string, state: AgentState | null = null, labels: string[] = []): Promise<IssueSummary> {
  const { octokit, owner, repo } = await createGitHubContext();
  await ensureAgentLabels();
  const response = await octokit.rest.issues.create({
    owner,
    repo,
    title,
    body,
    labels: initialIssueLabels(labels, state),
  });
  return toIssueSummary(response.data);
}

export async function listIssueTemplates(): Promise<IssueTemplate[]> {
  const { octokit, owner, repo } = await createGitHubContext();
  let entries;
  try {
    const response = await octokit.rest.repos.getContent({ owner, repo, path: ".github/ISSUE_TEMPLATE" });
    entries = Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const files = entries.filter((entry) => entry.type === "file"
    && /^\.github\/ISSUE_TEMPLATE\/[^/]+\.(?:md|ya?ml)$/i.test(entry.path)
    && entry.size <= 100_000);
  const templates = await Promise.all(files.map(async (entry) => {
    const response = await octokit.rest.repos.getContent({ owner, repo, path: entry.path });
    if (Array.isArray(response.data) || !("content" in response.data) || response.data.encoding !== "base64") return null;
    const source = Buffer.from(response.data.content, "base64").toString("utf8");
    return parseIssueTemplate(entry.path, entry.name, source);
  }));
  return templates.filter((template): template is IssueTemplate => template !== null);
}

export async function ensureAgentLabels(): Promise<void> {
  const { octokit, owner, repo } = await createGitHubContext();
  const response = await octokit.rest.issues.listLabelsForRepo({ owner, repo, per_page: 100 });
  const existing = new Map(response.data.map((label) => [label.name, label]));
  for (const [state, details] of Object.entries(AGENT_LABELS)) {
    const name = `agent: ${state}`;
    const current = existing.get(name);
    if (!current) {
      await octokit.rest.issues.createLabel({ owner, repo, name, color: details.color, description: details.description });
    } else if (current.color.toLowerCase() !== details.color.toLowerCase() || (current.description ?? "") !== details.description) {
      await octokit.rest.issues.updateLabel({ owner, repo, name, color: details.color, description: details.description });
    }
  }
}

export async function setAgentState(issueNumber: number, next: AgentState): Promise<void> {
  const { octokit, owner, repo } = await createGitHubContext();
  await ensureAgentLabels();
  const issue = await octokit.rest.issues.get({ owner, repo, issue_number: issueNumber });
  const labels = replaceAgentLabel(labelNames(issue.data.labels), next);
  await octokit.rest.issues.setLabels({ owner, repo, issue_number: issueNumber, labels });
}

export async function addMarkedComment(issueNumber: number, marker: string, body: string): Promise<void> {
  const { octokit, owner, repo } = await createGitHubContext();
  await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body: `${marker}\n${body}` });
}

export async function getLatestMarkedComment(issueNumber: number, marker: string): Promise<string | null> {
  const { octokit, owner, repo } = await createGitHubContext();
  const response = await octokit.rest.issues.listComments({ owner, repo, issue_number: issueNumber, per_page: 100 });
  const match = response.data.toReversed().find((comment) => comment.body?.includes(marker));
  return match?.body?.replace(marker, "").trimStart() ?? null;
}

export async function countMarkedComments(issueNumber: number, marker: string): Promise<number> {
  const { octokit, owner, repo } = await createGitHubContext();
  const response = await octokit.rest.issues.listComments({ owner, repo, issue_number: issueNumber, per_page: 100 });
  return response.data.filter((comment) => comment.body?.includes(marker)).length;
}

export async function commitFiles(branch: string, base: string, changes: FileChange[], message: string): Promise<string> {
  if (changes.length === 0) throw new Error("At least one file change is required.");
  for (const change of changes) {
    if (change.path.startsWith("/") || change.path.split("/").some((part) => part === ".." || part === ".git")) {
      throw new Error(`Unsafe repository path: ${change.path}`);
    }
  }

  const { octokit, owner, repo } = await createGitHubContext();
  let branchExists = true;
  let parentSha: string;
  try {
    const branchRef = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    parentSha = branchRef.data.object.sha;
  } catch (error) {
    if (!(error instanceof Error && "status" in error && error.status === 404)) throw error;
    branchExists = false;
    const baseRef = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${base}` });
    parentSha = baseRef.data.object.sha;
  }

  const parentCommit = await octokit.rest.git.getCommit({ owner, repo, commit_sha: parentSha });
  const tree = await Promise.all(changes.map(async (change) => {
    if (change.action === "delete") return { path: change.path, mode: "100644" as const, type: "blob" as const, sha: null };
    const blob = await octokit.rest.git.createBlob({ owner, repo, content: change.content, encoding: "utf-8" });
    return { path: change.path, mode: "100644" as const, type: "blob" as const, sha: blob.data.sha };
  }));

  const newTree = await octokit.rest.git.createTree({ owner, repo, base_tree: parentCommit.data.tree.sha, tree });
  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message,
    tree: newTree.data.sha,
    parents: [parentSha],
  });

  if (branchExists) {
    await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.data.sha, force: false });
  } else {
    await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.data.sha });
  }
  return commit.data.sha;
}

export async function createPullRequest(branch: string, base: string, title: string, body: string) {
  const { octokit, owner, repo } = await createGitHubContext();
  const existing = await octokit.rest.pulls.list({ owner, repo, state: "open", head: `${owner}:${branch}`, per_page: 1 });
  if (existing.data[0]) return existing.data[0];
  const response = await octokit.rest.pulls.create({ owner, repo, head: branch, base, title, body });
  return response.data;
}

export type FileDiff = {
  path: string;
  previousPath: string | null;
  status: string;
  original: string;
  modified: string;
};

async function getTextFile(octokit: Octokit, owner: string, repo: string, filePath: string, ref: string): Promise<string> {
  try {
    const response = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref });
    const data = response.data;
    if (Array.isArray(data) || data.type !== "file" || data.size > 1_000_000 || data.encoding !== "base64") return "";
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 404) return "";
    throw error;
  }
}

export async function compareBranch(base: string, head: string): Promise<FileDiff[]> {
  const { octokit, owner, repo } = await createGitHubContext();
  const comparison = await octokit.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${base}...${head}` });
  const textFiles = comparison.data.files?.filter((file) => !file.filename.startsWith(".github/workflows/")) ?? [];
  return Promise.all(textFiles.map(async (file) => {
    const originalPath = file.previous_filename ?? file.filename;
    const [original, modified] = await Promise.all([
      file.status === "added" ? Promise.resolve("") : getTextFile(octokit, owner, repo, originalPath, base),
      file.status === "removed" ? Promise.resolve("") : getTextFile(octokit, owner, repo, file.filename, head),
    ]);
    return {
      path: file.filename,
      previousPath: file.previous_filename ?? null,
      status: file.status,
      original,
      modified,
    };
  }));
}

/** Reads a text file on a branch, returning null when it does not exist. */
export async function readRepoTextFile(filePath: string, ref: string): Promise<string | null> {
  const { octokit, owner, repo } = await createGitHubContext();
  try {
    const response = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref });
    const data = response.data;
    if (Array.isArray(data) || data.type !== "file" || data.encoding !== "base64") return null;
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Lists repository file paths from a branch without downloading file contents. */
export async function listRepositoryFilePaths(ref: string): Promise<string[]> {
  const { octokit, owner, repo } = await createGitHubContext();
  const branch = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${ref}` });
  const commit = await octokit.rest.git.getCommit({ owner, repo, commit_sha: branch.data.object.sha });
  const tree = await octokit.rest.git.getTree({ owner, repo, tree_sha: commit.data.tree.sha, recursive: "true" });
  if (tree.data.truncated) throw new Error("Could not inspect the full repository tree for package manifests.");
  return tree.data.tree.flatMap((entry) => entry.type === "blob" && entry.path ? [entry.path] : []);
}

export async function getOpenPullRequestForBranch(branch: string) {
  const { octokit, owner, repo } = await createGitHubContext();
  const response = await octokit.rest.pulls.list({ owner, repo, state: "open", head: `${owner}:${branch}`, per_page: 1 });
  const pullRequest = response.data[0];
  return pullRequest ? { number: pullRequest.number, htmlUrl: pullRequest.html_url, headSha: pullRequest.head.sha } : null;
}

/** Commits `changes` on a fresh branch from `base`, replacing any earlier commits on that branch. */
export async function replaceBranchWithCommit(branch: string, base: string, changes: FileChange[], message: string): Promise<void> {
  const { octokit, owner, repo } = await createGitHubContext();
  try {
    await octokit.rest.git.deleteRef({ owner, repo, ref: `heads/${branch}` });
  } catch (error) {
    if (!isNotFound(error) && !(error instanceof Error && "status" in error && error.status === 422)) throw error;
  }
  await commitFiles(branch, base, changes, message);
}

export async function hasRepositorySecret(name: string): Promise<boolean | null> {
  const { octokit, owner, repo } = await createGitHubContext();
  try {
    await octokit.rest.actions.getRepoSecret({ owner, repo, secret_name: name });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    return null;
  }
}

/** Encrypts and stores an Actions secret. The value never leaves this server unencrypted. */
export async function setRepositorySecret(name: string, value: string): Promise<void> {
  const { octokit, owner, repo } = await createGitHubContext();
  const { data: key } = await octokit.rest.actions.getRepoPublicKey({ owner, repo });
  const sodium = (await import("libsodium-wrappers")).default;
  await sodium.ready;
  const encrypted = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL));
  await octokit.rest.actions.createOrUpdateRepoSecret({ owner, repo, secret_name: name, encrypted_value: sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL), key_id: key.key_id });
}

export async function dispatchWorkflow(workflowFile: string, ref: string, inputs: Record<string, string>): Promise<void> {
  const { octokit, owner, repo } = await createGitHubContext();
  await octokit.rest.actions.createWorkflowDispatch({ owner, repo, workflow_id: workflowFile, ref, inputs });
}

export type AgentRun = {
  id: number;
  title: string;
  workflow: string;
  branch: string;
  status: "queued" | "in_progress" | "completed" | "waiting" | "unknown";
  conclusion: string | null;
  event: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
};

function toRunStatus(status: string | null): AgentRun["status"] {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "in_progress";
  if (status === "queued" || status === "requested" || status === "pending") return "queued";
  if (status === "waiting" || status === "action_required") return "waiting";
  return "unknown";
}

/** Recent runs of a workflow file. Returns null when the workflow does not exist on the default branch. */
export async function listWorkflowRuns(workflowFile: string, perPage = 30): Promise<AgentRun[] | null> {
  const { octokit, owner, repo } = await createGitHubContext();
  try {
    const response = await octokit.rest.actions.listWorkflowRuns({ owner, repo, workflow_id: workflowFile, per_page: perPage });
    return response.data.workflow_runs.map((run) => ({
      id: run.id,
      title: run.display_title,
      workflow: run.name ?? "",
      branch: run.head_branch ?? "",
      status: toRunStatus(run.status),
      conclusion: run.conclusion,
      event: run.event,
      htmlUrl: run.html_url,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
    }));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function listRepositoryWorkflowRuns(perPage = 100): Promise<AgentRun[]> {
  const { octokit, owner, repo } = await createGitHubContext();
  const response = await octokit.rest.actions.listWorkflowRunsForRepo({ owner, repo, per_page: perPage });
  return response.data.workflow_runs.map((run) => ({
    id: run.id,
    title: run.display_title,
    workflow: run.name ?? "",
    branch: run.head_branch ?? "",
    status: toRunStatus(run.status),
    conclusion: run.conclusion,
    event: run.event,
    htmlUrl: run.html_url,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  }));
}

export type WorkspacePullRequest = {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  htmlUrl: string;
  author: string;
  branch: string;
  updatedAt: string;
  ciStatus: CiStatus;
};

export async function listWorkspacePullRequests(state: "open" | "closed" | "all" = "open"): Promise<WorkspacePullRequest[]> {
  const { octokit, owner, repo } = await createGitHubContext();
  const [pulls, workflowResponse] = await Promise.all([
    octokit.rest.pulls.list({ owner, repo, state, per_page: 100 }),
    octokit.rest.actions.listWorkflowRunsForRepo({ owner, repo, per_page: 100 }),
  ]);
  const runs: WorkflowRunSummary[] = workflowResponse.data.workflow_runs.map((run) => ({
    id: run.id,
    name: run.name ?? "",
    workflowId: run.workflow_id,
    status: run.status,
    conclusion: run.conclusion,
    headSha: run.head_sha,
    createdAt: run.created_at,
  }));
  return pulls.data.map((pull) => ({
    number: pull.number,
    title: pull.title,
    state: pull.merged_at ? "merged" : pull.state === "closed" ? "closed" : "open",
    htmlUrl: pull.html_url,
    author: pull.user?.login ?? "Unknown",
    branch: pull.head.ref,
    updatedAt: pull.updated_at,
    ciStatus: ciStatusFromRuns(excludeAgentRuns(runs), pull.head.sha),
  }));
}

export async function getLatestMarkedComments(issueNumber: number, markers: string[]): Promise<Record<string, { body: string; createdAt: string } | null>> {
  const { octokit, owner, repo } = await createGitHubContext();
  const comments = await octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number: issueNumber, per_page: 100 });
  const result: Record<string, { body: string; createdAt: string } | null> = {};
  for (const marker of markers) {
    const match = comments.toReversed().find((comment) => comment.body?.includes(marker));
    result[marker] = match?.body ? { body: match.body.replace(marker, "").trimStart(), createdAt: match.created_at } : null;
  }
  return result;
}

export const MARKERS = COMMENT_MARKERS;