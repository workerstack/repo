import { z } from "zod";

import {
  DENY_ERROR,
  DIAGNOSTIC_TYPE,
  DENY_SECTIONS,
  FETCH_FAILED,
  LOG_ERROR,
  LOG_TYPE,
  NO_SUCH_COMMAND,
  QUOTE_LIMIT,
  SEMVER,
  UNLICENSED_CODES,
  type Pin,
} from "./cargo-tools.constants.ts";
import { MISSING_CARGO } from "./clippy.constants.ts";
import type { CargoRun } from "./clippy.ts";

/** The shapes of the tool output this reads, built once per run so the module runs no code. */
function schemas() {
  const label = z.object({ message: z.string(), span: z.string() });
  const diagnostic = z.object({
    fields: z.object({
      code: z.string().optional(),
      graphs: z.array(z.unknown()).optional(),
      labels: z.array(label).optional(),
      message: z.string(),
      severity: z.string(),
    }),
    type: z.literal("diagnostic"),
  });
  const log = z.object({ fields: z.object({ level: z.string(), message: z.string() }), type: z.literal("log") });
  const krate = z.object({ Krate: z.object({ name: z.string(), version: z.string() }) });
  return {
    diagnostic,
    head: z.object({ type: z.string() }),
    krate,
    log,
  };
}
type Schemas = ReturnType<typeof schemas>;

/** Up to `QUOTE_LIMIT` characters of `text`, trimmed, with `...` when it was longer. */
export function quote(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > QUOTE_LIMIT ? `${trimmed.slice(0, QUOTE_LIMIT)}...` : trimmed;
}

const installLine = (pin: Pin): string => `cargo install --locked cargo-${pin.tool}@${pin.version}`;

/**
 * Why the cargo tool `pin.tool` cannot be trusted in `root`: not installed, or not the pinned version. `null` when
 * `cargo <tool> --version` prints the pin.
 */
export function pinProblem(root: string, run: CargoRun, pin: Pin): string | null {
  const name = `cargo-${pin.tool}`;
  const result = run(root, [pin.tool, "--version"]);
  if (result.missing || result.stderr.includes(NO_SUCH_COMMAND))
    return `${name} is not installed; run \`${installLine(pin)}\``;

  const found = SEMVER.exec(result.stdout)?.[0];
  if (found === undefined) {
    const said = quote(result.stdout + result.stderr);
    return result.status === 0
      ? `${name} printed a version repo cannot read: ${said}`
      : `${name} --version exited ${result.status}: ${said}`;
  }
  return found === pin.version
    ? null
    : `${name} ${found} is installed but repo pins ${pin.version}; run \`${installLine(pin)}\``;
}

/** What one cargo-deny line is: a problem, a line to pass over, or one repo cannot read. */
type DenyLine = { problem: string } | { pass: true } | { left: true } | { unreadable: true };
const PASS: DenyLine = { pass: true };
const LEFT: DenyLine = { left: true };
/** A crate cargo-deny names in a diagnostic graph. */
type Krate = { name: string; version: string };

/** The first graph that names a crate, or nothing. */
function krateOf(graphs: readonly unknown[] | undefined, schema: Schemas): Krate | null {
  for (const graph of graphs ?? []) {
    const krate = schema.krate.safeParse(graph);
    if (krate.success) return krate.data.Krate;
  }
  return null;
}

/** `b 0.1.0: ` for the crate a diagnostic names, or nothing. */
const crateOf = (krate: Krate | null): string => (krate === null ? "" : `${krate.name} ${krate.version}: `);

/** One error diagnostic as a line: section, crate, message and the first label that says something. */
function diagnosticLine(d: z.infer<Schemas["diagnostic"]>["fields"], krate: Krate | null): string {
  const section = Object.entries(DENY_SECTIONS).find(
    ([, codes]) => d.code !== undefined && codes.includes(d.code),
  )?.[0];
  const label = d.labels?.find((l) => l.message !== "");
  const where = label === undefined ? "" : ` (${label.span}: ${label.message})`;
  return `cargo deny: ${section === undefined ? "" : `${section}: `}${crateOf(krate)}${d.message}${where}`;
}

/** The line for an error log: the fetch failure names its URL and what to do, any other shows its first line. */
function logLine(message: string): string {
  if (!message.startsWith(FETCH_FAILED)) return `cargo deny: ${message.split("\n")[0]}`;
  const url = message.slice(FETCH_FAILED.length).trim().split(/\s/)[0];
  return `cargo deny: ${FETCH_FAILED} ${url}; check the network and rerun`;
}

/** An error diagnostic as a line, or a pass when it says a crate in `left` has no license (the crate check owns that). */
type Fields = z.infer<Schemas["diagnostic"]>["fields"];
function denyDiagnostic(fields: Fields, schema: Schemas, left: ReadonlySet<string>): DenyLine {
  const krate = krateOf(fields.graphs, schema);
  const unlicensed = fields.code !== undefined && UNLICENSED_CODES.includes(fields.code);
  return unlicensed && krate !== null && left.has(krate.name) ? LEFT : { problem: diagnosticLine(fields, krate) };
}

/** Reads one stderr line of cargo-deny. */
function readDeny(line: string, schema: Schemas, left: ReadonlySet<string>): DenyLine {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { unreadable: true };
  }
  const head = schema.head.safeParse(json);
  if (!head.success) return { unreadable: true };
  const diagnostic = schema.diagnostic.safeParse(json);
  if (diagnostic.success) {
    const fields = diagnostic.data.fields;
    return fields.severity === DENY_ERROR ? denyDiagnostic(fields, schema, left) : PASS;
  }
  const log = schema.log.safeParse(json);
  if (log.success) return log.data.fields.level === LOG_ERROR ? { problem: logLine(log.data.fields.message) } : PASS;
  return head.data.type === DIAGNOSTIC_TYPE || head.data.type === LOG_TYPE ? { unreadable: true } : PASS;
}

/**
 * The errors of `cargo deny check` at `root`: each error diagnostic and error log as one line, a line repo cannot read,
 * and a failed run that printed no error. Warnings are not problems. A no-license error for a crate named in `left` is
 * left out, as the crate check already reports it; a failed run that printed only those still says it exited.
 */
export function denyProblems(root: string, run: CargoRun, left: ReadonlySet<string> = new Set()): string[] {
  const result = run(root, ["deny", "--locked", "--format", "json", "check"]);
  if (result.missing) return [MISSING_CARGO];
  const schema = schemas();
  const lines = result.stderr.split(/\r?\n/).filter((text) => text.trim() !== "");
  const reads = lines.map((line) => ({ line, read: readDeny(line, schema, left) }));
  const problems = new Set<string>();
  for (const { line, read } of reads) {
    if ("problem" in read) problems.add(read.problem);
    if ("unreadable" in read) problems.add(`cargo deny printed a line repo cannot read: ${quote(line)}`);
  }
  // An error line, even one left out, explains a failed run.
  const errored = reads.some(({ read }) => "problem" in read || "left" in read);
  if (result.status !== 0 && !errored && problems.size === 0) {
    const detail = quote(result.stderr);
    problems.add(`cargo deny exited ${result.status} and printed no error${detail === "" ? "" : `: ${detail}`}`);
  }
  return [...problems];
}
