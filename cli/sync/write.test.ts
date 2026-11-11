import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { linkText } from "../../dev/test-paths.ts";
import { MANIFEST_REL, renderManifest } from "./manifest.ts";
import type { Output } from "./outputs.ts";
import { writeAll, writeOutput } from "./write.ts";
import { ownedMode, settleModes } from "./write-modes.ts";

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

const file = (p: string, content = `${p}\n`): Output => ({
  kind: "file",
  path: p,
  content,
  tracked: true,
  managed: "whole",
});
const link = (p: string, target: string): Output => ({
  kind: "link",
  path: p,
  target,
  tracked: true,
  managed: "whole",
});
const hook = (content = "#!/bin/sh\n"): Output => ({
  kind: "file",
  path: ".githooks/pre-commit",
  content,
  tracked: true,
  managed: "whole",
  executable: true,
});
const block = (p: string): Output => ({ kind: "file", path: p, content: `${p}\n`, tracked: true, managed: "block" });
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
    const changed = [
      file("a.txt", "new a\n"),
      file("n/ew/b.txt"),
      link("tree/lnk", "../s2"),
      link("fresh/lnk", "../s2"),
    ];
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
    expect(result).toMatchObject({
      errors: [
        expect.stringMatching(/^\.repo\/tmp\/sync\.json: cannot write: .*; restored 0 outputs, nothing changed$/),
      ],
    });
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
    const result = writeAll(
      root,
      [link("tree/real", "../s1"), link(".agents/skills/b", "../../s1")],
      [],
      MANIFEST,
      deps,
    );
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
    const strip = (t: Record<string, string>) =>
      Object.fromEntries(Object.entries(t).filter(([rel]) => !rel.startsWith("..")));
    expect(strip(tree(root))).toEqual(strip(tree(clean)));
  });

  it("leaves a real dir that stands where a file belongs and reports the failed write", () => {
    const root = seeded();
    put(root, "d/keep.txt", "mine\n");
    const before = tree(root);
    const result = writeAll(root, [file("a.txt", "new\n"), file("d")], [], MANIFEST, deps);
    expect(result).toMatchObject({ ok: false, refused: false });
    expect(result).toMatchObject({
      errors: [expect.stringMatching(/^d: cannot write: .*; restored 1 output, nothing changed$/)],
    });
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
    vi.spyOn(fs, "writeFileSync").mockImplementation(((
      target: fs.PathOrFileDescriptor,
      data: unknown,
      options?: unknown,
    ) => {
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
    expect(symlink).toHaveBeenLastCalledWith(path.normalize("../s1"), path.join(root, "tree/lnk"), "junction");
  });

  it("reports a link it cannot make and restores the old one", () => {
    const root = seeded();
    const before = tree(root);
    vi.spyOn(fs, "symlinkSync").mockImplementationOnce(() => {
      throw new Error("EPERM: operation not permitted, symlink");
    });
    const result = writeAll(root, [link("tree/lnk", "../s2")], [], MANIFEST, deps);
    expect(result).toMatchObject({
      errors: ["tree/lnk: cannot write: EPERM: operation not permitted, symlink; restored 0 outputs, nothing changed"],
    });
    expect(tree(root)).toEqual(before);
  });

  it("writes the default way, and a link as a junction with an absolute target on win32", () => {
    const root = seeded();
    expect(
      writeAll(root, [file("a.txt", "new\n"), link("tree/lnk", "../s2")], [], MANIFEST, { platform: "win32" }),
    ).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("new\n");
    expect(fs.readlinkSync(path.join(root, "tree/lnk"))).toBe(path.join(root, "s2"));
  });
});

describe("writeOutput modes", () => {
  const mode = (root: string, rel: string) => fs.statSync(path.join(root, rel)).mode & 0o777;

  // Windows has no execute bits; sync marks a hook in the index there instead.
  it.skipIf(process.platform === "win32")(
    "makes an executable output 0555 on POSIX, a new file and a rewritten one alike",
    () => {
      const root = tempRoot();
      expect(writeOutput(root, hook("#!/bin/sh\n"), "linux")).toBeNull();
      expect(mode(root, ".githooks/pre-commit")).toBe(0o555);
      fs.chmodSync(path.join(root, ".githooks/pre-commit"), 0o644);
      expect(writeOutput(root, hook("#!/bin/sh\nnew\n"), "darwin")).toBeNull();
      expect(mode(root, ".githooks/pre-commit")).toBe(0o555);
    },
  );

  it("leaves a plain output, and any output written for win32, which has no modes, without the execute bits", () => {
    const root = tempRoot();
    expect(writeOutput(root, file("a.txt"), "linux")).toBeNull();
    expect(mode(root, "a.txt") & 0o111).toBe(0);
    expect(writeOutput(root, hook("#!/bin/sh\n"), "win32")).toBeNull();
    expect(mode(root, ".githooks/pre-commit") & 0o111).toBe(0);
  });
});

const modeOf = (root: string, rel: string) => fs.statSync(path.join(root, rel)).mode & 0o777;
const isWritable = (root: string, rel: string) => (modeOf(root, rel) & 0o222) !== 0;
/** Asserts the POSIX mode at `rel`; win32 keeps only a read-only flag, so there only whether it is read-only. */
function expectMode(root: string, rel: string, posix: number): void {
  if (process.platform === "win32") expect(isWritable(root, rel), rel).toBe((posix & 0o222) !== 0);
  else expect(modeOf(root, rel), rel).toBe(posix);
}

/** Makes a rename onto a read-only file and its removal fail, as they do on win32. */
function lockLikeWin32(): void {
  const locked = (target: fs.PathLike) => {
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    return stat !== undefined && stat.isFile() && (stat.mode & 0o200) === 0;
  };
  const rename = fs.renameSync;
  const rm = fs.rmSync;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (locked(to)) throw new Error("EPERM: operation not permitted, rename");
    rename(from, to);
  });
  vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
    if (locked(target)) throw new Error("EPERM: operation not permitted, unlink");
    rm(target, options);
  });
}

