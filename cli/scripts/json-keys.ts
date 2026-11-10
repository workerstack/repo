/**
 * The key order of JSON files. `repo fmt` and turn's fmt step sort the keys of every `.json` file by code unit, deep,
 * with arrays left in order, and `repo fmt --check` names the first key out of order. A member keeps its own text and
 * the separators stay where they were, so a file's layout does not change; a file that is not strict JSON (comments,
 * trailing commas) is left alone. `package.json` is oxfmt's (`sortPackageJson`), and so is every file the generated
 * oxfmt config ignores.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { childEnv } from "../env.ts";
import { OXFMT_CONFIG_PATH } from "../sync/standards.ts";
import { GIT_CONFIG_ENV, GIT_ENV_PREFIX } from "./lint.constants.ts";
import {
  ANCHOR,
  ANY_DEPTH,
  COMMENT_LINE,
  INDENT,
  JSON_EXTENSION,
  JSON_PATHSPEC,
  MANIFEST_NAME,
  PATH_SEPARATOR,
  SYNC_AGAIN_HINT,
  SYNC_HINT,
  UNDER,
} from "./json-keys.constants.ts";

type Leaf = { kind: "leaf"; start: number; end: number };
type Member = { key: string; start: number; node: Node };
type Obj = { kind: "object"; start: number; end: number; members: Member[] };
type Arr = { kind: "array"; start: number; end: number; items: Node[] };
type Node = Leaf | Obj | Arr;
/** A member or an item: where its text starts, its value, and its key (empty for an item). */
type Slot = { start: number; node: Node; key: string };

/** A file whose keys are out of order, and the path of the first key that is. */
type Found = { file: string; key: string };
type Sorted = { text: string; key: string };
type Listed = { ok: true; files: string[] };
type Sort = { ok: true; found: Found[] } | { ok: false; error: string };

const at = <T>(list: readonly T[], index: number): T => list[index] /* the caller's index is in range */ as T;
/** Code-unit order, which `<` on strings is. */
const compare = (a: string, b: string): number => Number(a > b) - Number(a < b);
const byKey = (a: Slot, b: Slot): number => compare(a.key, b.key);

/** Where the parser is in a text. */
type Cursor = { text: string; at: number };

/** The text `pattern` (sticky) matches at the cursor, which moves past it. */
function take(cursor: Cursor, pattern: RegExp): string {
  pattern.lastIndex = cursor.at;
  const found = pattern.exec(
    cursor.text,
  ) /* valid JSON has a match here, and the whitespace pattern an empty one */ as RegExpExecArray;
  cursor.at = pattern.lastIndex;
  return found[0];
}

const skip = (cursor: Cursor) => take(cursor, /[ \t\n\r]*/y);
const read = (cursor: Cursor) => take(cursor, /"(?:[^"\\]|\\.)*"|[^ \t\n\r,\]}]+/y);

/** Past the comma after a member or an item, if there is one. */
function comma(cursor: Cursor): void {
  skip(cursor);
  if (cursor.text.charAt(cursor.at) === ",") {
    cursor.at += 1;
    skip(cursor);
  }
}

/** The members of the object at the cursor, which moves past its closing brace. */
function membersOf(cursor: Cursor): Member[] {
  const members: Member[] = [];
  cursor.at += 1;
  skip(cursor);
  while (cursor.text.charAt(cursor.at) !== "}") {
    const start = cursor.at;
    const key = JSON.parse(read(cursor)) /* a JSON string */ as string;
    skip(cursor);
    cursor.at += 1;
    members.push({ key, start, node: value(cursor) });
    comma(cursor);
  }
  cursor.at += 1;
  return members;
}

/** The items of the array at the cursor, which moves past its closing bracket. */
function itemsOf(cursor: Cursor): Node[] {
  const items: Node[] = [];
  cursor.at += 1;
  skip(cursor);
  while (cursor.text.charAt(cursor.at) !== "]") {
    items.push(value(cursor));
    comma(cursor);
  }
  cursor.at += 1;
  return items;
}

/** The value at the cursor, which moves past it. */
function value(cursor: Cursor): Node {
  skip(cursor);
  const start = cursor.at;
  const open = cursor.text.charAt(start);
  if (open === "{") return { kind: "object", start, members: membersOf(cursor), end: cursor.at };
  if (open === "[") return { kind: "array", start, items: itemsOf(cursor), end: cursor.at };
  read(cursor);
  return { kind: "leaf", start, end: cursor.at };
}

/** The tree of valid JSON `text`, each node with the span of its text. */
const parse = (text: string): Node => value({ text, at: 0 });

const slotsOf = (node: Obj | Arr): Slot[] =>
  node.kind === "array"
    ? node.items.map((item) => ({ start: item.start, node: item, key: "" }))
    : node.members.map((member) => ({ start: member.start, node: member.node, key: member.key }));

/** One member or item: its own text up to the value, the value rendered, then the separator `gap` that followed. */
const piece = (slot: Slot, gap: string, text: string): string =>
  `${text.slice(slot.start, slot.node.start)}${render(slot.node, text)}${gap}`;

/** `node`'s text with every object's members in code-unit order, each with its own text and the original separators. */
function render(node: Node, text: string): string {
  const slots = node.kind === "leaf" ? [] : slotsOf(node);
  const first = slots[0];
  if (node.kind === "leaf" || first === undefined) return text.slice(node.start, node.end);
  const gaps = slots.map((slot, i) => text.slice(slot.node.end, slots[i + 1]?.start ?? node.end));
  const order = node.kind === "object" ? [...slots].sort(byKey) : slots;
  const body = order.map((slot, i) => piece(slot, at(gaps, i), text));
  return `${text.slice(node.start, first.start)}${body.join("")}`;
}

