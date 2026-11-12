import { defineEnv } from "./env.ts";
import type { EnvInstance } from "./env/define.ts";

/** This package's env config, held apart so the export's type can name it under isolatedDeclarations. */
const config = {
  dev: {},
  local: {},
  process: {
    BUN_CONFIG_REGISTRY: "optional",
    CI: "optional",
    CLAUDE_EFFORT: "optional",
    CLAUDE_PROJECT_DIR: "optional",
    CLAUDE_SESSION_ID: "optional",
    ELEVENLABS_API_KEY: "optional",
    ELEVENLABS_MODEL_ID: "optional",
    ELEVENLABS_VOICE_ID: "optional",
    GITHUB_ACTIONS: "optional",
    GIT_CONFIG_GLOBAL: "optional",
    GIT_DIR: "optional",
    GROK_HOOK_EVENT: "optional",
    GROK_SESSION_ID: "optional",
    GROK_WORKSPACE_ROOT: "optional",
    HOME: "optional",
    LISTEN_DEVICE: "optional",
    LISTEN_FFMPEG_FORMAT: "optional",
    LISTEN_MODEL: "optional",
    LISTEN_SECONDS: "optional",
    LISTEN_STT: "optional",
    LISTEN_WHISPER_MODEL: "optional",
    NODE_PATH: "optional",
    NPM_CONFIG_REGISTRY: "optional",
    OPENAI_API_KEY: "optional",
    OPENAI_TTS_MODEL: "optional",
    OPENAI_TTS_VOICE: "optional",
    PATH: "optional",
    PATHEXT: "optional",
    REPO_BOARD_HOME: "optional",
    REPO_BOARD_PROVIDER: "optional",
    REPO_BOARD_SESSION: "optional",
    REPO_BROWSER: "optional",
    REPO_COVERAGE: "optional",
    REPO_E2E_KEEP: "optional",
    REPO_E2E_ROOT: "optional",
    REPO_E2E_TARBALL: "optional",
    REPO_VITEST_REPORT: "optional",
    REPO_VITEST_SHARD: "optional",
    RUNNER_TEMP: "optional",
    SPEAK_PROVIDER: "optional",
    TURN_RECORD: "optional",
    TYPESAFE_API_KEY: "optional",
    USERPROFILE: "optional",
    WHISPER_MODEL: "optional",
    WORKSPACE_ACCOUNT: "optional",
  },
  prod: {},
} as const;

/** This package's env: no scope values, and every process variable its code reads, each optional, sorted. */
export const repoEnv: EnvInstance<typeof config> = /* @__PURE__ */ defineEnv(config);

/** The process variables this package reads, each a key only when set. */
export type Env = (typeof repoEnv)["process"];
