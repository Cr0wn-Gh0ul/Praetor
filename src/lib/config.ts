import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIRECTORY, DEFAULT_MODELS, LOCAL_DATA_DIRECTORY } from "./constants";
import { appConfigSchema } from "./schemas";
import type { AppConfig, PublicAppConfig } from "./types";

const CONFIG_FILE_NAME = "config.json";
const SECRET_MASK = "********";

type ConfigStoreOptions = {
  dataDir?: string;
  env?: Record<string, string | undefined>;
};

type ConfigUpdate = Omit<Partial<AppConfig>, "models"> & {
  models?: Partial<AppConfig["models"]>;
};

function resolveDataDirectory(dataDir?: string): string {
  if (dataDir) return dataDir;
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return process.env.DOCKER === "1" ? DATA_DIRECTORY : LOCAL_DATA_DIRECTORY;
}

function envConfig(env: Record<string, string | undefined>): Partial<AppConfig> {
  return {
    githubToken: env.GITHUB_TOKEN,
    openRouterApiKey: env.OPENROUTER_API_KEY,
    baseBranch: env.BASE_BRANCH,
  };
}

/** Removes settings from older versions so saved files stay small and parse cleanly. */
function dropLegacyKeys(saved: Record<string, unknown>): Partial<AppConfig> {
  const current = { ...saved };
  delete current.webhookUrl;
  delete current.webhookSecret;
  delete current.webhookSkipVerify;
  return current as Partial<AppConfig>;
}

export function createConfigStore(options: ConfigStoreOptions = {}) {
  const configPath = path.join(resolveDataDirectory(options.dataDir), CONFIG_FILE_NAME);

  async function readSavedConfig(): Promise<Partial<AppConfig>> {
    try {
      const contents = await readFile(configPath, "utf8");
      return dropLegacyKeys(JSON.parse(contents) as Record<string, unknown>);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw error;
    }
  }

  async function getConfig(): Promise<AppConfig> {
    const env = options.env ?? process.env;
    const saved = await readSavedConfig();
    const environmentConfig = Object.fromEntries(
      Object.entries(envConfig(env)).filter(([, value]) => value !== undefined),
    ) as Partial<AppConfig>;
    return appConfigSchema.parse({
      ...saved,
      ...environmentConfig,
      models: { ...DEFAULT_MODELS, ...saved.models },
    });
  }

  async function saveConfig(partial: ConfigUpdate): Promise<AppConfig> {
    const saved = await readSavedConfig();
    const nextTargetRepo = partial.targetRepo ?? saved.targetRepo ?? "";
    const repositoryChanged = Boolean(saved.targetRepo && nextTargetRepo && saved.targetRepo.toLowerCase() !== nextTargetRepo.toLowerCase());
    const merged = appConfigSchema.parse({
      ...saved,
      ...partial,
      ...(repositoryChanged && partial.additionalContextPaths === undefined ? { additionalContextPaths: [] } : {}),
      models: { ...DEFAULT_MODELS, ...saved.models, ...partial.models },
    });
    const directory = path.dirname(configPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${configPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, configPath);
    return getConfig();
  }

  async function isConfigured(): Promise<boolean> {
    const config = await getConfig();
    return Boolean((config.githubAuth?.accessToken || config.githubToken) && config.openRouterApiKey);
  }

  async function getPublicConfig(): Promise<PublicAppConfig> {
    const config = await getConfig();
    const env = options.env ?? process.env;
    return {
      github: {
        method: config.githubAuth?.accessToken ? "app" : config.githubToken ? "token" : "none",
        login: config.githubAuth?.login ?? "",
        fromEnvironment: !config.githubAuth && Boolean(env.GITHUB_TOKEN),
      },
      openRouterApiKeyMasked: config.openRouterApiKey ? SECRET_MASK : "",
      targetRepo: config.targetRepo,
      baseBranch: config.baseBranch,
      additionalContextPaths: config.additionalContextPaths,
      models: config.models,
    };
  }

  return { getConfig, saveConfig, isConfigured, getPublicConfig };
}

const defaultStore = createConfigStore();

export const getConfig = defaultStore.getConfig;
export const saveConfig: (partial: ConfigUpdate) => Promise<AppConfig> = defaultStore.saveConfig;
export const isConfigured = defaultStore.isConfigured;
export const getPublicConfig = defaultStore.getPublicConfig;