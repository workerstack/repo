/** `repo update [--check] [<name>|@scope/*…]` lists and bumps outdated catalog and manifest versions. */
import { findRoot } from "./config.ts";
import { readWorkspace } from "./sync/workspace.ts";
import { matchesName } from "./matches-name.ts";
import { updateChanges } from "./update-changes.ts";
import { updateIo } from "./update-io.ts";
import type { UpdateIo } from "./update-io.types.ts";
import { latestOf } from "./update-latest.ts";
import { assess, candidatesOf, type Assessed } from "./update-plan.ts";
import { checkLines, updatedLine } from "./update-report.ts";
import { fail, finish } from "./update-finish.ts";
import { updateSources } from "./update-sources.ts";
import { updateWrite } from "./update-write.ts";
import {
  EXIT_USAGE,
  FLAG_CHECK,
  OPTION_PREFIX,
  USAGE,
  allCurrent,
  nothingDepends,
  onLatest,
  prefixed,
} from "./update.constants.ts";

/** Writes the behind versions, prints what changed and which named dependencies were already current. */
function write(io: UpdateIo, root: string, run: { names: readonly string[]; assessed: Assessed }): number {
  const { names, assessed } = run;
  const { checked, behind } = assessed;
  if (behind.length === 0 && names.length === 0) {
    io.out(allCurrent(checked.length));
    return 0;
  }
  const seen = new Set(behind.map((source) => source.name));
  for (const source of checked) {
    if (seen.has(source.name) || !names.some((pattern) => matchesName(pattern, source.name))) continue;
    seen.add(source.name);
    io.out(onLatest(source.name, source.spec));
  }
  if (behind.length === 0) return 0;
  const files = updateWrite(root, behind);
  io.out(updatedLine(behind));
  const changes = updateChanges(root, behind);
  const code = finish({ io, command: "update", root }, files);
  if (code === 0) for (const line of changes()) io.out(line);
  return code;
}

/** Lists (`--check`) or writes the versions behind `latest`; names narrow both. */
export async function main(argv: string[], io: UpdateIo = updateIo()): Promise<number> {
  const check = argv.includes(FLAG_CHECK);
  const names = argv.filter((arg) => arg !== FLAG_CHECK);
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
  if (!check) return write(io, root, { names, assessed });
  for (const line of checkLines(assessed)) io.out(line);
  return 0;
}
