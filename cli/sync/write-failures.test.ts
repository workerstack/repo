import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { file, link } from "./__fixtures__/outputs-kit.ts";
import { put } from "./__fixtures__/temp-dirs.ts";
import { DEPS as deps, MANIFEST, failing, seeded, tree, useWriteSuite } from "./__fixtures__/write-kit.ts";
import { writeAll } from "./write.ts";

useWriteSuite();

it("refuses a real dir at a skill link path before any write, naming the folder to move", () => {
  const root = seeded();
  put(root, ".claude/skills/ask/SKILL.md", "mine\n");
  const before = tree(root);
  const changed = [file("a.txt", "new\n"), link(".claude/skills/ask", "../../.agents/skills/ask")];
  expect(writeAll(root, { changed, manifest: MANIFEST, prune: ["gone/deep/x.txt"] }, deps)).toStrictEqual({
    errors: [".claude/skills/ask is a folder where sync puts a link; move it to .repo/skills/ask"],
    ok: false,
    refused: true,
  });
  expect(tree(root)).toStrictEqual(before);
});

it("refuses a real dir at any other link path with one fix", () => {
  const root = seeded();
  put(root, "tree/real/file.txt", "mine\n");
  put(root, ".agents/skills/b/SKILL.md", "mine\n");
  const before = tree(root);
  const result = writeAll(
    root,
    { changed: [link("tree/real", "../s1"), link(".agents/skills/b", "../../s1")], manifest: MANIFEST, prune: [] },
    deps,
  );
  expect(result).toStrictEqual({
    errors: [
      "tree/real is a folder where sync puts a link; move or delete it",
      ".agents/skills/b is a folder where sync puts a link; move it to .repo/skills/b",
    ],
    ok: false,
    refused: true,
  });
  expect(tree(root)).toStrictEqual(before);
});

function strip(t: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(t).filter(([rel]) => !rel.startsWith("..")));
}

it("converges on a rerun after a restore", () => {
  const root = seeded();
  const changed = [file("a.txt", "new a\n"), file("n/ew/b.txt"), link("tree/lnk", "../s2"), file("c.txt")];
  expect(writeAll(root, { changed, manifest: MANIFEST, prune: ["gone/deep/x.txt"] }, failing("c.txt")).ok).toBe(false);
  expect(writeAll(root, { changed, manifest: MANIFEST, prune: ["gone/deep/x.txt"] }, deps)).toStrictEqual({ ok: true });

  const clean = seeded();
  expect(writeAll(clean, { changed, manifest: MANIFEST, prune: ["gone/deep/x.txt"] }, deps)).toStrictEqual({
    ok: true,
  });
  expect(strip(tree(root))).toStrictEqual(strip(tree(clean)));
});

it("leaves a real dir that stands where a file belongs and reports the failed write", () => {
  const root = seeded();
  put(root, "d/keep.txt", "mine\n");
  const before = tree(root);
  const result = writeAll(root, { changed: [file("a.txt", "new\n"), file("d")], manifest: MANIFEST, prune: [] }, deps);
  expect(result).toMatchObject({ ok: false, refused: false });
  expect(result).toMatchObject({
    errors: [expect.stringMatching(/^d: cannot write: .*; restored 1 output, nothing changed$/)],
  });
  expect(tree(root)).toStrictEqual(before);
});

it("reports a file it cannot read before touching it", () => {
  const root = seeded();
  const real = fs.readFileSync;
  vi.spyOn(fs, "readFileSync").mockImplementation(((target: fs.PathOrFileDescriptor, options?: unknown) => {
    if (String(target).endsWith("a.txt")) throw new Error("EACCES: permission denied, open");
    return (real /* the real reader takes any path and options */ as (t: unknown, o?: unknown) => unknown)(
      target,
      options,
    );
  }) /* a stand-in with the reader's call shape */ as typeof fs.readFileSync);
  const result = writeAll(root, { changed: [file("a.txt", "new\n")], manifest: MANIFEST, prune: [] }, deps);
  expect(result).toStrictEqual({
    errors: ["a.txt: cannot write: EACCES: permission denied, open; restored 0 outputs, nothing changed"],
    ok: false,
    refused: false,
  });
  vi.restoreAllMocks();
  expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("old a\n");
});

it("names what it could not restore and says to rerun", () => {
  const root = seeded();
  const real = fs.writeFileSync;
  vi.spyOn(fs, "writeFileSync").mockImplementation(
    (target: fs.PathOrFileDescriptor, data: unknown, options?: unknown) => {
      if (String(target) === path.join(root, "a.txt") && data instanceof Buffer) throw new Error("EIO: i/o error");
      const write = real /* the real writer takes any path, data and options */ as (
        t: unknown,
        d: unknown,
        o?: unknown,
      ) => void;
      return write(target, data, options);
    },
  );
  const result = writeAll(
    root,
    { changed: [file("a.txt", "new a\n"), file("c.txt")], manifest: MANIFEST, prune: [] },
    failing("c.txt", "boom"),
  );
  expect(result).toStrictEqual({
    errors: ["c.txt: cannot write: boom; could not restore a.txt; run `bun repo sync` again"],
    ok: false,
    refused: false,
  });
});

it("restores a replaced link with a symlink call that works on every platform", () => {
  const root = seeded();
  const symlink = vi.spyOn(fs, "symlinkSync");
  const result = writeAll(
    root,
    { changed: [link("tree/lnk", "../s2"), file("c.txt")], manifest: MANIFEST, prune: [] },
    failing("c.txt"),
  );
  expect(result).toMatchObject({ ok: false });
  expect(symlink).toHaveBeenLastCalledWith(path.normalize("../s1"), path.join(root, "tree/lnk"), "junction");
});

it("reports a link it cannot make and restores the old one", () => {
  const root = seeded();
  const before = tree(root);
  vi.spyOn(fs, "symlinkSync").mockImplementationOnce(() => {
    throw new Error("EPERM: operation not permitted, symlink");
  });
  const result = writeAll(root, { changed: [link("tree/lnk", "../s2")], manifest: MANIFEST, prune: [] }, deps);
  expect(result).toMatchObject({
    errors: ["tree/lnk: cannot write: EPERM: operation not permitted, symlink; restored 0 outputs, nothing changed"],
  });
  expect(tree(root)).toStrictEqual(before);
});

it("writes the default way, and a link as a junction with an absolute target on win32", () => {
  const root = seeded();
  expect(
    writeAll(
      root,
      { changed: [file("a.txt", "new\n"), link("tree/lnk", "../s2")], manifest: MANIFEST, prune: [] },
      { platform: "win32" },
    ),
  ).toStrictEqual({ ok: true });
  expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("new\n");
  expect(fs.readlinkSync(path.join(root, "tree/lnk"))).toBe(path.join(root, "s2"));
});