/** The path of the first key out of order below `node`, in document order, or null. */
function firstOutOfOrder(node: Node, parents: readonly string[]): string | null {
  if (node.kind === "leaf") return null;
  const slots = slotsOf(node);
  if (node.kind === "object") {
    const late = slots.findIndex((slot, i) => i > 0 && slot.key < at(slots, i - 1).key);
    if (late > 0) return [...parents, at(slots, late).key].join(PATH_SEPARATOR);
  }
  for (const [i, slot] of slots.entries()) {
    const found = firstOutOfOrder(slot.node, [...parents, node.kind === "array" ? String(i) : slot.key]);
    if (found !== null) return found;
  }
  return null;
}

/**
 * `text` with its keys sorted and the path of the first key that was out of order, or null when they are in order or
 * `text` is not strict JSON.
 */
export function sortedJsonText(text: string): Sorted | null {
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  const root = parse(text);
  const key = firstOutOfOrder(root, []);
  if (key === null) return null;
  return { text: `${text.slice(0, root.start)}${render(root, text)}${text.slice(root.end)}`, key };
}

/** `value` as indented JSON ending in a newline, every key sorted by code unit, deep: how a repo writer emits JSON. */
export function sortedJsonValue(data: unknown, indent: number = INDENT): string {
  const text = `${JSON.stringify(data, null, indent)}\n`;
  return sortedJsonText(text)?.text ?? text;
}

/** git's environment without the `GIT_*` variables a hook hands over, which would aim it at the repo being committed. */
function gitEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(childEnv()).filter(([name]) => !name.startsWith(GIT_ENV_PREFIX) || GIT_CONFIG_ENV.test(name)),
  );
}

/** What listing the json files gives back: git's exit status (null when it did not run) and its output. */
type GitListing = { status: number | null; stdout: string };
/** Runs `git ls-files` at `root`; `repoJson` takes another in tests. */
export type GitLister = (root: string) => GitListing;

/** The real lister: untracked files git does not ignore, and the tracked ones. */
const gitList: GitLister = (root) =>
  spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z", "--", JSON_PATHSPEC], {
    cwd: root,
    encoding: "utf8",
    env: gitEnv(),
  });

/**
 * The json files of the repo at `root` that exist now, tracked or untracked and not git-ignored, as sorted `/` paths
 * relative to it; none when git cannot list them (no git, or `root` is no repo), so there is nothing to sort. `paths` (relative to `root`) narrows them to a file or a folder each; null keeps them all.
 */
export function repoJson(root: string, paths: readonly string[] | null, list: GitLister = gitList): Listed {
  const run = list(root);
  if (run.status !== 0) return { ok: true, files: [] };
  const within = (rel: string) =>
    paths === null || paths.some((under) => under === "" || rel === under || rel.startsWith(`${under}/`));
  const files = run.stdout
    .split("\0")
    .filter((rel) => rel !== "" && within(rel) && fs.existsSync(path.join(root, rel)))
    .sort(compare);
  return { ok: true, files };
}

/** The `ignorePatterns` of the generated oxfmt config text, or null when it is not a config. */
function ignoresOf(text: string): string[] | null {
  try {
    const parsed = z
      .object({ ignorePatterns: z.array(z.string()).optional() })
      .safeParse(JSON.parse(text.replace(COMMENT_LINE, "")));
    return parsed.success ? (parsed.data.ignorePatterns ?? []) : null;
  } catch {
    return null;
  }
}

/** The globs of `ignorePatterns`: `/x` is anchored at the root, any other pattern matches at any depth, and a folder matches what lies under it. */
function ignoreGlobs(patterns: readonly string[]): Bun.Glob[] {
  return patterns.flatMap((pattern) => {
    const deep = pattern.startsWith(ANY_DEPTH) ? pattern : `${ANY_DEPTH}${pattern}`;
    const base = pattern.startsWith(ANCHOR) ? pattern.slice(ANCHOR.length) : deep;
    return [new Bun.Glob(base), new Bun.Glob(`${base}${UNDER}`)];
  });
}

/**
 * Sorts the keys of the json files among `files` (paths relative to `root`, `/`-separated) that the generated oxfmt
 * config does not ignore and that are not `package.json`; under `check` it only reports them. A file that is gone or
 * is not strict JSON is skipped.
 */
export function sortJson(root: string, files: readonly string[], check: boolean): Sort {
  const config = path.join(root, OXFMT_CONFIG_PATH);
  if (!fs.existsSync(config)) return { ok: false, error: `${OXFMT_CONFIG_PATH} is missing; ${SYNC_HINT}` };
  const patterns = ignoresOf(fs.readFileSync(config, "utf8"));
  if (patterns === null)
    return { ok: false, error: `${OXFMT_CONFIG_PATH} is not a valid oxfmt config; ${SYNC_AGAIN_HINT}` };
  const globs = ignoreGlobs(patterns);
  const found: Found[] = [];
  for (const rel of files) {
    const skipped = !rel.endsWith(JSON_EXTENSION) || path.posix.basename(rel) === MANIFEST_NAME;
    const file = path.join(root, rel);
    if (skipped || globs.some((glob) => glob.match(rel)) || !fs.existsSync(file)) continue;
    const sorted = sortedJsonText(fs.readFileSync(file, "utf8"));
    if (sorted === null) continue;
    found.push({ file: rel, key: sorted.key });
    if (!check) fs.writeFileSync(file, sorted.text);
  }
  return { ok: true, found };
}