describe("ownedMode", () => {
  it("is 0444 for a whole file, 0555 for an executable one off win32, and the default for a block output or a link", () => {
    expect(ownedMode(file("a.txt"), "linux")).toBe(0o444);
    expect(ownedMode(hook(), "darwin")).toBe(0o555);
    expect(ownedMode(hook(), "win32")).toBe(0o444);
    expect(ownedMode(block("b.txt"), "linux")).toBeNull();
    expect(ownedMode(link("l", "../s1"), "linux")).toBeNull();
  });
});

describe("writeAll modes", () => {
  it("leaves whole outputs read-only, an executable one 0555, and a block output and the manifest writable", () => {
    const root = tempRoot();
    expect(writeAll(root, [file("a.txt"), hook(), block("b.txt")], [], MANIFEST, deps)).toEqual({ ok: true });
    expectMode(root, "a.txt", 0o444);
    expectMode(root, ".githooks/pre-commit", 0o555);
    expect(isWritable(root, "b.txt")).toBe(true);
    expect(isWritable(root, MANIFEST_REL)).toBe(true);
  });

  it("rewrites and prunes a read-only output where win32 refuses to replace or remove one", () => {
    const root = seeded();
    fs.chmodSync(path.join(root, "a.txt"), 0o444);
    fs.chmodSync(path.join(root, "gone/deep/x.txt"), 0o444);
    lockLikeWin32();
    expect(writeAll(root, [file("a.txt", "new a\n")], ["gone/deep/x.txt"], MANIFEST, deps)).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("new a\n");
    expectMode(root, "a.txt", 0o444);
    expect(fs.existsSync(path.join(root, "gone"))).toBe(false);
  });
});

describe("writeAll undo modes", () => {
  it("puts a read-only output back read-only when a later write fails", () => {
    const root = seeded();
    fs.chmodSync(path.join(root, "a.txt"), 0o444);
    const before = tree(root);
    lockLikeWin32();
    const result = writeAll(root, [file("a.txt", "new\n"), file("c.txt")], [], MANIFEST, failing("c.txt"));
    expect(result).toMatchObject({ errors: [expect.stringMatching(/restored 1 output, nothing changed$/)] });
    vi.restoreAllMocks();
    expect(tree(root)).toEqual(before);
  });
});

