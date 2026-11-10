import path from "node:path";
import { z } from "zod";
import { MISSING_CARGO, QUOTE_LIMIT } from "./clippy.constants.ts";
import type { CargoRun } from "./clippy.ts";
import { METADATA_ARGS, PROBLEM_TAIL, STALE_EXIT } from "./cargo-metadata.constants.ts";
import { STALE_MARKER } from "./lock.constants.ts";

/** What the crate check found: its problems and which publishable crates lack a license (cargo-deny need not say so again), a stale lock (the lock check owns that line), or a run it could not read. */
export type CrateCheck =
  | { kind: "checked"; problems: string[]; unlicensed: ReadonlySet<string> }
  | { kind: "stale" }
  | { kind: "failed"; problems: string[] };

/** A manifest field that may be absent or null; cargo prints null for a field the crate does not set. */
const text = () => z.string().nullish();

/** The shape of `cargo metadata --format-version 1` this reads, built once per run. */
function schema() {
  const crate = z.object({
    name: z.string(),
    manifest_path: z.string(),
    publish: z.array(z.string()).nullish(),
    rust_version: text(),
    license: text(),
    license_file: text(),
    description: text(),
    repository: text(),
  });
  return z.object({ packages: z.array(crate.extend({ id: z.string() })), workspace_members: z.array(z.string()) });
}
type Crate = z.infer<ReturnType<typeof schema>>["packages"][number];

const blank = (value: string | null | undefined) => value === undefined || value === null || value.trim() === "";
/** A crate is private when `publish = false` (an empty list); unset or a registry list is publishable. */
const publishable = (crate: Crate) => crate.publish === undefined || crate.publish === null || crate.publish.length > 0;

/** The names, in the order of the manifest keys a person adds, of the fields the crate lacks. */
function missingOf(crate: Crate): string[] {
  const lacks: [string, boolean][] = [
    ["license", blank(crate.license) && blank(crate.license_file)],
    ["description", blank(crate.description)],
    ["repository", blank(crate.repository)],
    ["rust-version", blank(crate.rust_version)],
  ];
  return lacks.filter(([, lacking]) => lacking).map(([field]) => field);
}

/** A cargo path as a root-relative POSIX path; cargo prints native separators, so a Windows path has backslashes. */
function relative(root: string, file: string): string {
  const posix = (value: string) => value.replaceAll("\\", "/");
  return path.posix.relative(posix(root), posix(file));
}

/** The problem line of `crate`, or none when it is private or complete. */
function problemOf(root: string, crate: Crate): string | null {
  const missing = publishable(crate) ? missingOf(crate) : [];
  if (missing.length === 0) return null;
  const where = relative(root, crate.manifest_path);
  return `crate ${crate.name} (${where}) is publishable but has no ${missing.join(", ")}; ${PROBLEM_TAIL}`;
}

const quote = (value: string) => (value.length > QUOTE_LIMIT ? `${value.slice(0, QUOTE_LIMIT)}...` : value);

/** `cargo metadata` output, parsed at the edge: the crates, or the quoted output that was not that. */
function parse(root: string, stdout: string): CrateCheck {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = null;
  }
  const read = schema().safeParse(json);
  if (!read.success)
    return { kind: "failed", problems: [`cargo metadata printed output repo cannot read: ${quote(stdout.trim())}`] };
  const members = new Set(read.data.workspace_members);
  const crates = read.data.packages.filter((crate) => members.has(crate.id));
  const problems = crates.map((crate) => problemOf(root, crate));
  const unlicensed = crates.filter((crate) => publishable(crate) && missingOf(crate).includes("license"));
  return {
    kind: "checked",
    problems: problems.filter((line) => line !== null),
    unlicensed: new Set(unlicensed.map((crate) => crate.name)),
  };
}

/**
 * The publish-field problems of the workspace crates under `root`, one line per crate. A lock that needs an update is `stale`
 * (clippy's run says so once); any other failed or unreadable run is `failed`, quoting what cargo said.
 */
export function crateProblems(root: string, run: CargoRun): CrateCheck {
  const result = run(root, METADATA_ARGS);
  if (result.missing) return { kind: "failed", problems: [MISSING_CARGO] };
  if (result.status === STALE_EXIT && result.stderr.includes(STALE_MARKER)) return { kind: "stale" };
  if (result.status !== 0) {
    const detail = quote(result.stderr.trim());
    return { kind: "failed", problems: [`cargo metadata exited ${result.status ?? "by signal"}: ${detail}`] };
  }
  return parse(root, result.stdout);
}
