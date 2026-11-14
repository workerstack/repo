import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { childEnv } from "../../env.ts";
import { main } from "../su.ts";
import type { Roots } from "../workspace-root.ts";

/** The fixed clock of the su tests: a window of 8h starts at 2026-11-13T19:02Z. */
export const NOW = Date.parse("2026-11-14T03:02:00Z");

const HOUR_MS = 3600_000;
const MS_PER_SECOND = 1000;

/** One work doc: where it lives, its text and how many hours before NOW it changed. */
export type ItemSpec = { agoH?: number; dir: string; name: string; text: string };

/** A frontmatter doc with the given boxes. */
export type DocSpec = { boxes: string; name: string; serial: string; status: string };

function commit(root: string, date: string, subject: string): void {
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", subject], {
    cwd: root,
    env: childEnv({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
  });
}

/** A temp git repo on `main` with an old first commit, then `commits` as `[date, subject]`; the caller removes it. */
export function setup(temps: string[], commits: [string, string][] = []) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "su-")));

  temps.push(root);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  commit(root, "2026-01-01T00:00:00Z", "init");

  for (const [date, subject] of commits) commit(root, date, subject);

  return { root, roots: { checkout: root, cwd: root, root } satisfies Roots };
}

/** Write a work doc under `.repo/<dir>/` and set its mtime; returns its absolute path. */
export function item(root: string, spec: ItemSpec): string {
  const file = path.join(root, ".repo", spec.dir, spec.name);
  const when = (NOW - (spec.agoH ?? 1) * HOUR_MS) / MS_PER_SECOND;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, spec.text);
  fs.utimesSync(file, when, when);

  return file;
}

export function doc(spec: DocSpec): string {
  return `---\nserial: ${spec.serial}\nname: ${spec.name}\nstatus: ${spec.status}\n---\n\n# ${spec.name}\n\n${spec.boxes}\n`;
}

/** Write a session's `approvals.txt`, one path a line. */
export function session(root: string, sid: string, files: string[]): void {
  const file = path.join(root, ".repo", "tmp", "sessions", sid, "approvals.txt");

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, files.map((f) => `${f}\n`).join(""));
}

/** A journal for plan `plan` whose Blockers section holds `blockers`. */
export function journal(root: string, plan: string, blockers: string): void {
  const text = `---\nplan: ${plan}\nstatus: blocked\n---\n\n## Blockers\n${blockers}\n\n## Notes\n- x\n`;

  item(root, { dir: "implementations", name: `${plan}-j.md`, text });
}

/** `repo su <argv>` against `roots` with the fixed clock. */
export function run(roots: Roots, ...argv: string[]): number {
  return main(argv, () => roots, NOW);
}

/** What a captured run wrote to stdout. */
export function outOf(captured: { out: string[] }): string {
  return captured.out.join("");
}