// A file link needs a privilege on win32; the dir links sync makes are covered below on every platform.
describe.skipIf(process.platform === "win32")("modes through a file link", () => {
  it("replaces a link at a whole output's path and leaves the read-only file it pointed to as it was", () => {
    const root = tempRoot();
    put(root, "real.txt", "mine\n");
    fs.chmodSync(path.join(root, "real.txt"), 0o444);
    fs.symlinkSync("real.txt", path.join(root, "l.txt"));
    expect(writeAll(root, [file("l.txt")], [], MANIFEST, deps)).toEqual({ ok: true });
    expect(fs.lstatSync(path.join(root, "l.txt")).isFile()).toBe(true);
    expectMode(root, "l.txt", 0o444);
    expectMode(root, "real.txt", 0o444);
  });

  it("never chmods the file a link at a whole output's path points to", () => {
    const root = tempRoot();
    put(root, "real.txt", "mine\n");
    const before = modeOf(root, "real.txt");
    fs.symlinkSync("real.txt", path.join(root, "l.txt"));
    expect(settleModes(root, [file("l.txt")], "linux")).toEqual([]);
    expect(modeOf(root, "real.txt")).toBe(before);
  });
});

describe("settleModes", () => {
  it("makes writable whole outputs read-only again and leaves block outputs, links, their targets and missing paths", () => {
    const root = seeded();
    put(root, "b.txt", "b\n");
    put(root, "s1/f.txt", "f\n");
    put(root, ".githooks/pre-commit", "#!/bin/sh\n");
    const outputs = [file("a.txt"), hook(), block("b.txt"), link("tree/lnk", "../s1"), file("missing.txt")];
    expect(settleModes(root, outputs, "linux")).toEqual([]);
    expectMode(root, "a.txt", 0o444);
    expectMode(root, ".githooks/pre-commit", 0o555);
    expect(isWritable(root, "b.txt")).toBe(true);
    expect(isWritable(root, "s1/f.txt")).toBe(true);
    expect(fs.lstatSync(path.join(root, "tree/lnk")).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(root, "missing.txt"))).toBe(false);
  });

  it("leaves an executable output read-only without execute bits for win32, and is a no-op on a rerun", () => {
    const root = tempRoot();
    put(root, ".githooks/pre-commit", "#!/bin/sh\n");
    expect(settleModes(root, [hook()], "win32")).toEqual([]);
    expect(settleModes(root, [hook()], "win32")).toEqual([]);
    expectMode(root, ".githooks/pre-commit", 0o444);
  });
});

describe("settleModes warnings", () => {
  it("returns one warning for each file it cannot make read-only", () => {
    const root = tempRoot();
    put(root, "a.txt", "a\n");
    put(root, "c.txt", "c\n");
    vi.spyOn(fs, "chmodSync").mockImplementation(() => {
      throw new Error("EPERM: operation not permitted, chmod");
    });
    expect(settleModes(root, [file("a.txt"), file("c.txt")], "linux")).toEqual([
      "cannot make a.txt read-only: EPERM: operation not permitted, chmod",
      "cannot make c.txt read-only: EPERM: operation not permitted, chmod",
    ]);
  });
});

describe("settleModes block outputs", () => {
  it("makes a block output an older sync left read-only writable, 0644, and leaves a writable one as it is", () => {
    const root = tempRoot();
    put(root, "AGENTS.md", "a\n");
    put(root, "notes.md", "n\n");
    fs.chmodSync(path.join(root, "AGENTS.md"), 0o444);
    fs.chmodSync(path.join(root, "notes.md"), 0o600);
    expect(settleModes(root, [block("AGENTS.md"), block("notes.md")], "linux")).toEqual([]);
    expectMode(root, "AGENTS.md", 0o644);
    expectMode(root, "notes.md", 0o600);
  });

  it("names a block output it cannot make writable", () => {
    const root = tempRoot();
    put(root, "AGENTS.md", "a\n");
    fs.chmodSync(path.join(root, "AGENTS.md"), 0o444);
    vi.spyOn(fs, "chmodSync").mockImplementation(() => {
      throw new Error("EPERM: operation not permitted, chmod");
    });
    expect(settleModes(root, [block("AGENTS.md")], "linux")).toEqual([
      "cannot make AGENTS.md writable: EPERM: operation not permitted, chmod",
    ]);
  });
});
