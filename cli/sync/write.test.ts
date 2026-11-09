import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { linkText } from "../../dev/test-paths.ts";
import { MANIFEST_REL, renderManifest } from "./manifest.ts";
import type { Output } from "./outputs.ts";
import { writeAll, writeOutput } from "./write.ts";

const temps: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-write-"));
  temps.push(dir);
  return dir;
}

function put(root: string, rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

/** Every path under `root` with its kind, bytes, link text and file mode, so a restore can be compared byte for byte. */
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of fs.readdirSync(root, { recursive: true, encoding: "utf8" }).sort()) {
    const abs = path.join(root, rel);
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) out[rel] = `link ${linkText(abs)}`;
    else if (stat.isDirectory()) out[rel] = "dir";
    else out[rel] = `file ${(stat.mode & 0o777).toString(8)} ${fs.readFileSync(abs, "latin1")}`;
  }
  return out;
}

const file = (p: string, content = `${p}\n`): Output => ({ kind: "file", path: p, content, tracked: true });
const link = (p: string, target: string): Output => ({ kind: "link", path: p, target, tracked: true });
const deps = { platform: process.platform, writeOutput };
const MANIFEST = renderManifest(["a.txt"]);

/** A tree with an old file, an old link and a prunable file that is the only thing in its dirs. */
function seeded(): string {
  const root = tempRoot();
  put(root, "a.txt", "old a\n");
  fs.chmodSync(path.join(root, "a.txt"), 0o750);
  fs.mkdirSync(path.join(root, "s1"));
  fs.mkdirSync(path.join(root, "s2"));
  fs.mkdirSync(path.join(root, "tree"));
  fs.symlinkSync("../s1", path.join(root, "tree/lnk"), "dir");
  put(root, "gone/deep/x.txt", "x\n");
  put(root, MANIFEST_REL, renderManifest(["gone/deep/x.txt"]));
  return root;
}

/** Fails the output at `path` with `message` and writes every other one for real. */
const failing = (target: string, message = "EACCES: permission denied") => ({
  platform: process.platform,
  writeOutput: (root: string, output: Output, platform: NodeJS.Platform) =>
    output.path === target ? message : writeOutput(root, output, platform),
});

