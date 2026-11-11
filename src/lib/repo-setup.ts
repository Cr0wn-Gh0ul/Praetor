import "server-only";

import { compareSetupFile, generateAgentConfig, generateSetupFiles, LEGACY_SETUP_FILES, SETUP_FILES, SETUP_VERSIONS, summarizeSetup } from "./bootstrap";
import { getConfig } from "./config";
import { getOpenPullRequestForBranch, hasRepositorySecret, listRepositoryFilePaths, readRepoTextFile } from "./github";
import { agentConfigFileSchema } from "./schemas";

type NpmProject = { directory: string; hasLockfile: boolean; hasBuild: boolean; hasTest: boolean; hasTestFiles: boolean };

async function readNpmProject(directory: string, ref: string, paths: string[]): Promise<NpmProject | null> {
  const packagePath = directory ? `${directory}/package.json` : "package.json";
  const manifest = await readRepoTextFile(packagePath, ref);
  if (!manifest) return null;
  let scripts: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(manifest);
    if (parsed && typeof parsed === "object" && "scripts" in parsed && parsed.scripts && typeof parsed.scripts === "object") {
      scripts = parsed.scripts as Record<string, unknown>;
    }
  } catch {
    scripts = {};
  }
  const [packageLock, shrinkwrap] = await Promise.all([
    readRepoTextFile(directory ? `${directory}/package-lock.json` : "package-lock.json", ref),
    readRepoTextFile(directory ? `${directory}/npm-shrinkwrap.json` : "npm-shrinkwrap.json", ref),
  ]);
  const projectPrefix = directory ? `${directory}/` : "";
  const ignoredDirectories = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);
  const hasTestFiles = paths.some((filePath) => {
    if (projectPrefix && !filePath.startsWith(projectPrefix)) return false;
    const relativePath = projectPrefix ? filePath.slice(projectPrefix.length) : filePath;
    return /\.(?:spec|test)\.[cm]?[jt]sx?$/i.test(relativePath)
      && !relativePath.split("/").some((segment) => ignoredDirectories.has(segment));
  });
  return {
    directory,
    hasLockfile: Boolean(packageLock || shrinkwrap),
    hasBuild: typeof scripts.build === "string",
    hasTest: typeof scripts.test === "string",
    hasTestFiles,
  };
}

async function detectNpmCommands(ref: string): Promise<{ installCommand?: string; testCommand?: string }> {
  const paths = await listRepositoryFilePaths(ref);
  const ignoredDirectories = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);
  const packagePaths = paths.filter((filePath) => {
    if (!filePath.endsWith("package.json") || (filePath !== "package.json" && !filePath.endsWith("/package.json"))) return false;
    if (/[\u0000-\u001f]/.test(filePath)) return false;
    return !filePath.split("/").some((segment) => segment === ".." || ignoredDirectories.has(segment));
  });
  const projects = (await Promise.all(packagePaths.map(async (packagePath) => {
    const directory = packagePath === "package.json" ? "" : packagePath.slice(0, -"/package.json".length);
    return readNpmProject(directory, ref, paths);
  }))).filter((project): project is NpmProject => project !== null);
  if (projects.length === 0) return {};
  const prefix = (project: NpmProject) => project.directory ? ` --prefix='${project.directory.replace(/'/g, "'\\''")}'` : "";
  const installCommand = projects.map((project) => `npm ${project.hasLockfile ? "ci" : "install"}${prefix(project)}`).join(" && ");
  const checks = projects.flatMap((project) => [
    ...(project.hasBuild ? [`npm run build${prefix(project)}`] : []),
    ...(project.hasTest && project.hasTestFiles ? [`npm test${prefix(project)}`] : []),
  ]);
  return { installCommand, ...(checks.length ? { testCommand: checks.join(" && ") } : {}) };
}

export async function getRepositorySetup() {
  const appConfig = await getConfig();
  const ref = appConfig.baseBranch;
  const existingFiles = await Promise.all(Object.entries(SETUP_FILES).map(async ([key, filePath]) => [key, await readRepoTextFile(filePath, ref)] as const));
  const existing = Object.fromEntries(existingFiles);
  let parsedConfig: ReturnType<typeof agentConfigFileSchema.safeParse> | null = null;
  if (existing.config) {
    try {
      const parsed = agentConfigFileSchema.safeParse(JSON.parse(existing.config));
      if (parsed.success) {
        generateAgentConfig(parsed.data);
        parsedConfig = parsed;
      }
    } catch {
      parsedConfig = null;
    }
  }
  const saved = parsedConfig?.success ? parsedConfig.data : null;
  const detectedCommands = saved ? {} : await detectNpmCommands(ref);
  const options = generateAgentConfig({
    baseBranch: saved?.baseBranch ?? ref,
    contextSources: saved?.contextSources ?? [],
    include: saved?.include,
    exclude: saved?.exclude,
    installCommand: saved?.installCommand ?? detectedCommands.installCommand,
    testCommand: saved?.testCommand ?? detectedCommands.testCommand,
    nodeVersion: saved?.nodeVersion,
  });
  const generated = generateSetupFiles(options);
  const files = generated.map((file) => ({
    ...file,
    ...compareSetupFile(file.key, existing[file.key] ?? null, SETUP_VERSIONS[file.key], (text) => {
      try {
        const parsed = agentConfigFileSchema.safeParse(JSON.parse(text));
        if (!parsed.success) return false;
        generateAgentConfig(parsed.data);
        return true;
      } catch {
        return false;
      }
    }),
  }));
  const [hasOpenRouterSecret, setupPullRequest, legacy] = await Promise.all([
    hasRepositorySecret("OPENROUTER_API_KEY"),
    getOpenPullRequestForBranch("codeless/setup"),
    Promise.all(LEGACY_SETUP_FILES.map(async (filePath) => ({ path: filePath, exists: (await readRepoTextFile(filePath, ref)) !== null }))),
  ]);
  return {
    files,
    summary: summarizeSetup(files, hasOpenRouterSecret === true),
    hasOpenRouterSecret,
    setupPullRequest,
    legacyFiles: legacy.filter((file) => file.exists).map((file) => file.path),
    settings: options,
  };
}
