/**
 * `bun repo env ls`, `get KEY --scope s [--reveal]`, `run --scope s -- cmd` and `export --scope s --format dotenv`.
 * ls lists every key the env files declare, with the tracked files that import the file and name the key. get, run
 * and export load the env file and read a scope's merged values, opening sealed ones with this repo's key in memory:
 * get prints one masked (whole with `--reveal`), run hands them to the child's env only, export prints them as dotenv.
 */
import { ENV_KEY_VARIABLE, KEY_IMPORT_FIX, WRONG_KEY_FIX } from "../env.constants.ts";
import { isWrongKey, reveal } from "../env/age.ts";
import { identities } from "../env/keys.ts";
import { isKeyName, isScopeName, parseArgs, type ArgSpec, type EnvArgs } from "./env-args.ts";
import {
  BACKSLASH,
  BACKTICK,
  COLUMN_GAP,
  CR,
  DOLLAR,
  DOTENV,
  DOUBLE,
  EXIT_OK,
  MASK_ALL,
  MASK_MIN,
  MASK_SHOWN,
  MASK_TAIL,
  NONE,
  SCOPES,
  SINGLE,
} from "./env-command.constants.ts";
import { chooseFile, envFiles, loadLayers, trackedFiles, usersOf, type Value } from "./env-files.ts";
import { guarded, ioOf, keyFileOf, keysOrRefuse, refuse, repoRoot, usage, type EnvDeps, type EnvIo } from "./env-io.ts";

const LS: ArgSpec = { command: "none", switches: [], values: [], words: 0 };
const GET: ArgSpec = { command: "none", switches: ["--reveal"], values: ["--scope", "--file"], words: 1 };
const RUN: ArgSpec = { command: "required", switches: [], values: ["--scope", "--file"], words: 0 };
const EXPORT: ArgSpec = { command: "none", switches: [], values: ["--scope", "--file", "--format"], words: 0 };
const HEADER: readonly string[] = ["KEY", "SCOPE", "KIND", "FILE", "USED BY"];

/** Each value's plaintext, sealed ones opened together; a missing or wrong key names `key import`. */
async function opened(
  io: EnvIo,
  root: string,
  entries: readonly (readonly [string, Value])[],
): Promise<Map<string, string>> {
  const sealed = entries.filter(([, value]) => value.cipher !== undefined);
  const texts = new Map(entries.map(([key, value]) => [key, value.text ?? ""]));
  const [first] = sealed;

  if (first === undefined) return texts;
  const keys = identities({ home: io.home, source: io.env });
  const { label } = keyFileOf(io.home, keysOrRefuse(root).repo);

  if (keys.length === 0) refuse(`${first[0]} is sealed and no key is at ${label}; ${KEY_IMPORT_FIX}`);

  const plain = await reveal(
    sealed.map(([, value]) => String(value.cipher)),
    keys,
  ).catch((error: unknown) => {
    if (isWrongKey(error)) refuse(`${first[0]} is sealed for another key than ${label}; ${WRONG_KEY_FIX}`);
    throw error;
  });

  for (const [index, [key]] of sealed.entries()) texts.set(key, String(plain[index]));

  return texts;
}

/** A value as get prints it unrevealed: its first characters then `…••••`, or only `••••` when it is short. */
function masked(text: string): string {
  return text.length < MASK_MIN ? MASK_ALL : `${text.slice(0, MASK_SHOWN)}${MASK_TAIL}`;
}

/** `rows` under the header, each column as wide as its widest cell. */
function table(rows: readonly (readonly string[])[]): string {
  const all = [HEADER, ...rows];
  const widths = HEADER.map((_, column) => Math.max(...all.map((row) => String(row[column]).length)));

  return all
    .map(
      (row) =>
        `${row
          .map((cell, column) => cell.padEnd(Number(widths[column])))
          .join(COLUMN_GAP)
          .trimEnd()}\n`,
    )
    .join("");
}

/** The order `ls` lists rows in: by key, then block, then file. */
function sortKey([key, scope, , file]: readonly string[]): string {
  return [key, SCOPES.indexOf(String(scope)), file].join("\0");
}

function byRow(a: readonly string[], b: readonly string[]): number {
  return sortKey(a).localeCompare(sortKey(b));
}

function ls(io: EnvIo): Promise<number> {
  const root = repoRoot(io.cwd);
  const tracked = trackedFiles(root);

  const rows = [...envFiles(root, tracked)].flatMap(([rel, declared]) =>
    declared.map(({ key, kind, scope }) => {
      const users = usersOf({ root, tracked }, rel, key);

      return [key, scope, kind, rel, users.length === 0 ? NONE : users.join(", ")];
    }),
  );

  io.stdout(table(rows.toSorted(byRow)));

  return Promise.resolve(EXIT_OK);
}

