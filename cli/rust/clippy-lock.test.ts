import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { clippyHits, type CargoResult, type CargoRun } from "./clippy.ts";
import { cargoLock } from "./fixtures/cargo-lock.ts";

const MISSING_LOCK = "Cargo.lock is missing; run `cargo generate-lockfile` and commit it";
const STALE_LOCK = "Cargo.lock is out of date with Cargo.toml; run `cargo update --workspace` and commit it";

/** A root with a Cargo.lock, and a directory in it with none. */
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-clippy-lock-"));
const BARE = path.join(ROOT, "bare");
fs.mkdirSync(BARE);
fs.writeFileSync(path.join(ROOT, "Cargo.lock"), cargoLock("app"));
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

/** A runner that records its calls and returns an empty run with exit `status`. */
function cargo(status: number, extra: Partial<CargoResult> = {}) {
  const calls: string[] = [];
  const run: CargoRun = (root) => {
    calls.push(root);
    return { status, stdout: "", stderr: "", missing: false, ...extra };
  };
  return { run, calls };
}

it("runs no cargo and names the missing lock when the root has no Cargo.lock", () => {
  const { run, calls } = cargo(0);
  expect(clippyHits(BARE, run)).toEqual({ ok: false, errors: [MISSING_LOCK] });
  expect(calls).toEqual([]);
});

it("names the stale lock when --locked made cargo exit 101", () => {
  const stderr = "error: the lock file /w/Cargo.lock needs to be updated but --locked was passed to prevent this\n";
  expect(clippyHits(ROOT, cargo(101, { stderr }).run)).toEqual({ ok: false, errors: [STALE_LOCK] });
});

it("keeps any other exit 101 as the exit problem", () => {
  const run = cargo(101, { stderr: "error: could not compile\n" }).run;
  expect(clippyHits(ROOT, run)).toEqual({
    ok: false,
    errors: ["cargo clippy exited 101 and printed no error: error: could not compile"],
  });
});
