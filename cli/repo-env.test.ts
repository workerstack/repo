import { describe, expect, expectTypeOf, it } from "vitest";

import { repoEnv, type Env } from "./repo-env.ts";

/** The names this package reads, sorted, as the requirement lists them. */
const DECLARED = `
  BUN_CONFIG_REGISTRY CI CLAUDE_EFFORT CLAUDE_PROJECT_DIR CLAUDE_SESSION_ID ELEVENLABS_API_KEY
  ELEVENLABS_MODEL_ID ELEVENLABS_VOICE_ID GITHUB_ACTIONS GIT_CONFIG_GLOBAL GIT_DIR GROK_HOOK_EVENT
  GROK_SESSION_ID GROK_WORKSPACE_ROOT HOME LISTEN_DEVICE LISTEN_FFMPEG_FORMAT LISTEN_MODEL
  LISTEN_SECONDS LISTEN_STT LISTEN_WHISPER_MODEL NODE_PATH NPM_CONFIG_REGISTRY OPENAI_API_KEY
  OPENAI_TTS_MODEL OPENAI_TTS_VOICE PATH PATHEXT REPO_BOARD_HOME REPO_BOARD_PROVIDER
  REPO_BOARD_SESSION REPO_BROWSER REPO_COVERAGE REPO_E2E_KEEP REPO_E2E_ROOT REPO_E2E_TARBALL
  REPO_VITEST_REPORT REPO_VITEST_SHARD RUNNER_TEMP SPEAK_PROVIDER TURN_RECORD TYPESAFE_API_KEY
  USERPROFILE WHISPER_MODEL WORKSPACE_ACCOUNT
`
  .trim()
  .split(/\s+/u);

describe("repoEnv", () => {
  it("declares this package's process variables, sorted", () => {
    const all = Object.fromEntries(DECLARED.map((name) => [name, "set"]));
    expect(Object.keys(repoEnv.read(all))).toStrictEqual(DECLARED);
  });

  it("reads a set variable", () => {
    expect(repoEnv.read({ HOME: "/h" }).HOME).toBe("/h");
  });

  it("leaves an unset variable out", () => {
    expect(Object.keys(repoEnv.read({ HOME: "/h" }))).toStrictEqual(["HOME"]);
  });

  it("types each variable as an optional string", () => {
    expectTypeOf<Env["HOME"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Env>().not.toHaveProperty("NOT_DECLARED");
  });
});
