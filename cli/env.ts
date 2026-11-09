import { z } from "zod";

/** Every variable this repo's code reads, sorted; add a name here to read it. */
const ENV_VARIABLES = [
  "CI",
  "CLAUDE_EFFORT",
  "CLAUDE_PROJECT_DIR",
  "CLAUDE_SESSION_ID",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_MODEL_ID",
  "ELEVENLABS_VOICE_ID",
  "GITHUB_ACTIONS",
  "GIT_CONFIG_GLOBAL",
  "GIT_DIR",
  "GROK_HOOK_EVENT",
  "GROK_SESSION_ID",
  "GROK_WORKSPACE_ROOT",
  "HOME",
  "LISTEN_DEVICE",
  "LISTEN_FFMPEG_FORMAT",
  "LISTEN_MODEL",
  "LISTEN_SECONDS",
  "LISTEN_STT",
  "LISTEN_WHISPER_MODEL",
  "NODE_PATH",
  "OPENAI_API_KEY",
  "OPENAI_TTS_MODEL",
  "OPENAI_TTS_VOICE",
  "PATH",
  "PATHEXT",
  "REPO_BOARD_HOME",
  "REPO_BOARD_PROVIDER",
  "REPO_BOARD_SESSION",
  "REPO_BROWSER",
  "REPO_E2E_KEEP",
  "REPO_E2E_ROOT",
  "REPO_E2E_TARBALL",
  "SPEAK_PROVIDER",
  "TURN_RECORD",
  "TYPESAFE_API_KEY",
  "USERPROFILE",
  "WHISPER_MODEL",
  "WORKSPACE_ACCOUNT",
] as const;

export type Env = { [Name in (typeof ENV_VARIABLES)[number]]?: string | undefined };

/** Each variable is an optional string, unless a command cannot run without it. */
function envSchema(): z.ZodType<Env, Record<string, unknown>> {
  const text = z.string().optional();
  return z.object(Object.fromEntries(ENV_VARIABLES.map((name) => [name, text])));
}

/** `repo: environment: <NAME>: <issue>`, one line per bad variable. */
function describe(error: z.ZodError): string {
  return error.issues.map((issue) => `repo: environment: ${issue.path.join(".")}: ${issue.message}`).join("\n");
}

/** The environment parsed against the schema; throws a line per bad variable. */
export function readEnv(source: Record<string, unknown> = process.env): Env {
  const parsed = envSchema().safeParse(source);
  if (!parsed.success) throw new Error(describe(parsed.error));
  return parsed.data;
}

/** A copy of the environment with `overrides` applied and every undefined value dropped, for spawn. */
export function childEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const merged = { ...process.env, ...overrides };
  return Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
