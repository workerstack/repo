import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { childEnv } from "../env.ts";
import { tryJson } from "../json.ts";
import type { Result } from "../result.ts";
import { toolEnv } from "../scripts/tool-env.ts";
import {
  CARGO,
  CLIPPY_ARGS,
  CLIPPY_PREFIX,
  COMPILER_MESSAGE,
  DOT_SLASH,
  ERROR_CODE,
  ERROR_LEVEL,
  LINE_BREAK,
  LOCK_FILE,
  MAX_OUTPUT,
  MISSING_CARGO,
  NOT_FOUND,
  QUOTE_LIMIT,
  STALE_STATUS,
  WARNING_LEVEL,
} from "./clippy.constants.ts";
import { MISSING_LOCK, STALE_LOCK, STALE_MARKER } from "./lock.constants.ts";
import type { RustHit, RustRule } from "./source-checks.ts";

/**
 * What one cargo run left: its exit code (1 when it could not start, null when a signal ended it), output, and whether
 * cargo was not on PATH.
 */
export type CargoResult = { status: number | null; stdout: string; stderr: string; missing: boolean };

/** Runs cargo with `args` in `root`; tests hand `clippyHits` their own. */
export type CargoRun = (root: string, args: readonly string[]) => CargoResult;

/** Runs the cargo on PATH in `root`, with no `GIT_*` variable. */
export function runCargo(root: string, args: readonly string[]): CargoResult {
  const options = { cwd: root, encoding: "utf8", env: toolEnv(childEnv()), maxBuffer: MAX_OUTPUT } as const;
  const result = spawnSync(CARGO, [...args], options);

  if (result.error !== undefined) {
    const isMissing = "code" in result.error && result.error.code === NOT_FOUND;

    return { missing: isMissing, status: 1, stderr: result.error.message, stdout: "" };
  }

  return { missing: false, status: result.status, stderr: result.stderr, stdout: result.stdout };
}

/** The shapes of the cargo lines this reads, built once per run so the module runs no code. */
function schemas() {
  const span = z.object({
    column_start: z.number(),
    file_name: z.string(),
    is_primary: z.boolean(),
    line_start: z.number(),
  });

  const diagnostic = z.object({
    code: z.object({ code: z.string() }).nullable(),
    level: z.string(),
    message: z.string(),
    spans: z.array(span),
  });

  return { compilerLine: z.object({ message: diagnostic }), head: z.looseObject({ reason: z.string() }) };
}

type Schemas = ReturnType<typeof schemas>;

type Diagnostic = z.infer<Schemas["compilerLine"]>["message"];

/** One output line: a diagnostic, a line to pass over, or one that is not what cargo documents. */
type Read = { kind: "message"; message: Diagnostic } | { kind: "other" } | { kind: "unreadable" };

const OTHER: Read = { kind: "other" };
const UNREADABLE: Read = { kind: "unreadable" };

/** The diagnostic `line` carries, parsed at the edge; every other cargo line is passed over. */
function readLine(line: string, schema: Schemas): Read {
  // Loose, so the line passes through whole to the compiler line schema.
  const json = tryJson(schema.head, line);

  if (json === undefined) return UNREADABLE;

  if (json.reason !== COMPILER_MESSAGE) return OTHER;
  const body = schema.compilerLine.safeParse(json);

  return body.success ? { kind: "message", message: body.data.message } : UNREADABLE;
}

/** A cargo path as a root-relative POSIX path: backslashes become slashes, a leading `./` goes. */
function posix(file: string): string {
  return file.replaceAll("\\", "/").replace(DOT_SLASH, "");
}

/** `clippy::unwrap_used` is `clippy/unwrap_used`; a rustc lint such as `unreachable_pub` is `rust/unreachable_pub`. */
function ruleOf(code: string): RustRule {
  return code.startsWith(CLIPPY_PREFIX) ? `clippy/${code.slice(CLIPPY_PREFIX.length)}` : `rust/${code}`;
}

function primaryOf(message: Diagnostic) {
  return message.spans.find((s) => s.is_primary);
}

/** An error that is not a lint, as `error[E0308]: mismatched types (src/lib.rs:1)`. */
function problemOf(message: Diagnostic): string {
  const where = primaryOf(message);
  const place = where === undefined ? "" : ` (${posix(where.file_name)}:${where.line_start})`;
  const code = message.code === null ? "" : `[${message.code.code}]`;

  return `cargo clippy: error${code}: ${message.message}${place}`;
}

/** What one diagnostic is: a hit, a problem, or nothing to report. */
type Judged = { hit: RustHit } | { problem: string } | null;

/** A lint at the warning or error level is a hit at its primary span; an error with no lint code is a problem. */
function judge(message: Diagnostic): Judged {
  const isFailed = message.level === ERROR_LEVEL;
  const code = message.code?.code;

  if (code === undefined || ERROR_CODE.test(code)) return isFailed ? { problem: problemOf(message) } : null;

  if (!isFailed && message.level !== WARNING_LEVEL) return null;
  const where = primaryOf(message);

  if (where === undefined) return { problem: `cargo clippy: ${message.message} has a lint code but no primary span` };
  const file = posix(where.file_name);

  return {
    hit: { column: where.column_start, file, line: where.line_start, message: message.message, rule: ruleOf(code) },
  };
}

/** What the output held: the distinct hits and problems in order, and whether any message was an error. */
type Found = { hits: Map<string, RustHit>; problems: Set<string>; errored: boolean };

/**
 * Reads every line of `stdout`; the lib and test targets print a lint twice, so a hit counts once per place and rule.
 */
function collect(stdout: string): Found {
  const found: Found = { errored: false, hits: new Map(), problems: new Set() };
  const schema = schemas();

  for (const line of stdout.split(LINE_BREAK).filter((text) => text.trim() !== "")) {
    const read = readLine(line, schema);

    if (read.kind === "unreadable") {
      const quoted = line.length > QUOTE_LIMIT ? `${line.slice(0, QUOTE_LIMIT)}...` : line;
      found.problems.add(`cargo clippy printed a line repo cannot read: ${quoted}`);
    }

    if (read.kind !== "message") continue;
    found.errored ||= read.message.level === ERROR_LEVEL;
    const judged = judge(read.message);

    if (judged === null) continue;

    if ("problem" in judged) found.problems.add(judged.problem);
    else found.hits.set(`${judged.hit.file}:${judged.hit.line}:${judged.hit.column}:${judged.hit.rule}`, judged.hit);
  }

  return found;
}

/**
 * The hits of `cargo clippy` over the crate or workspace at `root`, run at the repo's levels. A compile error (an error
 * with no lint code), a failed build that names no error, a line cargo should not print and a missing cargo are
 * problems: the code was not linted, so no hit count would be true.
 */
export function clippyHits(root: string, run: CargoRun): Result<RustHit[]> {
  if (!fs.existsSync(path.join(root, LOCK_FILE))) return { error: [MISSING_LOCK], ok: false };
  const result = run(root, CLIPPY_ARGS);

  if (result.missing) return { error: [MISSING_CARGO], ok: false };

  if (result.status === STALE_STATUS && result.stderr.includes(STALE_MARKER)) return { error: [STALE_LOCK], ok: false };
  const found = collect(result.stdout);
  const problems = [...found.problems];

  if (result.status !== 0 && !found.errored) {
    const detail = result.stderr.trim();
    problems.push(`cargo clippy exited ${result.status} and printed no error${detail === "" ? "" : `: ${detail}`}`);
  }

  return problems.length > 0 ? { error: problems, ok: false } : { ok: true, value: [...found.hits.values()] };
}
