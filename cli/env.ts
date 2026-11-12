import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DECRYPT_FAILED_EXIT,
  DECRYPT_MODULE,
  DECRYPT_WRONG_KEY_EXIT,
  KEY_IMPORT_FIX,
  KEYS_DIR,
  WRONG_KEY_FIX,
} from "./env.constants.ts";
import { createEnv, sealedValue } from "./env/define.ts";
import type { EnvConfig, EnvInstance, EnvIo, Sealed } from "./env/define.ts";
import { bunRuntime, homeDir, identities, packageRoot, readKeysFile, readPlaintexts, stackFile } from "./env/keys.ts";

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

  if (keys.length === 0)
    throw new Error(`repo env: ${key} is sealed and no key is at ${keyFileLabel()}; ${KEY_IMPORT_FIX}`);

  const result = spawnSync(bunRuntime(process.versions, process.execPath), ["-e", childScript()], {
    encoding: "utf8",
    input: JSON.stringify({ ciphers, identities: keys }),
  });

  if (result.status === DECRYPT_WRONG_KEY_EXIT)
    throw new Error(`repo env: ${key} is sealed for another key than ${keyFileLabel()}; ${WRONG_KEY_FIX}`);

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
