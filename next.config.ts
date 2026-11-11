import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The agent program is read from disk and committed to repositories by setup pull requests.
  outputFileTracingIncludes: {
    "/api/repo/**": ["./src/agent-runtime/codeless-agent.mjs"],
    "/repo-setup": ["./src/agent-runtime/codeless-agent.mjs"],
  },
  serverExternalPackages: [
    "@lancedb/lancedb",
    "@huggingface/transformers",
    "onnxruntime-node",
    "ts-morph",
    "simple-git",
  ],
};

export default nextConfig;
