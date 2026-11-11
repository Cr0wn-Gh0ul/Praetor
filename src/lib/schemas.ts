import { z } from "zod";
import { AGENT_STATES, DEFAULT_MODELS, MODEL_ID_PATTERN } from "./constants";

export const agentStateSchema = z.enum(AGENT_STATES);
export const repoNameSchema = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).refine((value) => value.split("/").every((part) => part !== "." && part !== ".." && part.toLowerCase() !== ".git"));

const repoPathSchema = z.string().trim().min(1).max(500).refine((value) => {
  const normalized = value.replaceAll("\\", "/");
  return !normalized.startsWith("/")
    && !/^[A-Za-z]:/.test(normalized)
    && normalized !== "."
    && !normalized.split("/").some((part) => part === ".." || part === ".git");
}, "Context paths must stay within the repository and cannot include .git.");

export const contextPathSchema = repoPathSchema.refine((value) => {
  const normalized = value.replaceAll("\\", "/");
  return ![
    /(^|\/)\.env(\.|$)/i,
    /(^|\/)\.npmrc$/i,
    /(^|\/)\.netrc$/i,
    /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
    /\.(pem|key|p12|pfx|keystore|jks)$/i,
    /(^|\/)(secrets?|credentials?)(\.[a-z]+)?$/i,
  ].some((pattern) => pattern.test(normalized));
}, "Context paths cannot include secrets or credentials.");

export const contextSourceSchema = z.object({
  repo: repoNameSchema.optional(),
  paths: z.array(contextPathSchema).min(1).max(100),
}).strict();

export const agentConfigFileSchema = z.object({
  version: z.literal(1),
  include: z.array(z.string().min(1)),
  exclude: z.array(z.string()),
  installCommand: z.string().min(1),
  testCommand: z.string().min(1),
  nodeVersion: z.string().min(1),
  baseBranch: z.string().min(1),
  contextSources: z.array(contextSourceSchema).max(20).default([]),
});

export const githubAuthSchema = z.object({
  method: z.literal("app"),
  accessToken: z.string().min(1),
  refreshToken: z.string().default(""),
  accessTokenExpiresAt: z.string().default(""),
  refreshTokenExpiresAt: z.string().default(""),
  login: z.string().default(""),
});

export const appConfigSchema = z.object({
  githubToken: z.string().default(""),
  githubAuth: githubAuthSchema.nullable().default(null),
  openRouterApiKey: z.string().default(""),
  targetRepo: z.string().default(""),
  baseBranch: z.string().default("main"),
  additionalContextPaths: z.array(contextPathSchema).max(100).default([]),
  models: z.object({
    draft: z.string().min(1).default(DEFAULT_MODELS.draft),
    plan: z.string().min(1).default(DEFAULT_MODELS.plan),
    code: z.string().min(1).default(DEFAULT_MODELS.code),
    review: z.string().min(1).default(DEFAULT_MODELS.review),
  }).default(DEFAULT_MODELS),
});

export const issueSummarySchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  state: z.enum(["open", "closed"]),
  htmlUrl: z.string().url(),
  updatedAt: z.string().datetime(),
  labels: z.array(z.string()),
});

export const issueDetailSchema = issueSummarySchema.extend({
  agentState: agentStateSchema.nullable(),
  latestPlan: z.string().nullable(),
  latestSelfReview: z.string().nullable(),
  latestAgentError: z.object({ message: z.string(), createdAt: z.string().datetime() }).nullable(),
  pullRequest: z.object({
    number: z.number().int().positive(),
    htmlUrl: z.string().url(),
    state: z.enum(["open", "closed", "merged"]),
    headRef: z.string(),
    author: z.string(),
    ciStatus: z.enum(["pending", "success", "failure", "unknown"]),
    reviews: z.object({
      reviews: z.array(z.object({
        id: z.number().int(),
        reviewer: z.string(),
        avatarUrl: z.string().nullable(),
        state: z.enum(["approved", "changes-requested", "commented", "dismissed"]),
        body: z.string(),
        submittedAt: z.string().nullable(),
        htmlUrl: z.string(),
      })),
      requestedReviewers: z.array(z.string()),
      approvals: z.number().int().nonnegative(),
      changesRequested: z.number().int().nonnegative(),
      decision: z.enum(["none", "review-required", "approved", "changes-requested"]),
    }),
  }).nullable(),
  branchCiStatus: z.enum(["pending", "success", "failure", "unknown"]).nullable(),
});

/** OpenRouter model identifiers such as `anthropic/claude-sonnet-4` or `~openai/gpt-latest`. */
export const modelIdSchema = z.string().trim().min(3).max(200).regex(MODEL_ID_PATTERN, "Use an OpenRouter model ID such as provider/model.");

export const draftMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(20_000),
  model: z.string().max(200).optional(),
  sources: z.array(z.string().max(500)).max(50).optional(),
  createdAt: z.string().datetime(),
});

export const draftIssueSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  templateId: z.string().max(500).nullable().default(null),
  templateName: z.string().max(200).nullable().default(null),
  labels: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  messages: z.array(draftMessageSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const codeChunkSchema = z.object({
  id: z.string(),
  repoKey: z.string(),
  path: z.string(),
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  symbol: z.string(),
  text: z.string(),
  contentHash: z.string(),
  vector: z.array(z.number()),
});

export const jobStatusSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  progress: z.number().min(0).max(100),
  message: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});


const githubLoginSchema = z.string().trim().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "Use a GitHub username.");

export const requestReviewersSchema = z.object({
  reviewers: z.array(githubLoginSchema).min(1).max(15),
}).strict();

export const submitReviewSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("approve"), body: z.string().trim().max(8_000).optional() }).strict(),
  z.object({ event: z.literal("comment"), body: z.string().trim().min(1, "Add a comment.").max(8_000) }).strict(),
  z.object({ event: z.literal("request-changes"), body: z.string().trim().min(1, "Explain what needs to change.").max(8_000) }).strict(),
]);
