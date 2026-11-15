/**
 * `repo update [--check] [--major] [<name>|@scope/*…]` lists and bumps outdated catalog and manifest versions; a bare
 * run holds major bumps.
 */
import { findRoot } from "./config.ts";
import { matchesName } from "./matches-name.ts";
import { readWorkspace } from "./sync/workspace.ts";
import { updateChanges } from "./update-changes.ts";
import { fail, finish } from "./update-finish.ts";
import { updateIo } from "./update-io.ts";
import type { UpdateIo } from "./update-io.types.ts";
import { latestOf } from "./update-latest.ts";
import { assess, candidatesOf, type Assessed } from "./update-plan.ts";
import { checkLines, heldLines, updatedLine } from "./update-report.ts";
import { updateSources } from "./update-sources.ts";
import { isMajor } from "./update-spec.ts";
import { updateWrite } from "./update-write.ts";
import {
  EXIT_USAGE,
  FLAG_CHECK,
  FLAG_MAJOR,
  OPTION_PREFIX,
  USAGE,
  allCurrent,
  nothingDepends,
  onLatest,
  prefixed,
} from "./update.constants.ts";
import type { Checked } from "./update.types.ts";

/** What a run asked for: the names that narrow it, and whether a bare run takes majors. */
type Run = { names: readonly string[]; major: boolean; assessed: Assessed };

/** The behind versions a run writes, and the majors a bare run holds. */
type Split = { taken: Checked[]; held: Checked[] };

/** Splits the behind versions into the ones to write and the majors a bare run holds. */
function split(run: Run): Split {
  const keep = run.major || run.names.length > 0;
  const result: Split = { held: [], taken: [] };

  for (const source of run.assessed.behind)
    (keep || !isMajor(source.version, source.latest) ? result.taken : result.held).push(source);

  return result;
}

/** Prints each named dependency already on latest, once. */
function printCurrent(io: UpdateIo, run: Run): void {
  const { names, assessed } = run;
  const seen = new Set(assessed.behind.map((source) => source.name));

  for (const source of assessed.checked) {
    if (seen.has(source.name) || !names.some((pattern) => matchesName(pattern, source.name))) continue;
    seen.add(source.name);
    io.out(onLatest(source.name, source.spec));
  }
}

/** Writes the taken versions, prints what changed, which named dependencies were current, then what it held. */
async function write(io: UpdateIo, root: string, run: Run): Promise<number> {
  const { checked, behind } = run.assessed;

  if (behind.length === 0 && run.names.length === 0) {
    io.out(allCurrent(checked.length));

    return 0;
  }

  printCurrent(io, run);
  const { taken, held } = split(run);
  const after = held.length > 0 ? heldLines(held) : [];

  if (taken.length === 0) {
    for (const line of after) io.out(line);

    return 0;
  }

  const files = updateWrite(root, taken);
  io.out(updatedLine(taken));
  const changes = updateChanges(root, taken);
  const code = await finish({ command: "update", io, root }, files);

  if (code === 0) for (const line of [...changes(), ...after]) io.out(line);

  return code;
}

/** Lists (`--check`) or writes the versions behind `latest`; names narrow both, and names or `--major` take majors. */
export async function main(argv: string[], io: UpdateIo = updateIo()): Promise<number> {
  const check = argv.includes(FLAG_CHECK);
  const major = argv.includes(FLAG_MAJOR);
  const names = argv.filter((arg) => arg !== FLAG_CHECK && arg !== FLAG_MAJOR);

  if (names.some((arg) => arg.startsWith(OPTION_PREFIX))) return fail(io, [prefixed(USAGE)], EXIT_USAGE);
  const root = findRoot(io.cwd) ?? io.cwd;
  const read = readWorkspace(root);

  if (!read.ok) return fail(io, read.errors.map(prefixed));
  const found = candidatesOf(updateSources(read.workspace), names);

  const absent = names.find(
    (pattern) => ![...found.plain, ...found.ranges].some((source) => matchesName(pattern, source.name)),
  );

  if (absent !== undefined) return fail(io, [prefixed(nothingDepends(absent))]);
  const answers = await latestOf([...new Set(found.plain.map((source) => source.name))], io);

  if (answers.failure !== null) return fail(io, [answers.failure]);
  const assessed = assess(found, answers);

  if (!check) return await write(io, root, { assessed, major, names });

  for (const line of checkLines(assessed)) io.out(line);

  return 0;
}
