export const DATA_DIRECTORY = "/data";
export const LOCAL_DATA_DIRECTORY = "./.data";

export const AGENT_STATES = [
  "planning",
  "plan-approved",
  "coding",
  "code-review",
  "pr-created",
  "needs-human",
  "done",
] as const;

export const AGENT_LABELS: Record<AgentStateName, { color: string; description: string }> = {
  planning: { color: "4de5ff", description: "An implementation plan is being generated or revised." },
  "plan-approved": { color: "65eac7", description: "The plan is approved and ready for the agent to build." },
  coding: { color: "a4aaff", description: "The agent is generating code changes from the approved plan." },
  "code-review": { color: "ff78c7", description: "Generated changes are ready for review before opening a pull request." },
  "pr-created": { color: "8da7ff", description: "A pull request is open; checks and merge are pending." },
  "needs-human": { color: "ff6d9d", description: "Automation is paused and needs human review before continuing." },
  done: { color: "65eac7", description: "The pull request has been merged." },
};

export type AgentStateName = (typeof AGENT_STATES)[number];

export const AGENT_BRANCH_PREFIX = "agent/issue-";
export const MAX_CI_FIX_ATTEMPTS = 3;
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;
export const EMBEDDING_BATCH_SIZE = 32;
export const MAX_RETRIEVAL_CONTEXT_CHARACTERS = 24_000;
export const MAX_FULL_FILE_CHARACTERS = 60_000;

export const COMMENT_MARKERS = {
  plan: "<!-- agent:plan -->",
  selfReview: "<!-- agent:self-review -->",
  refine: "<!-- agent:refine -->",
  ciFix: "<!-- agent:ci-fix:",
  merged: "<!-- agent:merged -->",
  error: "<!-- agent:error -->",
} as const;

/** Matches OpenRouter model IDs such as `anthropic/claude-sonnet-4` or `~openai/gpt-latest`. */
export const MODEL_ID_PATTERN = /^~?[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/;

export const MODEL_STAGES = {
  draft: { label: "Drafting", description: "Turns ideas into structured GitHub issues.", structured: false },
  plan: { label: "Planning", description: "Writes the implementation plan you approve.", structured: false },
  code: { label: "Coding", description: "Generates file changes and refinements.", structured: true },
  review: { label: "Agent review", description: "Checks generated changes before commit.", structured: true },
} as const;

export const DEFAULT_MODELS = {
  draft: "google/gemini-2.5-flash",
  plan: "google/gemini-2.5-flash",
  code: "~anthropic/claude-sonnet-latest",
  review: "~anthropic/claude-sonnet-latest",
} as const;

export type ModelStage = keyof typeof DEFAULT_MODELS;