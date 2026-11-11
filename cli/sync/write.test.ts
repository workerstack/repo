import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { linkText } from "../../dev/test-paths.ts";
import { file, link } from "./__fixtures__/outputs-kit.ts";
import { put } from "./__fixtures__/temp-dirs.ts";
import {
  DEPS as deps,
  MANIFEST,
  failManifestRename,
  failing,
  seeded,
  tempRoot,
  tree,
  useWriteSuite,
} from "./__fixtures__/write-kit.ts";
import { MANIFEST_REL } from "./manifest.ts";
import { writeAll } from "./write.ts";

useWriteSuite();

it("writes the changed outputs, removes the pruned paths and writes the manifest", () => {
  const root = seeded();
  const changed = [file("a.txt", "new a\n"), file("n/ew/b.txt"), link("tree/lnk", "../s2"), link("fresh/lnk", "../s2")];
  expect(writeAll(root, { changed, manifest: MANIFEST, prune: ["gone/deep/x.txt"] }, deps)).toStrictEqual({ ok: true });
  expect(linkText(path.join(root, "fresh/lnk"))).toBe("../s2");
  expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("new a\n");
  expect(fs.readFileSync(path.join(root, "n/ew/b.txt"), "utf8")).toBe("n/ew/b.txt\n");
  expect(linkText(path.join(root, "tree/lnk"))).toBe("../s2");
  expect(fs.existsSync(path.join(root, "gone"))).toBe(false);
  expect(fs.readFileSync(path.join(root, MANIFEST_REL), "utf8")).toBe(MANIFEST);
});

it("leaves a manifest that is already current alone", () => {
  const root = tempRoot();
  put(root, MANIFEST_REL, MANIFEST);
  const rename = vi.spyOn(fs, "renameSync");
  expect(writeAll(root, { changed: [], manifest: MANIFEST, prune: [] }, deps)).toStrictEqual({ ok: true });
  expect(rename).not.toHaveBeenCalled();
});

it("restores earlier files, links and created dirs byte for byte when a later output fails", () => {
  const root = seeded();
  const before = tree(root);
  const changed = [file("a.txt", "new a\n"), file("n/ew/b.txt"), link("tree/lnk", "../s2"), file("c.txt")];
  const result = writeAll(root, { changed, manifest: MANIFEST, prune: ["gone/deep/x.txt"] }, failing("c.txt"));
  expect(result).toStrictEqual({
    errors: ["c.txt: cannot write: EACCES: permission denied; restored 3 outputs, nothing changed"],
    ok: false,
    refused: false,
  });
  expect(tree(root)).toStrictEqual(before);
  expect(fs.existsSync(path.join(root, "n"))).toBe(false);
});

it("says restored 1 output in the singular", () => {
  const root = seeded();
  const result = writeAll(
    root,
    { changed: [file("a.txt", "new\n"), file("c.txt")], manifest: MANIFEST, prune: [] },
    failing("c.txt", "boom"),
  );
  expect(result).toMatchObject({ errors: ["c.txt: cannot write: boom; restored 1 output, nothing changed"] });
});

it("restores outputs, removals and the dirs a removal emptied when a removal fails", () => {
  const root = seeded();
  put(root, "gone/other.txt", "other\n");
  const before = tree(root);
  const real = fs.rmSync;
  let hasFailed = false;
  vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
    if (String(target).endsWith("other.txt") && !hasFailed) {
      hasFailed = true;
      throw new Error("EBUSY: resource busy");
    }
    return real(target, options);
  });
  const result = writeAll(
    root,
    { changed: [file("a.txt", "new\n")], manifest: MANIFEST, prune: ["gone/deep/x.txt", "gone/other.txt"] },
    deps,
  );
  expect(result).toStrictEqual({
    errors: ["gone/other.txt: cannot remove: EBUSY: resource busy; restored 2 outputs, nothing changed"],
    ok: false,
    refused: false,
  });
  vi.restoreAllMocks();
  expect(tree(root)).toStrictEqual(before);
});

it("rolls every output and removal back when the manifest write fails", () => {
  const root = seeded();
  fs.rmSync(path.join(root, MANIFEST_REL));
  fs.rmdirSync(path.join(root, ".repo/tmp"));
  fs.rmdirSync(path.join(root, ".repo"));
  const before = tree(root);
  failManifestRename();
  const changed = [file("a.txt", "new a\n"), file("n/ew/b.txt"), link("tree/lnk", "../s2")];
  const result = writeAll(root, { changed, manifest: MANIFEST, prune: ["gone/deep/x.txt"] }, deps);
  expect(result).toStrictEqual({
    errors: [`${MANIFEST_REL}: cannot write: EACCES: permission denied, rename; restored 4 outputs, nothing changed`],
    ok: false,
    refused: false,
  });
  vi.restoreAllMocks();
  expect(tree(root)).toStrictEqual(before);
});

it("does not try to remove a dir that is already gone when it undoes a failed manifest write", () => {
  const root = tempRoot();
  put(root, ".repo", "a file where the manifest dir belongs\n");
  const result = writeAll(root, { changed: [], manifest: MANIFEST, prune: [] }, deps);
  expect(result).toMatchObject({ ok: false, refused: false });
  expect(result).toMatchObject({
    errors: [expect.stringMatching(/^\.repo\/tmp\/sync\.json: cannot write: .*; restored 0 outputs, nothing changed$/)],
  });
  expect(fs.readFileSync(path.join(root, ".repo"), "utf8")).toBe("a file where the manifest dir belongs\n");
});
