import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  DECRYPT_FAILED_EXIT,
  DECRYPT_MODULE,
  DECRYPT_WRONG_KEY_EXIT,
  ENV_KEY_VARIABLE,
  KEYS_DIR,
} from "./env.constants.ts";
import { createEnv, sealedValue } from "./env/define.ts";
import type { EnvConfig, EnvInstance, EnvIo, Sealed } from "./env/define.ts";
import { bunRuntime, homeDir, identities, packageRoot, readKeysFile, readPlaintexts, stackFile } from "./env/keys.ts";

/** Every variable this repo's code reads, sorted; add a name here to read it. */
const ENV_VARIABLES = [
  "BUN_CONFIG_REGISTRY",
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
  "NPM_CONFIG_REGISTRY",
  "OPENAI_API_KEY",
  "OPENAI_TTS_MODEL",
  "OPENAI_TTS_VOICE",
  "PATH",
  "PATHEXT",
  "REPO_BOARD_HOME",
  "REPO_BOARD_PROVIDER",
  "REPO_BOARD_SESSION",
  "REPO_BROWSER",
  "REPO_COVERAGE",
  "REPO_E2E_KEEP",
  "REPO_E2E_ROOT",
  "REPO_E2E_TARBALL",
  "REPO_VITEST_REPORT",
  "REPO_VITEST_SHARD",
  "RUNNER_TEMP",
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

/** Where this repo's age key goes, as the error lines name it: `<repo>` when no keys file names the repo. */
function keyFileLabel(): string {
  const repo = readKeysFile(process.cwd())?.repo ?? "<repo>";
  return `~/${KEYS_DIR}/${repo}.key`;
}

/**
 * The decrypt child, run by `bun -e`: it imports `decryptChild` from the shipped age source (from cli/ and dist/cli/
 * alike), answers stdin on stdout, and on failure writes one line on stderr and exits 3 for a wrong key, else 1.
 */
function childScript(): string {
  const module = JSON.stringify(pathToFileURL(path.join(packageRoot(import.meta.url), DECRYPT_MODULE)).href);
  return [
    `const { decryptChild, isWrongKey } = await import(${module});`,
    "try { process.stdout.write(await decryptChild(await Bun.stdin.text())); } catch (error) {",
    '  const reason = String(error instanceof Error ? error.message : error).split("\\n")[0];',
    "  process.stderr.write(reason + String.fromCharCode(10));",
    `  process.exitCode = isWrongKey(error) ? ${DECRYPT_WRONG_KEY_EXIT} : ${DECRYPT_FAILED_EXIT};`,
    "}",
  ].join("\n");
}

/** Every cipher's plaintext from the decrypt child, a bun process given the identities on stdin; `key` is the read. */
function revealInChild(ciphers: readonly string[], key: string): string[] {
  const keys = identities({ home: homeDir(process.env, os.homedir()), source: process.env });
  if (keys.length === 0) {
    const fix = `save this repo's age key there (0600) or set ${ENV_KEY_VARIABLE}`;
    throw new Error(`repo env: ${key} is sealed and no key is at ${keyFileLabel()}; ${fix}`);
  }
  const result = spawnSync(bunRuntime(process.versions, process.execPath), ["-e", childScript()], {
    encoding: "utf8",
    input: JSON.stringify({ ciphers, identities: keys }),
  });
  if (result.status === DECRYPT_WRONG_KEY_EXIT) {
    const label = keyFileLabel();
    throw new Error(`repo env: ${key} is sealed for another key than ${label}; save this repo's age key there`);
  }
  if (result.status !== 0) {
    const reason = (result.error?.message ?? result.stderr).trim();
    throw new Error(`repo env: ${key} could not be decrypted: ${reason}`);
  }
  return readPlaintexts(result.stdout, ciphers.length);
}

/**
 * A typed env over this process: `current` follows REPO_ENV, `process` reads the declared variables, and the first
 * sealed read decrypts every sealed value of the tree in one bun child, kept in memory for this env only.
 */
export function defineEnv<C extends EnvConfig>(config: C): EnvInstance<C> {
  const io: EnvIo = { reveal: revealInChild, source: () => process.env };
  const site: { stack?: string } = {};
  Error.captureStackTrace(site, defineEnv);
  return createEnv(config, io, stackFile(String(site.stack), process.cwd()));
}

/** A value sealed with age for this repo's recipient, from the base64 of its cipher; read back as a string. */
export function sealed(cipher: string): Sealed {
  return sealedValue(cipher);
}
