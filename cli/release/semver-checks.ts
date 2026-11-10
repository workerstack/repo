import path from "node:path";
import type { CargoRun } from "../rust/clippy.ts";
import { quote } from "../rust/cargo-tools.ts";
import { HEADER, isBreaking } from "../conventional.ts";
import { baselineOf } from "./crates-index.ts";
import {
  CHECK_ARGS,
  EXIT_BREAKING,
  FAILED_IN,
  FEAT_TYPE,
  FAILURE_HEADER,
  ITEM_LOCATION,
  LAST,
  MANIFEST_FILE,
  SUMMARY,
  UNSAID_LEVEL,
} from "./semver-checks.constants.ts";
import type { Commit } from "./version.ts";

/** One line of the report: whether the crate passed, and what to tell the person. */
export type Line = { ok: boolean; text: string };
/** A published crate as `cargo metadata` names it, as far as the check reads it. */
export type SemverCrate = { name: string; version: string; manifest_path: string };
/** What the check calls out: cargo, the crates.io index, and the crate directory's commits since a time. */
export type SemverDeps = {
  run: CargoRun;
  fetch: Parameters<typeof baselineOf>[1];
  git: (after: { since: string; dir: string }) => Commit[];
};
type Level = "major" | "minor" | "patch";

/** The release the crate's commits ask for: breaking is major from 1.0 and minor before it; a feat is a minor from 1.0. */
function levelOf(version: string, commits: readonly Commit[]): Level {
  const stable = !version.startsWith("0.");
  if (commits.some(({ subject, body }) => isBreaking(subject, body.split("\n")))) return stable ? "major" : "minor";
  const feat = commits.some(({ subject }) => HEADER.exec(subject)?.groups?.["type"] === FEAT_TYPE);
  return stable && feat ? "minor" : "patch";
}

type Block = { lint: string; what: string; items: string[] };
type Scan = { blocks: Block[]; level: string; items: boolean };

/** The release a summary line names, else the one so far. */
const levelFrom = (summary: Record<string, string | undefined> | undefined, so: string): string =>
  String(summary?.["level"] ?? so);

/** A header's lint and what it says, as a block with no items yet. */
const blockOf = (header: Record<string, string | undefined>): Block => ({
  lint: String(header["lint"]),
  what: String(header["what"]),
  items: [],
});

/** Adds a non-blank line to the last block's items, without the location the tool appends. */
function addItem(blocks: Block[], line: string): void {
  if (line !== "") blocks.at(LAST)?.items.push(line.replace(ITEM_LOCATION, ""));
}

/** Folds one output line into the scan: a header opens a block, `Failed in:` opens its items, a blank line closes them, the summary names the release. */
function scanLine(scan: Scan, raw: string): Scan {
  const line = raw.trim();
  const header = FAILURE_HEADER.exec(line)?.groups;
  const summary = SUMMARY.exec(line)?.groups;
  const marker = header !== undefined || summary !== undefined;
  const blocks = header ? [...scan.blocks, blockOf(header)] : scan.blocks;
  if (scan.items && !marker) addItem(blocks, line);
  return {
    blocks,
    level: levelFrom(summary, scan.level),
    items: !marker && line !== "" && (scan.items || line === FAILED_IN),
  };
}

/** The failed lints with the items under each, and the release the summary asks for; the tool writes the blocks to stdout and the summary to either stream. */
function failures(stdout: string, stderr: string): { blocks: Block[]; level: string } {
  const text = `${stdout}\n\n${stderr}`;
  const { blocks, level } = text.split("\n").reduce(scanLine, { blocks: [], level: UNSAID_LEVEL, items: false });
  return { blocks, level };
}

/** The first line of stderr that says `error`, else its first line, quoted. */
function firstError(stderr: string): string {
  const lines = stderr.split("\n").filter((line) => line.trim() !== "");
  return quote(lines.find((line) => line.startsWith("error")) ?? lines[0] ?? "no output");
}

/** How a crate's line reads: its name, what it says when it passes, and what to do when it fails. */
type Shown = { name: string; from: string; ok: string; advice: string };

/** The line for a run: ok, one line per failed lint, or the quoted error. */
function report(shown: Shown, run: ReturnType<CargoRun>): Line {
  const exit = run.status ?? "by signal";
  if (exit === 0) return { ok: true, text: shown.ok };
  const { blocks, level } = failures(run.stdout, run.stderr);
  if (exit !== EXIT_BREAKING || blocks.length === 0) {
    return { ok: false, text: `cargo semver-checks exited ${exit} for ${shown.name}: ${firstError(run.stderr)}` };
  }
  const lines = blocks.map(({ lint, what, items }) => {
    return `${shown.from} needs a ${level} release: ${items.join("; ")} (${lint}: ${what}); ${shown.advice}`;
  });
  return { ok: false, text: lines.join("\n") };
}

/** The check of one crate against its crates.io baseline: the line to print, and whether it passed. */
export async function crateLine(root: string, crate: SemverCrate, deps: SemverDeps): Promise<Line> {
  const { name } = crate;
  const baseline = await baselineOf(crate, deps.fetch);
  if (baseline.kind === "absent")
    return { ok: true, text: `crate ${name} is not on crates.io yet; nothing to compare` };
  if (baseline.kind === "failed") return { ok: false, text: baseline.line };
  const bumped = baseline.version !== crate.version;
  const dir = path.dirname(crate.manifest_path);
  const level =
    bumped || baseline.published === null
      ? "patch"
      : levelOf(crate.version, deps.git({ since: baseline.published, dir }));
  const args = [...CHECK_ARGS, "--manifest-path", path.join(root, MANIFEST_FILE), "-p", name];
  args.push("--baseline-version", baseline.version, ...(bumped ? [] : ["--release-type", level]));
  const from = `crate ${name} ${baseline.version} → this checkout`;
  const shown: Shown = bumped
    ? {
        name,
        from,
        ok: `crate ${name} ${baseline.version} → this checkout · ${crate.version} in Cargo.toml · ok`,
        advice: `restore it or bump ${name}'s version further`,
      }
    : {
        name,
        from,
        ok: `crate ${name} ${baseline.version} from crates.io → this checkout · ${level} · ok`,
        advice: `restore it, bump ${name}'s version, or mark a commit breaking with \`!\``,
      };
  return report(shown, deps.run(root, args));
}
