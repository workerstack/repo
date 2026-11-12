/**
 * The handover: text the user kept where the old layout put it moves to the files that are theirs now. A pathless
 * `.repo/rules` file goes below the `repo:rules` region of its scope's `AGENTS.md`; the servers of `.repo/mcp.json`
 * and of the policy's `servers` go into `.mcp.json`, whose own server wins on a name in both. A step is planned only
 * while its source is there, so a run that stopped anywhere is finished by planning again.
 */
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { applyEdits, modify, parse } from "jsonc-parser";
import { z } from "zod";

import { isRecord, type JsonObject } from "../json.ts";
import { AGENTS_FILE } from "./agents-file.constants.ts";
import { userText } from "./agents-file.ts";
import { type ParsedDoc, parseDoc } from "./agents/frontmatter.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import { hasOwnedHeader } from "./header.ts";
import { PREFIX } from "./migrate.constants.ts";
import type { MigrationStep } from "./migrate.ts";
import { parseMcpJson } from "./parse-mcp-json.ts";
import type { StockHistory } from "./stock-history.ts";
import { OWNER_WRITE } from "./write.constants.ts";

const RULES_DIR = ".repo/rules";

/** The one row of the blank line that sets a paragraph apart. */
const BLANK_LINE = 1;
const MCP_JSON = ".mcp.json";
const OVERLAY = ".repo/mcp.json";
const POLICY = ".repo/mcp-policy.jsonc";
const SERVERS_KEY = "servers";
const JSON_INDENT = 2;
const FIX = "fix it, nothing written";

const MADE_YOURS = {
  done: "made .mcp.json yours: writable, without the generated header",
  would: "would make .mcp.json yours: writable, without the generated header",
};

type Handover = Extract<MigrationStep, { kind: "handover" }>;

type Write = Handover["writes"][number];

/** A source that could not be read, and why. */
type Failed = { rel: string; error: string };

/** A file whose servers go into `.mcp.json`: what else is written and removed with them, and what its step says. */
type Read = {
  rel: string;
  servers: JsonObject;
  writes: Write[];
  remove: string[];
  what: { done: string; would: string };
};

type Source = Read | Failed;

/**
 * What the handover reads beside the files: the workspace package dirs, and the stock history `AGENTS.md` is read
 * with.
 */
export type HandoverInput = { packages: readonly string[]; history: StockHistory };

/**
 * The handover steps for `root`: the rule moves of each scope, then the server moves; none once nothing is left to
 * move.
 */
export function planHandover(root: string, input: HandoverInput): MigrationStep[] {
  const rules = ["", ...input.packages].flatMap((scope) => ruleSteps(root, scope, input.history));

  return [...rules, ...mcpSteps(root)];
}

/** The text of the file at `rel`, null when it is missing or cannot be read. */
function readOrNull(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
}

/** One step; its first line says what moved, `--check` says what would. */
function step(what: { done: string; would: string }, files: Pick<Handover, "writes" | "remove">, notes: string[] = []) {
  const handover: Handover = {
    kind: "handover",
    ...files,
    note: [what.done, ...notes].join("\n"),
    pending: what.would,
  };

  return handover;
}

function moved(what: string) {
  return { done: `moved ${what}`, would: `would move ${what}` };
}

/**
 * One step per pathless rule of `scope`, each moving its body to the end of the user text of the scope's `AGENTS.md`:
 * an old install put the bodies between the head and the tail of its stock rules, so they come out of there first.
 */
function ruleSteps(root: string, scope: string, history: StockHistory): Handover[] {
  const agents = path.posix.join(scope, AGENTS_FILE);
  const rules = pathlessRules(root, path.posix.join(scope, RULES_DIR));
  const disk = readOrNull(root, agents);
  let cut = disk;

  for (const { body } of rules) cut = cut === null ? null : withoutParagraph(cut, body);
  // The body is rendered after the handover, so the history alone finds the stock rules. They stay where they stood,
  // for the sync that renders the region to put it in their place.
  const user = userText(agents, { history, text: cut }, "");
  let text = `${user.above}${user.stock}${user.below}`;

  return rules.map(({ rel, body }) => {
    text = appended(text, body);
    const files = { remove: [rel], writes: [{ content: text, path: agents }] };

    return step(moved(`${rel} into ${agents} below repo:rules`), files);
  });
}

/**
 * The `.md` rules directly in `dir` with frontmatter and no `paths`, by name. A rule that does not parse stays for sync
 * to report, and one that `overrides` a stock rule stays, as it is what keeps that rule out of the region.
 */
function pathlessRules(root: string, dir: string): { rel: string; body: string }[] {
  let names: string[];

  try {
    names = fs.readdirSync(path.join(root, dir)).toSorted(byCodeUnit);
  } catch {
    return [];
  }

  return names.flatMap((name) => {
    const rel = `${dir}/${name}`;
    const doc = name.endsWith(".md") ? docOf(rel, readOrNull(root, rel)) : null;
    const kept = doc === null || doc.data["paths"] !== undefined || doc.data["overrides"] !== undefined;

    return kept ? [] : [{ body: doc.body, rel }];
  });
}

function docOf(rel: string, text: string | null): ParsedDoc | null {
  try {
    return text === null ? null : parseDoc(rel, text);
  } catch {
    return null;
  }
}

/**
 * `text` without the first paragraph of its own that is `body`, and the blank line after it, so one blank line stays
 * between the paragraphs around it; unchanged when no paragraph is, or `body` is blank.
 */
