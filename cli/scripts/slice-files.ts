/** `repo slice-files <roadmap> <slice>`: check the current branch's changes against a parallel slice's list. */
import fs from "node:fs";
import path from "node:path";

import { byCodeUnit } from "../sync/by-code-unit.ts";
import { gitOutput } from "./git-output.ts";
import { owns } from "./parallel-groups.ts";
import { stripFrontmatter } from "./persist-doc.ts";
import { parsePointerSlices } from "./persist-roadmap-slices.ts";
import { sectionBodies } from "./persist-sections.ts";
import { REFUSED_EXIT, REQUEST_ARGS, ROADMAP_SERIAL, USAGE } from "./slice-files.constants.ts";
import { canonicalPath } from "./workspace-root.ts";
import { defaultBranch } from "./worktree-git.ts";

/** Why the call is refused, as the line printed. */
type Refusal = { error: string };

/** The slice asked for and the entries its marker lists. */
type Request = { n: string; files: string[] };

/** The parallel slice `n` of the roadmap at `arg`, or why there is none. */
function sliceOf(arg: string, n: string, cwd: string): Request | Refusal {
  const file = path.resolve(cwd, arg);

  if (!fs.existsSync(file)) return { error: `no roadmap ${arg}\n` };
  const label = ROADMAP_SERIAL.exec(path.basename(file))?.[1] ?? arg;
  const order = sectionBodies(stripFrontmatter(fs.readFileSync(file, "utf8"))).bodies.Order ?? "";
  const slice = parsePointerSlices(order).find((s) => s.n === n);

  if (slice === undefined) return { error: `roadmap ${label} has no slice ${n}\n` };

  if (slice.files === null) return { error: `slice ${n} is not parallel; name a slice of a parallel group\n` };

  return { files: slice.files, n };
}

/** The files the branch in `cwd` changed since it left `base`; a rename gives its new path. */
function branchPaths(cwd: string, base: string): { paths: string[] } | Refusal {
  const r = gitOutput(cwd, ["diff", "--name-only", "-z", `${base}...HEAD`]);

  if ("why" in r) return { error: `git diff failed in ${cwd}: ${r.why}\n` };

  return { paths: r.out.split("\0").filter(Boolean).toSorted(byCodeUnit) };
}

/** Prints the slice's changed files and every file outside its list; 1 when any is outside. */
function report({ n, files }: Request, changed: readonly string[], base: string): number {
  if (changed.length === 0) {
    process.stdout.write(`slice ${n}  no changes since ${base}\n`);

    return 0;
  }

  const outside = changed.filter((f) => !files.some((entry) => owns(entry, f)));
  const mine = changed.filter((f) => !outside.includes(f));

  process.stdout.write(`slice ${n}${mine.map((f) => `  ${f}`).join("")}\n`);

  for (const f of outside) process.stderr.write(`outside  ${f}  (slice ${n} does not list it); land this plan last\n`);

  return outside.length > 0 ? 1 : 0;
}

function fail(message: string): number {
  process.stderr.write(message);

  return REFUSED_EXIT;
}

export function main(argv: string[], cwd: string = canonicalPath(process.cwd())): number {
  if (argv.length !== REQUEST_ARGS || argv.includes("")) return fail(USAGE);
  const [roadmapArg, n] = argv /* exactly REQUEST_ARGS arguments, checked above */ as [string, string];
  const request = sliceOf(roadmapArg, n.trim(), cwd);

  if ("error" in request) return fail(request.error);
  const base = defaultBranch(cwd);
  const changed = branchPaths(cwd, base);

  if ("error" in changed) return fail(changed.error);

  return report(request, changed.paths, base);
}
