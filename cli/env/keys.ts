import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { ENV_KEY_VARIABLE, KEY_EXTENSION, KEYS_DIR, KEYS_FILE, MANIFEST, PACKAGE_NAME } from "../env.constants.ts";
import { readJson, tryJson } from "../json.ts";
import { packageJsonSchema } from "../package-json.ts";
import type { Source } from "./define.ts";

/** A repo's `.repo/env.keys.json`: the age recipient its values are sealed for, and the repo's name. */
export type KeysFile = { readonly recipient: string; readonly repo: string };

/** What the parent sends the decrypt child on stdin. */
export type RevealRequest = { readonly ciphers: readonly string[]; readonly identities: readonly string[] };

/** Where identities are looked up: the home folder and the process variables. */
export type KeyPlace = { readonly home: string; readonly source: Source };

const RECIPIENT_PREFIX = "age1";
const COMMENT = "#";

/** A stack frame's file: `at f (file:line:col)` or `at file:line:col`, a `file://` URL or a path. */
const FRAME = /^\s*at (?:.*\()?(.+?):\d+:\d+\)?$/mu;
const FILE_URL = "file:";

/** The home folder `source` names, HOME then USERPROFILE, else `fallback`. */
export function homeDir(source: Source, fallback: string): string {
  const home = [source["HOME"], source["USERPROFILE"]].find((dir) => dir !== undefined && dir !== "");

  return home ?? fallback;
}

/** The age identities to try: WORKERSTACK_ENV_KEY when set, else the key of every `~/.workerstack/keys/*.key`. */
export function identities({ home, source }: KeyPlace): string[] {
  const fromEnv = source[ENV_KEY_VARIABLE];

  if (fromEnv !== undefined && fromEnv !== "") return [fromEnv];
  const dir = path.join(home, KEYS_DIR);

  if (!fs.existsSync(dir)) return [];
  // Shipped as ES2022 in dist, where toSorted is not typed: the fresh list sorts in place.
  const names = fs.readdirSync(dir).filter((name) => name.endsWith(KEY_EXTENSION));
  names.sort();

  return names.flatMap((name) => keyLines(fs.readFileSync(path.join(dir, name), "utf8")));
}

/** The keys of an age identity file: every line but blanks and `#` comments. */
function keyLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith(COMMENT));
}

/** The keys file's fields: an age recipient and a repo name that is not empty. */
function keysSchema(): z.ZodType<KeysFile> {
  return z.object({ recipient: z.string().startsWith(RECIPIENT_PREFIX), repo: z.string().min(1) });
}

function requestSchema(): z.ZodType<RevealRequest> {
  return z.object({ ciphers: z.array(z.string()), identities: z.array(z.string()) });
}

/** The nearest `.repo/env.keys.json` at or above `cwd`, parsed; undefined when there is none. */
export function readKeysFile(cwd: string): KeysFile | undefined {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const file = path.join(dir, KEYS_FILE);

    if (fs.existsSync(file)) {
      const keys = tryJson(keysSchema(), fs.readFileSync(file, "utf8"));

      if (keys !== undefined) return keys;
      throw new Error(`repo env: ${KEYS_FILE} in ${dir} is not { "recipient": "age1…", "repo": "<name>" }; fix it`);
    }

    if (path.dirname(dir) === dir) return undefined;
  }
}

/** The `name` of the package.json in `dir`, undefined when there is none or it holds no string name. */
function packageName(dir: string): string | undefined {
  const file = path.join(dir, MANIFEST);

  if (!fs.existsSync(file)) return undefined;

  return readJson(packageJsonSchema.pick({ name: true }).catch({}), fs.readFileSync(file, "utf8")).name;
}

/** The root of the @workerstack/repo package `moduleUrl` sits in, from cli/ and dist/cli/ alike. */
export function packageRoot(moduleUrl: string): string {
  const start = path.dirname(fileURLToPath(moduleUrl));

  for (let dir = start; ; dir = path.dirname(dir)) {
    if (packageName(dir) === PACKAGE_NAME) return dir;

    if (path.dirname(dir) === dir) throw new Error(`repo env: no ${PACKAGE_NAME} package.json at or above ${start}`);
  }
}

/** The bun that runs the decrypt child: this process under bun, else `bun` on PATH. */
export function bunRuntime(versions: Source, execPath: string): string {
  return versions["bun"] === undefined ? "bun" : execPath;
}

/** The file of a stack's first frame, relative to `cwd`; undefined when no frame names one. */
export function stackFile(stack: string, cwd: string): string | undefined {
  const location = FRAME.exec(stack)?.[1];

  if (location === undefined) return undefined;

  return path.relative(cwd, location.startsWith(FILE_URL) ? fileURLToPath(location) : location);
}

/** The decrypt child's stdin, parsed; throws a line when it is not `{ ciphers, identities }` of strings. */
export function readRequest(text: string): RevealRequest {
  const request = tryJson(requestSchema(), text);

  if (request === undefined)
    throw new Error("repo env: the decrypt child takes { ciphers, identities } as JSON lists of strings");

  return request;
}

/** The decrypt child's stdout, parsed; throws a line unless it is `count` strings. */
export function readPlaintexts(text: string, count: number): string[] {
  const plaintexts = tryJson(z.array(z.string()).length(count), text);

  if (plaintexts === undefined) throw new Error(`repo env: the decrypt child did not answer ${count} plaintexts`);

  return plaintexts;
}
