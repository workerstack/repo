import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { fixture, sync, useSyncKit } from "./__fixtures__/sync-kit.ts";

useSyncKit();

function expectOwnedMode(root: string, rel: string): void {
  const mode = fs.statSync(path.join(root, rel)).mode & 0o777;
  const [mask, want] = process.platform === "win32" ? [0o222, 0] : [0o777, 0o444];
  expect(mode & mask, rel).toBe(want);
}

it("makes a current owned file that a checkout left writable read-only again on the next sync", async () => {
  const root = fixture();
  await sync(root);
  expectOwnedMode(root, "bunfig.toml");
  fs.chmodSync(path.join(root, "bunfig.toml"), 0o644);
  expect(await sync(root)).toStrictEqual({ code: 0, stderr: "", stdout: "repo sync: up to date\n" });
  expectOwnedMode(root, "bunfig.toml");
});

it("--check passes on a writable owned file, since a mode is never drift, and leaves it writable", async () => {
  const root = fixture();
  await sync(root);
  fs.chmodSync(path.join(root, "bunfig.toml"), 0o644);
  expect(await sync(root, "--check")).toStrictEqual({ code: 0, stderr: "", stdout: "repo sync: up to date\n" });
  expect(fs.statSync(path.join(root, "bunfig.toml")).mode & 0o222).not.toBe(0);
});

it("warns on stderr for each owned file it cannot make read-only and still exits 0", async () => {
  const root = fixture();
  await sync(root);
  fs.chmodSync(path.join(root, "bunfig.toml"), 0o644);
  vi.spyOn(fs, "chmodSync").mockImplementation(() => {
    throw new Error("EPERM: operation not permitted, chmod");
  });
  expect(await sync(root)).toStrictEqual({
    code: 0,
    stderr: "repo sync: cannot make bunfig.toml read-only: EPERM: operation not permitted, chmod\n",
    stdout: "repo sync: up to date\n",
  });
});