function withoutParagraph(text: string, body: string): string {
  if (body.trim() === "") return text;
  const want = body.trimEnd().split("\n");
  const rows = text.split("\n");

  const at = rows.findIndex(
    (_row, index) =>
      (rows[index - 1] ?? "") === "" &&
      want.every((line, offset) => rows[index + offset] === line) &&
      (rows[index + want.length] ?? "") === "",
  );

  if (at < 0) return text;
  rows.splice(at, want.length + BLANK_LINE);

  return rows.join("\n");
}

/**
 * `text` with `body` as a paragraph of its own at the end; unchanged when it already holds `body`, as after a
 * crash.
 */
function appended(text: string, body: string): string {
  if (text.includes(body)) return text;
  const kept = text.trimEnd();

  return `${kept}${kept === "" ? "" : "\n\n"}${body}\n`;
}

/** The server moves into `.mcp.json`, or the one step that makes it the user's file when nothing moves. */
function mcpSteps(root: string): MigrationStep[] {
  const disk = readOrNull(root, MCP_JSON);
  const yours = madeYours(root, disk);
  const sources = [overlaySource(root), policySource(root)].flatMap((source) => source ?? []);

  if (sources.length === 0) return yours;
  const own = disk === null ? null : withoutHeader(disk);
  const parsed = parseMcpJson(own);

  if (!parsed.ok) return [conflict({ error: parsed.error, rel: MCP_JSON })];
  const failed = sources.find((source): source is Failed => "error" in source);

  if (failed !== undefined) return [conflict(failed)];
  const read = sources.filter((source): source is Read => !("error" in source));

  return mergeSteps({ fix: yours.length > 0, own, servers: parsed.servers }, read);
}

/** The step that stops the run on a source that could not be read. */
function conflict(failed: Failed): MigrationStep {
  return { from: failed.rel, kind: "conflict", line: `${PREFIX}mcp policy: ${failed.error}`, to: MCP_JSON };
}

/**
 * The step that makes `.mcp.json` the user's when an older sync left it read-only or with its header; none
 * otherwise.
 */
function madeYours(root: string, disk: string | null): Handover[] {
  if (disk === null) return [];
  const own = withoutHeader(disk);
  const files = { remove: [], writes: [{ content: own, path: MCP_JSON }] };

  return own !== disk || locked(root, MCP_JSON) ? [step(MADE_YOURS, files)] : [];
}

/** The text of `.mcp.json` without the header an older sync stamped on it. */
function withoutHeader(disk: string): string {
  return hasOwnedHeader(disk) ? disk.split("\n").slice(1).join("\n") : disk;
}

/**
 * One step per source, each writing `.mcp.json` with the servers so far when it adds one or, first, must make it the
 * user's.
 */
function mergeSteps(start: { servers: JsonObject; own: string | null; fix: boolean }, sources: Read[]): Handover[] {
  const whole: JsonObject =
    start.own === null ? {} : (parse(start.own) /* parseMcpJson found it a JSON object */ as JsonObject);

  let servers = start.servers;

  return sources.map((source, index) => {
    const notes: string[] = [];

    const added = Object.entries(source.servers).filter(([name, spec]) => {
      if (!Object.hasOwn(servers, name)) return true;

      if (!isDeepStrictEqual(servers[name], spec))
        notes.push(`kept .mcp.json's own "${name}" server; dropped the one in ${source.rel}`);

      return false;
    });

    servers = { ...servers, ...Object.fromEntries(added) };
    const content = `${JSON.stringify({ ...whole, mcpServers: servers }, null, JSON_INDENT)}\n`;
    const write = added.length > 0 || (start.fix && index === 0);

    return step(
      source.what,
      { remove: source.remove, writes: write ? [{ content, path: MCP_JSON }, ...source.writes] : source.writes },
      notes,
    );
  });
}

const EMPTY_POLICY = {
  done: `removed the empty ${SERVERS_KEY} key of ${POLICY}`,
  would: `would remove the empty ${SERVERS_KEY} key of ${POLICY}`,
};

function movedServers(rel: string) {
  return moved(`${rel} servers into ${MCP_JSON}`);
}

/** `.repo/mcp.json` as a source, removed once its servers moved; null when there is none. */
function overlaySource(root: string): Source | null {
  const text = readOrNull(root, OVERLAY);

  if (text === null) return null;
  const parsed = parseMcpJson(text);

  if (!parsed.ok) return { error: parsed.error.replace(MCP_JSON, OVERLAY), rel: OVERLAY };

  return { rel: OVERLAY, remove: [OVERLAY], servers: parsed.servers, what: movedServers(OVERLAY), writes: [] };
}

/**
 * The `servers` of `.repo/mcp-policy.jsonc` as a source, the key edited out with its comments kept; null without the
 * key.
 */
function policySource(root: string): Source | null {
  const text = readOrNull(root, POLICY);

  const policy = z
    .json()
    .catch(null)
    .parse(text === null ? null : parse(text));

  if (text === null || !isRecord(policy) || !Object.hasOwn(policy, SERVERS_KEY)) return null;
  const servers = policy[SERVERS_KEY];

  if (!isRecord(servers)) return { error: `${POLICY}: ${SERVERS_KEY} is not an object; ${FIX}`, rel: POLICY };
  const content = applyEdits(text, modify(text, [SERVERS_KEY], undefined, {}));
  const what = Object.keys(servers).length === 0 ? EMPTY_POLICY : movedServers(POLICY);

  return { rel: POLICY, remove: [], servers, what, writes: [{ content, path: POLICY }] };
}

/** Whether the owner may not write the file at `rel`, as an older sync left the files it owned whole. */
function locked(root: string, rel: string): boolean {
  return (fs.statSync(path.join(root, rel)).mode & OWNER_WRITE) === 0;
}