describe("writeAll", () => {
  it("writes the changed outputs, removes the pruned paths and writes the manifest", () => {
    const root = seeded();
    const changed = [file("a.txt", "new a\n"), file("n/ew/b.txt"), link("tree/lnk", "../s2"), link("fresh/lnk", "../s2")];
    expect(writeAll(root, changed, ["gone/deep/x.txt"], MANIFEST, deps)).toEqual({ ok: true });
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
    expect(writeAll(root, [], [], MANIFEST, deps)).toEqual({ ok: true });
    expect(rename).not.toHaveBeenCalled();
  });

  it("restores earlier files, links and created dirs byte for byte when a later output fails", () => {
    const root = seeded();
    const before = tree(root);
    const changed = [file("a.txt", "new a\n"), file("n/ew/b.txt"), link("tree/lnk", "../s2"), file("c.txt")];
    const result = writeAll(root, changed, ["gone/deep/x.txt"], MANIFEST, failing("c.txt"));
    expect(result).toEqual({
      ok: false,
      errors: ["c.txt: cannot write: EACCES: permission denied; restored 3 outputs, nothing changed"],
      refused: false,
    });
    expect(tree(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, "n"))).toBe(false);
  });

  it("says restored 1 output in the singular", () => {
    const root = seeded();
    const result = writeAll(root, [file("a.txt", "new\n"), file("c.txt")], [], MANIFEST, failing("c.txt", "boom"));
    expect(result).toMatchObject({ errors: ["c.txt: cannot write: boom; restored 1 output, nothing changed"] });
  });

  it("restores outputs, removals and the dirs a removal emptied when a removal fails", () => {
    const root = seeded();
    put(root, "gone/other.txt", "other\n");
    const before = tree(root);
    const real = fs.rmSync;
    let failed = false;
    vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (String(target).endsWith("other.txt") && !failed) {
        failed = true;
        throw new Error("EBUSY: resource busy");
      }
      return real(target, options);
    });
    const result = writeAll(root, [file("a.txt", "new\n")], ["gone/deep/x.txt", "gone/other.txt"], MANIFEST, deps);
    expect(result).toEqual({
      ok: false,
      errors: ["gone/other.txt: cannot remove: EBUSY: resource busy; restored 2 outputs, nothing changed"],
      refused: false,
    });
    vi.restoreAllMocks();
    expect(tree(root)).toEqual(before);
  });

  it("rolls every output and removal back when the manifest write fails", () => {
    const root = seeded();
    fs.rmSync(path.join(root, MANIFEST_REL));
    fs.rmdirSync(path.join(root, ".repo/tmp"));
    fs.rmdirSync(path.join(root, ".repo"));
    const before = tree(root);
    const real = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith("sync.json")) throw new Error("EACCES: permission denied, rename");
      return real(from, to);
    });
    const changed = [file("a.txt", "new a\n"), file("n/ew/b.txt"), link("tree/lnk", "../s2")];
    const result = writeAll(root, changed, ["gone/deep/x.txt"], MANIFEST, deps);
    expect(result).toEqual({
      ok: false,
      errors: [`${MANIFEST_REL}: cannot write: EACCES: permission denied, rename; restored 4 outputs, nothing changed`],
      refused: false,
    });
    vi.restoreAllMocks();
    expect(tree(root)).toEqual(before);
  });

  it("does not try to remove a dir that is already gone when it undoes a failed manifest write", () => {
    const root = tempRoot();
    put(root, ".repo", "a file where the manifest dir belongs\n");
    const result = writeAll(root, [], [], MANIFEST, deps);
    expect(result).toMatchObject({ ok: false, refused: false });
    expect(result).toMatchObject({ errors: [expect.stringMatching(/^\.repo\/tmp\/sync\.json: cannot write: .*; restored 0 outputs, nothing changed$/)] });
    expect(fs.readFileSync(path.join(root, ".repo"), "utf8")).toBe("a file where the manifest dir belongs\n");
  });

  it("refuses a real dir at a skill link path before any write, naming the folder to move", () => {
    const root = seeded();
    put(root, ".claude/skills/ask/SKILL.md", "mine\n");
    const before = tree(root);
    const changed = [file("a.txt", "new\n"), link(".claude/skills/ask", "../../.agents/skills/ask")];
    expect(writeAll(root, changed, ["gone/deep/x.txt"], MANIFEST, deps)).toEqual({
      ok: false,
      errors: [".claude/skills/ask is a folder where sync puts a link; move it to .repo/skills/ask"],
      refused: true,
    });
    expect(tree(root)).toEqual(before);
  });

  it("refuses a real dir at any other link path with one fix", () => {
    const root = seeded();
    put(root, "tree/real/file.txt", "mine\n");
    put(root, ".agents/skills/b/SKILL.md", "mine\n");
    const before = tree(root);
    const result = writeAll(root, [link("tree/real", "../s1"), link(".agents/skills/b", "../../s1")], [], MANIFEST, deps);
    expect(result).toEqual({
      ok: false,
      errors: [
        "tree/real is a folder where sync puts a link; move or delete it",
        ".agents/skills/b is a folder where sync puts a link; move it to .repo/skills/b",
      ],
      refused: true,
    });
    expect(tree(root)).toEqual(before);
  });

  it("converges on a rerun after a restore", () => {
    const root = seeded();
    const changed = [file("a.txt", "new a\n"), file("n/ew/b.txt"), link("tree/lnk", "../s2"), file("c.txt")];
    expect(writeAll(root, changed, ["gone/deep/x.txt"], MANIFEST, failing("c.txt")).ok).toBe(false);
    expect(writeAll(root, changed, ["gone/deep/x.txt"], MANIFEST, deps)).toEqual({ ok: true });

    const clean = seeded();
    expect(writeAll(clean, changed, ["gone/deep/x.txt"], MANIFEST, deps)).toEqual({ ok: true });
    const strip = (t: Record<string, string>) => Object.fromEntries(Object.entries(t).filter(([rel]) => !rel.startsWith("..")));
    expect(strip(tree(root))).toEqual(strip(tree(clean)));
  });

  it("leaves a real dir that stands where a file belongs and reports the failed write", () => {
    const root = seeded();
    put(root, "d/keep.txt", "mine\n");
    const before = tree(root);
    const result = writeAll(root, [file("a.txt", "new\n"), file("d")], [], MANIFEST, deps);
    expect(result).toMatchObject({ ok: false, refused: false });
    expect(result).toMatchObject({ errors: [expect.stringMatching(/^d: cannot write: .*; restored 1 output, nothing changed$/)] });
    expect(tree(root)).toEqual(before);
  });

  it("reports a file it cannot read before touching it", () => {
    const root = seeded();
    const real = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((target: fs.PathOrFileDescriptor, options?: unknown) => {
      if (String(target).endsWith("a.txt")) throw new Error("EACCES: permission denied, open");
      return (real as (t: unknown, o?: unknown) => unknown)(target, options);
    }) as typeof fs.readFileSync);
    const result = writeAll(root, [file("a.txt", "new\n")], [], MANIFEST, deps);
    expect(result).toEqual({
      ok: false,
      errors: ["a.txt: cannot write: EACCES: permission denied, open; restored 0 outputs, nothing changed"],
      refused: false,
    });
    vi.restoreAllMocks();
    expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("old a\n");
  });

  it("names what it could not restore and says to rerun", () => {
    const root = seeded();
    const real = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation(((target: fs.PathOrFileDescriptor, data: unknown, options?: unknown) => {
      if (String(target) === path.join(root, "a.txt") && data instanceof Buffer) throw new Error("EIO: i/o error");
      return (real as (t: unknown, d: unknown, o?: unknown) => void)(target, data, options);
    }) as typeof fs.writeFileSync);
    const result = writeAll(root, [file("a.txt", "new a\n"), file("c.txt")], [], MANIFEST, failing("c.txt", "boom"));
    expect(result).toEqual({
      ok: false,
      errors: ["c.txt: cannot write: boom; could not restore a.txt; run `bun repo sync` again"],
      refused: false,
    });
  });

  it("restores a replaced link with a symlink call that works on every platform", () => {
    const root = seeded();
    const symlink = vi.spyOn(fs, "symlinkSync");
    const result = writeAll(root, [link("tree/lnk", "../s2"), file("c.txt")], [], MANIFEST, failing("c.txt"));
    expect(result).toMatchObject({ ok: false });
    expect(symlink).toHaveBeenLastCalledWith("../s1", path.join(root, "tree/lnk"), "junction");
  });

  it("reports a link it cannot make and restores the old one", () => {
    const root = seeded();
    const before = tree(root);
    vi.spyOn(fs, "symlinkSync").mockImplementationOnce(() => {
      throw new Error("EPERM: operation not permitted, symlink");
    });
    const result = writeAll(root, [link("tree/lnk", "../s2")], [], MANIFEST, deps);
    expect(result).toMatchObject({ errors: ["tree/lnk: cannot write: EPERM: operation not permitted, symlink; restored 0 outputs, nothing changed"] });
    expect(tree(root)).toEqual(before);
  });

  it("writes the default way, and a link as a junction with an absolute target on win32", () => {
    const root = seeded();
    expect(writeAll(root, [file("a.txt", "new\n"), link("tree/lnk", "../s2")], [], MANIFEST, { platform: "win32" })).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("new\n");
    expect(fs.readlinkSync(path.join(root, "tree/lnk"))).toBe(path.join(root, "s2"));
  });
});
