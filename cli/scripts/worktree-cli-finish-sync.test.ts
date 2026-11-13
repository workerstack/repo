import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { cli, commitIn, git, scratch, wt } from "./__fixtures__/worktree-repo.ts";
import { BIN_DIR } from "./worktree.constants.ts";

const tmp = scratch();

afterEach(() => tmp.cleanup());

const WRITE_MARKER = "node repo-marker.js";
const MARKER_JS = "require('fs').writeFileSync('synced.marker', process.argv.slice(2).join(' '));\n";
const FAIL = `node -e "process.exit(1)"`;

/** A repo whose package.json holds `scripts`, with worktree `a` holding one commit. */
function repoWith(scripts: Record<string, string>): string {
  const r = tmp.repo();
  commitIn(r, "repo-marker.js", MARKER_JS);
  commitIn(r, "package.json", `${JSON.stringify({ name: "fixture", private: true, scripts })}\n`);
  cli(r, ["add", "a"]);
  commitIn(wt(r, "a"), "a.txt");

  return r;
}

function noPrep(): void {
  // nothing to do before finishing
}

/** Finishes `a` in a repo with `scripts` after `prep` ran in the root; the root, the run, and the marker. */
function finishing(scripts: Record<string, string>, prep: (r: string) => void = noPrep) {
  const r = repoWith(scripts);
  prep(r);
  const out = cli(r, ["finish", "a"]);
  expect(out.status, out.stderr).toBe(0);

  return { marked: fs.existsSync(path.join(r, "synced.marker")), out, r };
}

it("runs bun repo sync in the root after landing", () => {
  const { out, r } = finishing({ repo: WRITE_MARKER });
  expect(fs.readFileSync(path.join(r, "synced.marker"), "utf8")).toBe("sync");
  expect(out.stdout).toContain("merged wt/a into main at ");
});

it("does not sync a root that has another branch out", () => {
  const { marked, out } = finishing({ repo: WRITE_MARKER }, (r) => git(r, "switch", "-q", "-c", "other"));
  expect([marked, out.stderr]).toStrictEqual([false, ""]);
});

it("does not sync a root with no repo script or bin, and does not warn", () => {
  const { marked, out } = finishing({ build: WRITE_MARKER });
  expect([marked, out.stderr]).toStrictEqual([false, ""]);
});

it("warns and exits 0 when the sync fails", () => {
  const { out, r } = finishing({ repo: FAIL });
  expect(out.stderr).toContain(`could not sync ${r}: run bun repo sync there\n`);
  expect(out.stdout).toContain("merged wt/a into main at ");
});

it("syncs through the repo bin when the root has one and no repo script", () => {
  const body = "#!/usr/bin/env node\nrequire('fs').writeFileSync('synced.marker', process.argv.slice(2).join(' '))\n";

  const { r } = finishing({}, (root) => {
    const bin = path.join(root, BIN_DIR, "repo");
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, body, { mode: 0o755 });
  });

  expect(fs.readFileSync(path.join(r, "synced.marker"), "utf8")).toBe("sync");
});
