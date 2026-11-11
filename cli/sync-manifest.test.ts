import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import {
  exists,
  file,
  fixture,
  link,
  manifestPaths,
  only,
  read,
  removeAfter,
  snapshot,
  syncWith,
  useSyncKit,
  write,
} from "./fixtures/sync-kit.ts";
import { MANIFEST_REL } from "./sync/manifest.ts";
import { type Output } from "./sync/outputs.ts";
import { writeOutput } from "./sync/write.ts";

useSyncKit();

/** Makes the next call of `fs[method]` throw an error with `message`. */
function failOnce(method: "renameSync" | "rmSync", message: string): void {
  vi.spyOn(fs, method).mockImplementationOnce(() => {
    throw new Error(message);
  });
}

it("reports a failed write even when its temp file cannot be removed", async () => {
  const root = fixture();
  failOnce("renameSync", "EPERM: operation not permitted, rename");
  failOnce("rmSync", "EBUSY: resource busy");
  expect(await syncWith(root, only(file("a.txt")))).toStrictEqual({
    code: 1,
    stderr:
      "repo sync: a.txt: cannot write: EPERM: operation not permitted, rename; restored 0 outputs, nothing changed\n",
    stdout: "",
  });
});

it("removes a path the last run wrote and no output names now, with its empty parent dirs", async () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "store"));
  await syncWith(
    root,
    only(file("keep.txt"), file("gone.txt"), file("deep/er/file.txt"), link("links/skill", "../store")),
  );
  expect(manifestPaths(root)).toStrictEqual(["deep/er/file.txt", "gone.txt", "keep.txt", "links/skill"]);
  write(root, "deep/other.txt", "mine\n");
  write(root, "unlisted.txt", "mine\n");
  write(root, "unlisted/dir/a.txt", "mine\n");

  expect(await syncWith(root, only(file("keep.txt")))).toStrictEqual({
    code: 0,
    stderr: "",
    stdout: "repo sync: removed deep/er/file.txt, gone.txt, links/skill\n",
  });
  expect(exists(root, "gone.txt")).toBe(false);
  expect(exists(root, "links/skill")).toBe(false);
  expect(exists(root, "links")).toBe(false);
  expect(exists(root, "deep/er")).toBe(false);
  expect(read(root, "deep/other.txt")).toBe("mine\n");
  expect(read(root, "unlisted.txt")).toBe("mine\n");
  expect(read(root, "unlisted/dir/a.txt")).toBe("mine\n");
  expect(fs.existsSync(path.join(root, "store"))).toBe(true);
  expect(manifestPaths(root)).toStrictEqual(["keep.txt"]);
});

it("reports a path it cannot remove, exits 1 and keeps the old manifest", async () => {
  const root = fixture();
  await syncWith(root, only(file("a.txt"), file("b.txt")));
  failOnce("rmSync", "EBUSY: resource busy");
  expect(await syncWith(root, only(file("a.txt")))).toStrictEqual({
    code: 1,
    stderr: "repo sync: b.txt: cannot remove: EBUSY: resource busy; restored 0 outputs, nothing changed\n",
    stdout: "",
  });
  expect(manifestPaths(root)).toStrictEqual(["a.txt", "b.txt"]);
});

it("reports a manifest it cannot write", async () => {
  const root = fixture();
  write(root, ".repo", "not a directory\n");
  expect(await syncWith(root, only())).toMatchObject({ code: 1, stdout: "" });
});

it("never removes a path that is not in the manifest", async () => {
  const root = fixture();
  write(root, "stale.txt", "mine\n");
  await syncWith(root, only(file("a.txt")));
  expect(read(root, "stale.txt")).toBe("mine\n");
});

it("skips a manifest path that is already gone and a real directory standing in its place", async () => {
  const root = fixture();
  write(root, MANIFEST_REL, JSON.stringify({ paths: ["missing.txt", "adir"], version: 1 }));
  write(root, "adir/inner.txt", "mine\n");
  expect(await syncWith(root, only(file("a.txt")))).toStrictEqual({
    code: 0,
    stderr: "",
    stdout: "repo sync: wrote a.txt\n",
  });
  expect(read(root, "adir/inner.txt")).toBe("mine\n");
});

