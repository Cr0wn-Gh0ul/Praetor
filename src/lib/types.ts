import type { AgentStateName } from "./constants";

export type AgentState = AgentStateName;

export interface AgentConfigFile {
  version: 1;
  include: string[];
  exclude: string[];
  installCommand: string;
  testCommand: string;
  nodeVersion: string;
  baseBranch: string;
  contextSources: { repo?: string; paths: string[] }[];
}

export interface GitHubAuth {
  method: "app";
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  login: string;
}

export interface AppConfig {
  githubToken: string;
  githubAuth: GitHubAuth | null;
  openRouterApiKey: string;
  targetRepo: string;
  baseBranch: string;
  additionalContextPaths: string[];
  models: {
    draft: string;
    plan: string;
    code: string;
    review: string;
  };
}

export interface PublicAppConfig {
  github: {
    method: "app" | "token" | "none";
    login: string;
    /** True when the token comes from the GITHUB_TOKEN environment variable and cannot be changed in the UI. */
    fromEnvironment: boolean;
  };
  openRouterApiKeyMasked: string;
  targetRepo: string;
  baseBranch: string;
  additionalContextPaths: string[];
  models: AppConfig["models"];
}

export interface IssueSummary {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  htmlUrl: string;
  updatedAt: string;
  labels: string[];
}

export type CiStatusValue = "pending" | "success" | "failure" | "unknown";

export type ReviewState = "approved" | "changes-requested" | "commented" | "dismissed";

export interface PullRequestReview {
  id: number;
  reviewer: string;
  avatarUrl: string | null;
  state: ReviewState;
  body: string;
  submittedAt: string | null;
  htmlUrl: string;
}

export interface PullRequestReviewSummary {
  /** Latest standing review from each reviewer who has reviewed. */
  reviews: PullRequestReview[];
  /** Requested reviewers who have not yet approved or requested changes. */
  requestedReviewers: string[];
  approvals: number;
  changesRequested: number;
  decision: "none" | "review-required" | "approved" | "changes-requested";
}

export interface IssueDetail extends IssueSummary {
  agentState: AgentState | null;
  latestPlan: string | null;
  latestSelfReview: string | null;
  /** Most recent agent failure, if it happened after the latest plan or review. */
  latestAgentError: { message: string; createdAt: string } | null;
  pullRequest: {
    number: number;
    htmlUrl: string;
    state: "open" | "closed" | "merged";
    headRef: string;
    author: string;
    ciStatus: CiStatusValue;
    reviews: PullRequestReviewSummary;
  } | null;
  /** CI status for the agent branch before a pull request exists, or null when there is no branch. */
  branchCiStatus: CiStatusValue | null;
}

export interface DraftMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  sources?: string[];
  createdAt: string;
}

export interface DraftIssue {
  id: string;
  title: string;
  body: string;
  templateId: string | null;
  templateName: string | null;
  labels: string[];
  messages: DraftMessage[];
  createdAt: string;
  updatedAt: string;
}

/** A normalized OpenRouter model entry safe to send to the browser. */
export interface ModelOption {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextLength: number | null;
  /** USD per one million prompt tokens, or null when unknown. */
  promptPrice: number | null;
  /** USD per one million completion tokens, or null when unknown. */
  completionPrice: number | null;
  structuredOutput: boolean;
  created: number;
}

export interface ModelCatalog {
  models: ModelOption[];
  fetchedAt: string;
}

export interface CodeChunk {
  id: string;
  repoKey: string;
  path: string;
  startLine: number;
  endLine: number;
  symbol: string;
  text: string;
  contentHash: string;
  vector: number[];
}

export interface RetrievedChunk extends Omit<CodeChunk, "vector"> {
  score: number;
}

export type FileChange =
  | { path: string; action: "create" | "update"; content: string }
  | { path: string; action: "delete" };

export interface JobStatus<T = unknown> {
  id: string;
  kind: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  result?: T;
  error?: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}