/** The merged values of the `--scope` block of the env file the args choose, opened, sorted by key; or just `key`. */
async function scopeValues(io: EnvIo, args: EnvArgs, key?: string): Promise<Map<string, string>> {
  const root = repoRoot(io.cwd);
  const scope = String(args.values.get("--scope"));
  const rel = chooseFile(root, io.cwd, { anyOne: key === undefined, file: args.values.get("--file"), key });
  const layers = await loadLayers(root, rel);
  const block = new Map(layers.get(scope));

  const entries = [...block]
    .filter(([name]) => key === undefined || name === key)
    .toSorted(([a], [b]) => a.localeCompare(b));

  if (key !== undefined && entries.length === 0) refuse(`${key} has no ${scope} value in ${rel}`);

  return opened(io, root, entries);
}

/** Whether a quote can hold `text` so that bun's `--env-file` and dotenv both read it back unchanged. */
function fitsSingle(text: string): boolean {
  // bun reads a `\` before the closing quote as an escape, and both read a carriage return as a newline.
  return !text.includes(SINGLE) && !text.includes(CR) && !text.endsWith(BACKSLASH);
}

function fitsDouble(text: string): boolean {
  // Inside double quotes both turn `\n` and `\r` into a newline and a carriage return, so no `\` may stand as text.
  return !text.includes(DOUBLE) && !text.includes(BACKSLASH);
}

function fitsBacktick(text: string): boolean {
  return !text.includes(BACKTICK) && !text.includes(CR) && !text.includes(BACKSLASH);
}

function escapedLines(text: string): string {
  return text.replaceAll("\n", "\\n").replaceAll(CR, "\\r");
}

function asIs(text: string): string {
  return text;
}

/** The quotes in the order export tries them, and how each writes a value. */
const QUOTINGS: readonly (readonly [string, (text: string) => boolean, (text: string) => string])[] = [
  [SINGLE, fitsSingle, asIs],
  [DOUBLE, fitsDouble, escapedLines],
  [BACKTICK, fitsBacktick, asIs],
];

/** A dotenv line bun and dotenv both read back as `text`; refuses, naming only `key`, a value no quote holds. */
function dotenvLine(key: string, text: string): string {
  // bun expands `$NAME` inside every quote and dotenv inside none, so a `$` reads back the same in no quote.
  const quoting = text.includes(DOLLAR) ? undefined : QUOTINGS.find(([, fits]) => fits(text));

  if (quoting === undefined) {
    return refuse(
      `${key} has no dotenv quoting that bun and dotenv read back the same; pass it with \`bun repo env run\``,
    );
  }

  const [quote, , written] = quoting;

  return `${key}=${quote}${written(text)}${quote}\n`;
}

async function get(io: EnvIo, args: EnvArgs): Promise<number> {
  const key = String(args.words[0]);
  const values = await scopeValues(io, args, key);
  const text = String(values.get(key));
  io.stdout(`${args.switches.has("--reveal") ? text : masked(text)}\n`);

  return EXIT_OK;
}

async function run(io: EnvIo, args: EnvArgs): Promise<number> {
  const values = Object.fromEntries(await scopeValues(io, args));

  // The child gets the values, never the key that opened them.
  const base = Object.entries(io.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== ENV_KEY_VARIABLE,
  );

  return io.spawn([...args.command], { cwd: io.cwd, env: { ...Object.fromEntries(base), ...values } });
}

async function exportDotenv(io: EnvIo, args: EnvArgs): Promise<number> {
  const lines = [...(await scopeValues(io, args))].map(([key, text]) => dotenvLine(key, text));
  io.stdout(lines.join(""));

  return EXIT_OK;
}

/** A verb: the argv it takes, what else its args must hold, and its run. */
type Verb = {
  readonly spec: ArgSpec;
  readonly isValid: (args: EnvArgs) => boolean;
  readonly run: (io: EnvIo, args: EnvArgs) => Promise<number>;
};

function hasScope(args: EnvArgs): boolean {
  return isScopeName(args.values.get("--scope"));
}

const VERBS: ReadonlyMap<string, Verb> = /* @__PURE__ */ new Map([
  [
    "export",
    { isValid: (args) => hasScope(args) && args.values.get("--format") === DOTENV, run: exportDotenv, spec: EXPORT },
  ],
  ["get", { isValid: (args) => hasScope(args) && isKeyName(args.words[0]), run: get, spec: GET }],
  ["ls", { isValid: () => true, run: ls, spec: LS }],
  ["run", { isValid: hasScope, run, spec: RUN }],
]);

/** Runs `ls`, `get`, `run` or `export`; see the file comment. */
export function main(argv: string[], deps?: EnvDeps): Promise<number> {
  const io = ioOf(deps);
  const [name = "", ...rest] = argv;
  const verb = VERBS.get(name);
  const args = verb === undefined ? null : parseArgs(rest, verb.spec);

  if (verb === undefined || args === null || !verb.isValid(args)) return Promise.resolve(usage(io));

  return guarded(io, () => verb.run(io, args));
}