it.each(["{", "[]", "null", '{"version":2,"paths":[]}', '{"version":1,"paths":[1]}', '{"version":1}'])(
  "reads a missing, invalid or foreign manifest as empty: %s",
  async (text) => {
    const root = fixture();
    write(root, MANIFEST_REL, text);
    write(root, "old.txt", "mine\n");
    const { code } = await syncWith(root, only(file("a.txt")));
    expect(code).toBe(0);
    expect(read(root, "old.txt")).toBe("mine\n");
    expect(manifestPaths(root)).toStrictEqual(["a.txt"]);
  },
);

it("writes the manifest after every output and prune, and not at all when a write fails", async () => {
  const root = fixture();
  const order: string[] = [];
  const deps = {
    ...only(file("a.txt"), file("b.txt")),
    writeOutput: (r: string, output: Output, platform: NodeJS.Platform) => {
      order.push(`${output.path}:${exists(root, MANIFEST_REL)}`);
      return writeOutput(r, output, platform);
    },
  };
  await syncWith(root, deps);
  expect(order).toStrictEqual(["a.txt:false", "b.txt:false"]);
  expect(exists(root, MANIFEST_REL)).toBe(true);

  const fresh = fixture();
  const failing = { ...only(file("a.txt")), writeOutput: () => "disk full" };
  const { code } = await syncWith(fresh, failing);
  expect(code).toBe(1);
  expect(exists(fresh, MANIFEST_REL)).toBe(false);
});

it("restores every earlier output when a later write fails, and converges on the next run", async () => {
  const root = fixture();
  await syncWith(root, only(file("old.txt")));
  write(root, "a.txt", "mine, drifted\n");
  const before = snapshot(root);
  const next = only(file("a.txt"), file("b.txt"), file("c/d.txt"));
  let calls = 0;
  const crashing = {
    ...next,
    writeOutput: (r: string, output: Output, platform: NodeJS.Platform) =>
      ++calls === 3 ? "EACCES: permission denied" : writeOutput(r, output, platform),
  };
  expect(await syncWith(root, crashing)).toStrictEqual({
    code: 1,
    stderr: "repo sync: c/d.txt: cannot write: EACCES: permission denied; restored 2 outputs, nothing changed\n",
    stdout: "",
  });
  expect(snapshot(root)).toStrictEqual(before);
  expect(exists(root, "c")).toBe(false);
  expect(manifestPaths(root)).toStrictEqual(["old.txt"]);

  expect(await syncWith(root, next)).toStrictEqual({
    code: 0,
    stderr: "",
    stdout: "repo sync: wrote a.txt, b.txt, c/d.txt; removed old.txt\n",
  });
  expect(exists(root, "old.txt")).toBe(false);
  expect(manifestPaths(root)).toStrictEqual(["a.txt", "b.txt", "c/d.txt"]);
  expect(await syncWith(root, next)).toStrictEqual({ code: 0, stderr: "", stdout: "repo sync: up to date\n" });
});

it("matches a manifest's backslash and absolute spellings to outputs and never prunes a foreign path", async () => {
  const root = fixture();
  const winRoot = root.replaceAll("/", "\\");
  // A drive path is a plain file name inside the repo on posix and a real path outside it on win32.
  const foreign =
    process.platform === "win32" ? path.join(`${root}-foreign`, "a", "foreign.txt") : "C:\\other\\a\\foreign.txt";
  const foreignAbs = process.platform === "win32" ? foreign : path.join(root, foreign);
  removeAfter(`${root}-foreign`);
  write(root, "a/keep.txt", "keep\n");
  write(root, "a/old.txt", "old\n");
  write(path.dirname(foreignAbs), path.basename(foreignAbs), "mine\n");
  write(path.dirname(root), `${path.basename(root)}-outside.txt`, "mine\n");
  removeAfter(`${root}-outside.txt`);
  write(
    root,
    MANIFEST_REL,
    JSON.stringify({
      paths: [`${winRoot}\\a\\keep.txt`, ".\\a\\old.txt", foreign, `..\\${path.basename(root)}-outside.txt`, ""],
      version: 1,
    }),
  );

  const { code } = await syncWith(root, only(file("a/keep.txt", "keep\n")));
  expect(code).toBe(0);
  expect(read(root, "a/keep.txt")).toBe("keep\n");
  expect(exists(root, "a/old.txt")).toBe(false);
  expect(fs.readFileSync(foreignAbs, "utf8")).toBe("mine\n");
  expect(fs.readFileSync(`${root}-outside.txt`, "utf8")).toBe("mine\n");
  expect(manifestPaths(root)).toStrictEqual(["a/keep.txt"]);
});
