import fs from "node:fs";
import path from "node:path";

import { emitYaml, parseDoc } from "./agents/frontmatter.ts";
import { filesUnder, isDir } from "./migrate-fs.ts";
import { FENCE, MD, NOT_FOUND, REPO_DIR } from "./migrate.constants.ts";
import type { MigrationStep } from "./migrate.ts";

/** The `.repo/` docs the upgrade reads. */
type DocKind = "rules" | "subagents";
/** One old-format doc: its text, its name without `.md`, its kind and whether a stock doc bears that name. */
type OldDoc = { text: string; name: string; kind: DocKind; stocked: boolean };
/** The upgraded text and the lines to print for it. */
type Upgrade = { content: string; notes: string[] };
/** The new top keys of an upgraded doc, the notes they make and the old keys they carry on in a new form. */
type NewKeys = { top: [string, string | string[]][]; parts: string[]; converted: string[] };

/** The frontmatter keys of the old rule format. */
const OLD_KEYS = ["root", "targets", "globs"] as const;
const KINDS: readonly DocKind[] = ["rules", "subagents"];
const EVERY_FILE: readonly string[] = ["**/*", "*"];
/** A `slice` bound that counts the last item off. */
const LAST = -1;

/** The line printed for a file marked `overrides: <name>`. */
export const markNote = (rel: string, name: string, kind: string): string =>
  `marked ${rel} with overrides: ${name} (it replaces the stock ${kind})`;

/** The index of the closing frontmatter fence among `lines`, the opening one at 0; `NOT_FOUND` without one. */
function fenceClose(lines: readonly string[]): number {
  return lines.findIndex((line, i) => i > 0 && line.trimEnd() === FENCE);
}

/** `text` with `overrides: name` as the first frontmatter key (or a new frontmatter block); null when it already has one. */
export function markedText(text: string, name: string): string | null {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const fenced = lines[0]?.trimEnd() === FENCE && fenceClose(lines) !== NOT_FOUND;
  if (fenced) {
    try {
      if (parseDoc("", text).data["overrides"] !== undefined) return null;
    } catch {
      return null;
    }
  }
  const line = emitYaml([["overrides", name]]).trimEnd();
  return fenced ? [...lines.slice(0, 1), line, ...lines.slice(1)].join(eol) : [FENCE, line, FENCE, ...lines].join(eol);
}

/** `a`, `a and b` or `a, b and c`. */
function joinAnd(items: readonly string[]): string {
  const head = items.slice(0, LAST);
  return head.length === 0 ? items.join("") : `${head.join(", ")} and ${items.slice(LAST).join("")}`;
}

/** The names under `<dir>/<kind>/` of a stock package, case-folded and without `.md`, nested paths included. */
function stockNames(stock: string, kind: DocKind): Set<string> {
  const dir = path.join(stock, "agents", kind);
  const files = isDir(dir) ? filesUnder(dir).filter((file) => file.endsWith(MD)) : [];
  return new Set(files.map((file) => file.slice(0, -MD.length).toLowerCase()));
}

/** The `.md` files under `<root>/.repo/<kind>`, POSIX paths relative to it, dot entries skipped, in string order. */
function ownDocs(root: string, kind: DocKind): string[] {
  const base = path.join(root, REPO_DIR, kind);
  if (!isDir(base)) return [];
  return filesUnder(base).filter((file) => file.endsWith(MD) && !file.split("/").some((part) => part.startsWith(".")));
}

/** Globs from a `globs` value: a list, or a comma-separated string. */
function globList(value: unknown): string[] {
  const listed = typeof value === "string" ? value.split(",") : [];
  const items = Array.isArray(value) ? value.map(String) : listed;
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

/** A rule's new `description` (from its first `#` heading, else its name) and `paths` (from `globs`), with their notes. */
function ruleKeys(data: Record<string, unknown>, body: string, doc: OldDoc): NewKeys {
  const keys: NewKeys = { converted: [], parts: [], top: [] };
  const description = data["description"];
  if (typeof description !== "string" || description.trim() === "") {
    const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(body)?.[1];
    keys.top.push(["description", (heading ?? path.posix.basename(doc.name)).trim()]);
    keys.parts.push("description added");
  }
  const globs = globList(data["globs"]);
  const everywhere = globs.some((glob) => EVERY_FILE.includes(glob));
  if (data["paths"] === undefined && globs.length > 0 && !everywhere) {
    keys.top.push(["paths", globs]);
    keys.parts.push("globs → paths");
    keys.converted.push("globs");
  }
  return keys;
}

/** The frontmatter lines between the fences without the `removed` keys and their nested lines. */
function keptLines(lines: readonly string[], removed: readonly string[]): string[] {
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const key = /^([A-Za-z_]+)\s*:/.exec(line)?.[1];
    if (key !== undefined && removed.includes(key)) skipping = true;
    else if (!skipping || !(/^\s/.test(line) || /^-(\s|$)/.test(line))) {
      skipping = false;
      kept.push(line);
    }
  }
  return kept;
}

