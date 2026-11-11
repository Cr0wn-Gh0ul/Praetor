import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_BRANCH_PREFIX,
  MARKERS,
  RUNTIME_VERSION,
  SYSTEM_PROMPT,
  buildPlanPrompt,
  checkReadablePath,
  checkWritablePath,
  countMarked,
  createOpenRouterChat,
  createToolExecutor,
  extractPlannedPaths,
  formatMeta,
  issueNumberFromBranch,
  latestMarked,
  parseMeta,
  replaceAgentLabel,
  runStage,
  runToolLoop,
} from "./codeless-agent.mjs";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDir(prefix: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

function sh(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
}

/** A checkout with a local bare repository as origin so pushes work offline. */
function createCheckout(files: Record<string, string>) {
  const remote = tempDir("codeless-remote-");
  sh(remote, "init", "--quiet", "--bare", "--initial-branch=main");
  const root = tempDir("codeless-checkout-");
  sh(root, "init", "--quiet", "--initial-branch=main");
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  sh(root, "add", "-A");
  sh(root, "commit", "--quiet", "-m", "initial");
  sh(root, "remote", "add", "origin", remote);
  sh(root, "push", "--quiet", "origin", "main");
  return { root, remote };
}

describe("runtime header", () => {
  it("declares the same version in its managed marker", () => {
    const source = readFileSync(path.join(__dirname, "codeless-agent.mjs"), "utf8");
    expect(source.split("\n")[0]).toBe(`// praetor-managed: v${RUNTIME_VERSION}`);
  });
});

describe("plan parsing and markers", () => {
  it("extracts repo-relative paths from the Files to change section", () => {
    expect(extractPlannedPaths("## Steps\n1. x\n## Files to change\n- `src/lib/foo.ts`: update helper\n- README.md\n## Risks\n- `src/other.ts`"))
      .toEqual(["src/lib/foo.ts", "README.md"]);
    expect(extractPlannedPaths("No files section")).toEqual([]);
  });

  it("reads agent branches, labels, and comment markers", () => {
    expect(issueNumberFromBranch(`${AGENT_BRANCH_PREFIX}42`)).toBe(42);
    expect(issueNumberFromBranch("agent/issue-0")).toBeNull();
    expect(issueNumberFromBranch("feature/x")).toBeNull();
    expect(replaceAgentLabel(["bug", "agent: planning"], "coding")).toEqual(["bug", "agent: coding"]);
    const comments = [{ body: `${MARKERS.plan}\nold` }, { body: "chatter" }, { body: `${MARKERS.plan}\nnew` }, { body: `${MARKERS.ciFix}1 -->\nx` }];
    expect(latestMarked(comments, MARKERS.plan)).toBe("new");
    expect(countMarked(comments, MARKERS.ciFix)).toBe(1);
    expect(countMarked([{ body: MARKERS.ciFixLimit }], MARKERS.ciFix)).toBe(0);
  });

  it("round-trips metadata without breaking out of the HTML comment", () => {
    const meta = formatMeta({ codeModel: "a/b", note: "--> sneaky" });
    expect(meta).not.toContain("--> sneaky");
    expect(parseMeta(`text\n${meta}`)).toEqual({ codeModel: "a/b", note: "--> sneaky" });
    expect(parseMeta("<!-- agent:meta {broken -->")).toBeNull();
  });
});

describe("generated agent prompts", () => {
  it("avoids em-dash punctuation and keeps parseable plan headings", () => {
    const prompt = buildPlanPrompt({ issue: { number: 1, title: "Improve reports", body: "" }, previousPlan: "", feedback: "" });
    expect(SYSTEM_PROMPT).toContain("Do not use em dash punctuation");
    expect(prompt).toContain("## Files to change\n");
    expect(prompt).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("path guards", () => {
  const allowed = new Set(["src/app.ts", "docs/guide.md"]);

  it("allows reading normal files but not secrets or escapes", () => {
    expect(checkReadablePath("./src//app.ts")).toBe("src/app.ts");
    expect(() => checkReadablePath(".env.local")).toThrow(/secrets/);
    expect(() => checkReadablePath("../etc/passwd")).toThrow(/leave/);
    expect(() => checkReadablePath("/etc/passwd")).toThrow(/relative/);
    expect(() => checkReadablePath(".git/config")).toThrow(/off limits/);
  });

  it("only allows writing files from the approved plan", () => {
    expect(checkWritablePath("src/app.ts", allowed)).toBe("src/app.ts");
    expect(() => checkWritablePath("src/other.ts", allowed)).toThrow(/not in the approved plan/);
    expect(() => checkWritablePath(".github/workflows/ci.yml", new Set([".github/workflows/ci.yml"]))).toThrow(/setup pull request/);
    expect(() => checkWritablePath(".github/praetor/agent.mjs", new Set([".github/praetor/agent.mjs"]))).toThrow(/setup pull request/);
    expect(() => checkWritablePath(".github/codeless/agent.mjs", new Set([".github/codeless/agent.mjs"]))).toThrow(/setup pull request/);
    expect(() => checkWritablePath("node_modules/x/index.js", new Set(["node_modules/x/index.js"]))).toThrow(/Dependencies/);
  });
});

describe("tool executor", () => {
  it("lists, reads, searches, writes, and deletes within the checkout", () => {
    const { root } = createCheckout({ "src/app.ts": "export const answer = 41;\n", "src/.env": "TOKEN=1", "README.md": "# Demo\n" });
    const tools = createToolExecutor(root, new Set(["src/app.ts", "src/new.ts", "README.md"]));

    expect(tools.execute("list_files", {})).not.toContain(".env");
    expect(tools.execute("list_files", { path: "src" })).toBe("src/app.ts");
    expect(tools.execute("read_file", { path: "src/app.ts" })).toContain("export const answer = 41;");
    expect(tools.execute("search", { query: "answer" })).toContain("src/app.ts:1:");
    expect(tools.execute("search", { query: "nothing-matches-this" })).toBe("No matches.");
    expect(() => tools.execute("read_file", { path: "src/.env" })).toThrow(/secrets/);

    tools.execute("write_file", { path: "src/new.ts", content: "export {};\n" });
    tools.execute("delete_file", { path: "README.md" });
    expect(readFileSync(path.join(root, "src/new.ts"), "utf8")).toBe("export {};\n");
    expect([...tools.changed].sort()).toEqual(["README.md", "src/new.ts"]);
    expect(() => tools.execute("write_file", { path: "src/other.ts", content: "" })).toThrow(/approved plan/);
  });

  it("refuses to follow symlinks out of the repository", () => {
    const { root } = createCheckout({ "src/app.ts": "x" });
    const outside = tempDir("codeless-outside-");
    writeFileSync(path.join(outside, "notes.txt"), "classified");
    symlinkSync(outside, path.join(root, "linked"));
    const tools = createToolExecutor(root, new Set(["linked/notes.txt"]));
    expect(() => tools.execute("read_file", { path: "linked/notes.txt" })).toThrow(/outside the repository/);
    expect(() => tools.execute("write_file", { path: "linked/notes.txt", content: "x" })).toThrow(/outside the repository/);
  });
});

type Message = { role: string; content: unknown; tool_calls?: unknown[] };

function scriptedChat(replies: Array<{ content?: string; tool_calls?: Array<{ name: string; args: Record<string, unknown> }> }>) {
  const calls: Message[][] = [];
  let index = 0;
  const chat = vi.fn(async ({ messages }: { model: string; messages: Message[]; tools?: unknown[] }) => {
    calls.push(structuredClone(messages));
    const reply = replies[index++];
    if (!reply) throw new Error("No more scripted replies.");
    return {
      model: "test/model",
      message: {
        content: reply.content ?? null,
        tool_calls: reply.tool_calls?.map((call, position) => ({ id: `call_${index}_${position}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } })),
      },
    };
  });
  return { chat, calls };
}

describe("runToolLoop", () => {
  it("executes tools, reports errors back to the model, and stops at finish", async () => {
    const { chat, calls } = scriptedChat([
      { tool_calls: [{ name: "read_file", args: { path: "a.ts" } }, { name: "explode", args: {} }] },
      { tool_calls: [{ name: "finish", args: { summary: "All done." } }] },
    ]);
    const execute = vi.fn((name: string) => {
      if (name === "explode") throw new Error("boom");
      return "contents";
    });
    const result = await runToolLoop({ chat, model: "m", system: "s", prompt: "p", tools: [], execute });
    expect(result.text).toBe("All done.");
    const toolMessages = calls[1]!.filter((message) => message.role === "tool").map((message) => message.content);
    expect(toolMessages).toEqual(["contents", "Error: boom"]);
  });

  it("nudges once when changes are required but none were made", async () => {
    const { chat } = scriptedChat([{ content: "I think it's fine." }, { content: "Still fine." }]);
    const result = await runToolLoop({ chat, model: "m", system: "s", prompt: "p", tools: [], execute: () => "", requireChanges: true, hasChanges: () => false });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("Still fine.");
  });

  it("gives up after the step limit", async () => {
    const chat = vi.fn(async () => ({ model: "m", message: { content: null, tool_calls: [{ id: "x", type: "function", function: { name: "list_files", arguments: "{}" } }] } }));
    await expect(runToolLoop({ chat, model: "m", system: "s", prompt: "p", tools: [], execute: () => "", maxSteps: 3 })).rejects.toThrow(/within 3 steps/);
  });
});

describe("OpenRouter client", () => {
  it("retries rate limits and surfaces clear errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { message: "slow down" } }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ model: "x/y", choices: [{ message: { content: "hi" } }] }));
    const chat = createOpenRouterChat({ apiKey: "key", repository: "o/r", fetchImpl, sleep: async () => undefined });
    await expect(chat({ model: "x/y", messages: [], tools: undefined })).resolves.toMatchObject({ message: { content: "hi" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const rejecting = createOpenRouterChat({ apiKey: "key", repository: "o/r", fetchImpl: async () => Response.json({ error: { message: "bad key" } }, { status: 401 }), sleep: async () => undefined });
    await expect(rejecting({ model: "x/y", messages: [], tools: undefined })).rejects.toThrow(/rejected the API key/);
    expect(() => createOpenRouterChat({ apiKey: "", repository: "o/r" })).toThrow(/OPENROUTER_API_KEY/);
  });
});

function fakeGitHub(initialLabels: string[], initialComments: string[] = []) {
  const state = {
    labels: [...initialLabels],
    comments: initialComments.map((body) => ({ body })),
    dispatched: [] as Array<{ workflow: string; ref: string }>,
  };
  const github = {
    getIssue: vi.fn(async (number: number) => ({ number, title: "Add greeting", body: "Say hello.", labels: state.labels.map((name) => ({ name })) })),
    listComments: vi.fn(async () => state.comments),
    comment: vi.fn(async (_number: number, body: string) => { state.comments.push({ body }); }),
    setLabels: vi.fn(async (_number: number, labels: string[]) => { state.labels = labels; }),
    dispatch: vi.fn(async (workflow: string, ref: string) => { state.dispatched.push({ workflow, ref }); }),
    listRunJobs: vi.fn(async () => ({ jobs: [{ id: 7, name: "Install and test", conclusion: "failure" }] })),
    jobLog: vi.fn(async () => "Error: expected hello"),
  };
  return { github, state };
}

const PLAN = "## Summary\nAdd a greeting.\n\n## Files to change\n- `src/greet.ts`\n\n## Risks\nNone.";
const models = { plan: "p/m", code: "c/m", review: "r/m" };

describe("runStage", () => {
  it("posts a plan with a Files to change section", async () => {
    const { root } = createCheckout({ "src/index.ts": "export {};\n" });
    const { github, state } = fakeGitHub(["agent: planning"]);
    const { chat } = scriptedChat([{ tool_calls: [{ name: "list_files", args: {} }] }, { content: PLAN }]);
    const result = await runStage({ stage: "plan", issueNumber: 5, github, chat, root, log: () => {}, models, inputs: {}, token: "t", serverUrl: "https://github.com", runUrl: "https://run" });
    expect(result.summary).toMatch(/plan/);
    expect(state.comments.at(-1)?.body).toContain(MARKERS.plan);
    expect(parseMeta(state.comments.at(-1)?.body)).toMatchObject({ planModel: "p/m" });
  });

  it("refuses to plan outside the planning state", async () => {
    const { root } = createCheckout({ "a.txt": "a" });
    const { github } = fakeGitHub(["agent: coding"]);
    await expect(runStage({ stage: "plan", issueNumber: 5, github, chat: vi.fn(), root, log: () => {}, models, inputs: {}, token: "t", serverUrl: "", runUrl: "" })).rejects.toThrow(/planning/);
  });

  it("implements, reviews, commits, pushes, and starts CI", async () => {
    const { root, remote } = createCheckout({ "src/index.ts": "export {};\n" });
    const { github, state } = fakeGitHub(["agent: plan-approved"], [`${MARKERS.plan}\n${PLAN}`]);
    const { chat } = scriptedChat([
      { tool_calls: [{ name: "write_file", args: { path: "src/greet.ts", content: "export const greet = () => \"hello\";\n" } }] },
      { tool_calls: [{ name: "finish", args: { summary: "Added a greeting helper." } }] },
      { content: "**Verdict:** Looks good." },
    ]);
    await runStage({ stage: "code", issueNumber: 5, github, chat, root, log: () => {}, models, inputs: {}, token: "t", serverUrl: "https://github.com", runUrl: "https://run" });

    expect(state.labels).toContain("agent: code-review");
    expect(sh(remote, "show", "agent/issue-5:src/greet.ts")).toContain("hello");
    const review = state.comments.at(-1)!.body;
    expect(review).toContain(MARKERS.selfReview);
    expect(review).toContain("`src/greet.ts` (added)");
    expect(review).toContain("Looks good");
    expect(parseMeta(review)).toMatchObject({ codeModel: "c/m", reviewModel: "r/m" });
    expect(state.dispatched).toEqual([{ workflow: "praetor-ci.yml", ref: "agent/issue-5" }]);
  });

  it("restores the approved state when the build fails", async () => {
    const { root } = createCheckout({ "src/index.ts": "x" });
    const { github, state } = fakeGitHub(["agent: plan-approved"], [`${MARKERS.plan}\n${PLAN}`]);
    const { chat } = scriptedChat([{ content: "nothing" }, { content: "still nothing" }]);
    await expect(runStage({ stage: "code", issueNumber: 5, github, chat, root, log: () => {}, models, inputs: {}, token: "t", serverUrl: "", runUrl: "" })).rejects.toThrow(/without changing/);
    expect(state.labels).toContain("agent: plan-approved");
  });

  it("refines the existing branch and repairs CI with a bounded number of attempts", async () => {
    const { root, remote } = createCheckout({ "src/greet.ts": "export const greet = () => \"hi\";\n" });
    sh(root, "push", "--quiet", "origin", "main:agent/issue-5");
    sh(root, "fetch", "--quiet", "origin");
    const { github, state } = fakeGitHub(["agent: code-review"], [`${MARKERS.plan}\n${PLAN}`, formatMeta({ codeModel: "remembered/model" })]);

    const refineChat = scriptedChat([
      { tool_calls: [{ name: "write_file", args: { path: "src/greet.ts", content: "export const greet = () => \"hey\";\n" } }, { name: "finish", args: { summary: "Changed the word." } }] },
    ]);
    await runStage({ stage: "refine", issueNumber: 5, github, chat: refineChat.chat, root, log: () => {}, models, inputs: { instruction: "Say hey" }, token: "t", serverUrl: "", runUrl: "" });
    expect(sh(remote, "show", "agent/issue-5:src/greet.ts")).toContain("hey");
    expect(state.comments.at(-1)?.body).toContain(MARKERS.refine);

    sh(root, "fetch", "--quiet", "origin");
    const fixChat = scriptedChat([
      { tool_calls: [{ name: "write_file", args: { path: "src/greet.ts", content: "export const greet = () => \"hello\";\n" } }, { name: "finish", args: { summary: "Fixed the expected word." } }] },
    ]);
    await runStage({ stage: "ci-fix", issueNumber: 5, github, chat: fixChat.chat, root, log: () => {}, models: { ...models, code: "fallback/model" }, inputs: { ciRunId: "99" }, token: "t", serverUrl: "", runUrl: "" });
    // The refinement recorded the model it used, so the repair reuses it instead of the fallback.
    expect(fixChat.chat.mock.calls[0]![0].model).toBe("c/m");
    expect(state.comments.at(-1)?.body).toContain(`${MARKERS.ciFix}99 -->`);

    const duplicate = await runStage({ stage: "ci-fix", issueNumber: 5, github, chat: vi.fn(), root, log: () => {}, models, inputs: { ciRunId: "99" }, token: "t", serverUrl: "", runUrl: "" });
    expect(duplicate.summary).toMatch(/already handled/);

    state.comments.push({ body: `${MARKERS.ciFix}100 -->` }, { body: `${MARKERS.ciFix}101 -->` });
    const limited = await runStage({ stage: "ci-fix", issueNumber: 5, github, chat: vi.fn(), root, log: () => {}, models, inputs: { ciRunId: "102" }, token: "t", serverUrl: "", runUrl: "" });
    expect(limited.summary).toMatch(/limit/);
    expect(state.labels).toContain("agent: needs-human");
  });

  it("marks merged agent pull requests as done once", async () => {
    const { github, state } = fakeGitHub(["agent: pr-created"]);
    await runStage({ stage: "merged", issueNumber: 0, github, chat: null, root: ".", log: () => {}, models, inputs: { prBranch: "agent/issue-5" }, token: "t", serverUrl: "", runUrl: "" });
    expect(state.labels).toContain("agent: done");
    const again = await runStage({ stage: "merged", issueNumber: 0, github, chat: null, root: ".", log: () => {}, models, inputs: { prBranch: "agent/issue-5" }, token: "t", serverUrl: "", runUrl: "" });
    expect(again.summary).toMatch(/already/);
    expect(state.comments.filter((comment) => comment.body.includes(MARKERS.merged))).toHaveLength(1);
  });
});
