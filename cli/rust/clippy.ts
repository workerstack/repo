import { spawnSync } from "node:child_process";
import { z } from "zod";
import { childEnv } from "../env.ts";
import { toolEnv } from "../scripts/tool-env.ts";
import type { Result } from "../scripts/lint-baseline.ts";
import {
  CARGO,
  CLIPPY_ARGS,
  CLIPPY_PREFIX,
  COMPILER_MESSAGE,
  DOT_SLASH,
  ERROR_CODE,
  ERROR_LEVEL,
  MAX_OUTPUT,
  MISSING_CARGO,
  NOT_FOUND,
  QUOTE_LIMIT,
  WARNING_LEVEL,
} from "./clippy.constants.ts";
import type { RustHit, RustRule } from "./source-checks.ts";

/** What one cargo run left: its exit code (1 when it could not start, null when a signal ended it), output, and whether cargo was not on PATH. */
export type CargoResult = { status: number | null; stdout: string; stderr: string; missing: boolean };
/** Runs cargo with `args` in `root`; tests hand `clippyHits` their own. */
export type CargoRun = (root: string, args: readonly string[]) => CargoResult;

/** Runs the cargo on PATH in `root`, with no `GIT_*` variable. */
export const runCargo: CargoRun = (root, args) => {
  const options = { cwd: root, encoding: "utf8", env: toolEnv(childEnv()), maxBuffer: MAX_OUTPUT } as const;
  const result = spawnSync(CARGO, [...args], options);
  if (result.error) {
    const missing = Reflect.get(result.error, "code") === NOT_FOUND;
    return { status: 1, stdout: "", stderr: result.error.message, missing };
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, missing: false };
};

/** The shapes of the cargo lines this reads, built once per run so the module runs no code. */
function schemas() {
  const span = z.object({
    file_name: z.string(),
    is_primary: z.boolean(),
    line_start: z.number(),
    column_start: z.number(),
  });
  const diagnostic = z.object({
    level: z.string(),
    message: z.string(),
    code: z.object({ code: z.string() }).nullable(),
    spans: z.array(span),
  });
  return { head: z.object({ reason: z.string() }), compilerLine: z.object({ message: diagnostic }) };
}
type Schemas = ReturnType<typeof schemas>;
type Diagnostic = z.infer<Schemas["compilerLine"]>["message"];

/** One output line: a diagnostic, a line to pass over, or one that is not what cargo documents. */
type Read = { kind: "message"; message: Diagnostic } | { kind: "other" } | { kind: "unreadable" };
const OTHER: Read = { kind: "other" };
const UNREADABLE: Read = { kind: "unreadable" };

/** The diagnostic `line` carries, parsed at the edge; every other cargo line is passed over. */
function readLine(line: string, schema: Schemas): Read {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return UNREADABLE;
  }
  const kind = schema.head.safeParse(json);
  if (!kind.success) return UNREADABLE;
  if (kind.data.reason !== COMPILER_MESSAGE) return OTHER;
  const body = schema.compilerLine.safeParse(json);
  return body.success ? { kind: "message", message: body.data.message } : UNREADABLE;
}

/** A cargo path as a root-relative POSIX path: backslashes become slashes, a leading `./` goes. */
const posix = (file: string): string => file.replaceAll("\\", "/").replace(DOT_SLASH, "");

/** `clippy::unwrap_used` is `clippy/unwrap_used`; a rustc lint such as `unreachable_pub` is `rust/unreachable_pub`. */
function ruleOf(code: string): RustRule {
  return code.startsWith(CLIPPY_PREFIX) ? `clippy/${code.slice(CLIPPY_PREFIX.length)}` : `rust/${code}`;
}

const primaryOf = (message: Diagnostic) => message.spans.find((s) => s.is_primary);

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
  const failed = message.level === ERROR_LEVEL;
  const code = message.code?.code;
  if (code === undefined || ERROR_CODE.test(code)) return failed ? { problem: problemOf(message) } : null;
  if (!failed && message.level !== WARNING_LEVEL) return null;
  const where = primaryOf(message);
  if (where === undefined) return { problem: `cargo clippy: ${message.message} has a lint code but no primary span` };
  const file = posix(where.file_name);
  return {
    hit: { file, line: where.line_start, column: where.column_start, rule: ruleOf(code), message: message.message },
  };
}

/** What the output held: the distinct hits and problems in order, and whether any message was an error. */
type Found = { hits: Map<string, RustHit>; problems: Set<string>; errored: boolean };

/** Reads every line of `stdout`; the lib and test targets print a lint twice, so a hit counts once per place and rule. */
function collect(stdout: string): Found {
  const found: Found = { hits: new Map(), problems: new Set(), errored: false };
  const schema = schemas();
  for (const line of stdout.split(/\r?\n/).filter((text) => text.trim() !== "")) {
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
  const result = run(root, CLIPPY_ARGS);
  if (result.missing) return { ok: false, errors: [MISSING_CARGO] };
  const found = collect(result.stdout);
  const problems = [...found.problems];
  if (result.status !== 0 && !found.errored) {
    const detail = result.stderr.trim();
    problems.push(`cargo clippy exited ${result.status} and printed no error${detail === "" ? "" : `: ${detail}`}`);
  }
  return problems.length > 0 ? { ok: false, errors: problems } : { ok: true, value: [...found.hits.values()] };
}