/** `text` with `top` as its first frontmatter keys and the `removed` keys gone, in its own line endings. */
function rewritten(text: string, top: NewKeys["top"], removed: readonly string[]): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const close = fenceClose(lines);
  const head = emitYaml(top)
    .split("\n")
    .filter((line) => line !== "");
  return [...lines.slice(0, 1), ...head, ...keptLines(lines.slice(1, close), removed), ...lines.slice(close)].join(eol);
}

/** The lines to print for an upgrade, `@` standing for the doc's path. */
function notesOf(keys: NewKeys, doc: OldDoc, mark: boolean): string[] {
  return [
    ...(keys.parts.length > 0 ? [`rewrote @ frontmatter (${keys.parts.join(", ")})`] : []),
    ...(mark ? [markNote("@", doc.name, doc.kind === "rules" ? "rule" : "subagent")] : []),
  ];
}

/** The parsed doc; null when its frontmatter does not parse. */
function parsedDoc(text: string): ReturnType<typeof parseDoc> | null {
  try {
    return parseDoc("", text);
  } catch {
    return null;
  }
}

/** The new text of an old-format rule or subagent and the lines to print for it; null when it needs nothing. */
function upgradeText(doc: OldDoc): Upgrade | null {
  const parsed = parsedDoc(doc.text);
  if (parsed === null) return null;
  const { data, body } = parsed;
  const carried = OLD_KEYS.filter((key) => key in data);
  if (carried.length === 0) return null;
  const isRule = doc.kind === "rules";
  const removed = carried.filter((key) => isRule || key !== "targets");
  const keys: NewKeys = isRule ? ruleKeys(data, body, doc) : { converted: [], parts: [], top: [] };
  const dropped = removed.filter((key) => !keys.converted.includes(key));
  const mark = doc.stocked && data["overrides"] === undefined;
  if (mark) keys.top.push(["overrides", doc.name]);
  if (dropped.length > 0) keys.parts.push(`${joinAnd(dropped)} dropped`);
  const notes = notesOf(keys, doc, mark);
  return notes.length === 0 ? null : { content: rewritten(doc.text, keys.top, removed), notes };
}

/**
 * The steps that bring a `.repo/` rule or subagent still in the old format to the new one, once: a rule loses
 * `root`, `targets` and `globs` (`globs` become `paths`, none when they cover every file) and gains a `description`
 * from its first `#` heading, else its name; a subagent loses `root` and `globs`, and keeps `targets`, which its
 * generator still reads. Such a file that bears a stock name is marked `overrides: <name>`, since an earlier sync
 * let it replace the stock one. A file in the new format is never touched or marked, so a new same-name file still
 * fails. Each step is the whole new file, so it is planned only while the file is old and a second run plans nothing.
 * A file whose frontmatter does not parse is left for the loader to report.
 */
export function planRuleUpgrade(root: string, stock: string): MigrationStep[] {
  return KINDS.flatMap((kind) => {
    const stocked = stockNames(stock, kind);
    return ownDocs(root, kind).flatMap((file): MigrationStep[] => {
      const rel = `${REPO_DIR}/${kind}/${file}`;
      const name = file.slice(0, -MD.length);
      const text = fs.readFileSync(path.join(root, rel), "utf8");
      const upgraded = upgradeText({ kind, name, stocked: stocked.has(name.toLowerCase()), text });
      if (upgraded === null) return [];
      const note = upgraded.notes.map((line) => line.replace("@", rel)).join("\n");
      return [{ content: upgraded.content, kind: "write", note, path: rel }];
    });
  });
}
