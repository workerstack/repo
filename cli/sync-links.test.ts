import fs from "node:fs";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { aliasOf, linkText, removeAlias } from "../dev/test-paths.ts";
import { exists, fixture, link, only, syncWith, useSyncKit, write } from "./__fixtures__/sync-kit.ts";

useSyncKit();

it("creates a link, keeps it while current and replaces it when it points elsewhere", async () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "store/a"), { recursive: true });
  fs.mkdirSync(path.join(root, "store/b"), { recursive: true });
  const symlink = vi.spyOn(fs, "symlinkSync");

  const deps = only(link("tree/skill", "../store/a"));
  expect(await syncWith(root, deps)).toStrictEqual({ code: 0, stderr: "", stdout: "repo sync: wrote tree/skill\n" });
  expect(linkText(path.join(root, "tree/skill"))).toBe("../store/a");
  expect(symlink).toHaveBeenCalledTimes(1);

  expect(await syncWith(root, deps)).toStrictEqual({ code: 0, stderr: "", stdout: "repo sync: up to date\n" });
  expect(symlink).toHaveBeenCalledTimes(1);

  const { code } = await syncWith(root, only(link("tree/skill", "../store/b")));
  expect(code).toBe(0);
  expect(linkText(path.join(root, "tree/skill"))).toBe("../store/b");
  expect(symlink).toHaveBeenCalledTimes(2);
});

it("keeps a link whose text is exactly the planned target", async () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "store"));
  fs.mkdirSync(path.join(root, "tree"));
  // A junction needs no privilege on win32 and is a plain symlink elsewhere, so the posix check runs on every OS.
  fs.symlinkSync(path.join(root, "store"), path.join(root, "tree/skill"), "junction");
  const text = fs.readlinkSync(path.join(root, "tree/skill"));
  await syncWith(root, { ...only(link("tree/skill", text)), platform: "linux" });
  const symlink = vi.spyOn(fs, "symlinkSync");
  expect(await syncWith(root, { ...only(link("tree/skill", text)), platform: "linux" })).toStrictEqual({
    code: 0,
    stderr: "",
    stdout: "repo sync: up to date\n",
  });
  expect(symlink).not.toHaveBeenCalled();
});

it("replaces a real file that stands where a link belongs", async () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "store"));
  write(root, "tree/skill", "old\n");
  const { code } = await syncWith(root, only(link("tree/skill", "../store")));
  expect(code).toBe(0);
  expect(fs.lstatSync(path.join(root, "tree/skill")).isSymbolicLink()).toBe(true);
});

it("makes a junction with an absolute target on win32", async () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "store"));
  const symlink = vi.spyOn(fs, "symlinkSync");
  await syncWith(root, { ...only(link("tree/skill", "../store")), platform: "win32" });
  expect(symlink).toHaveBeenCalledWith(path.join(root, "store"), path.join(root, "tree/skill"), "junction");
});

// A win32 junction holds an absolute target, so there a link is matched by the path it names (the next test).
it.skipIf(process.platform === "win32")(
  "rewrites a link whose text differs, even when it resolves to the same directory",
  async () => {
    const root = fixture();
    const store = path.join(root, "store");
    fs.mkdirSync(store);
    const alias = aliasOf(store);

    try {
      const { code } = await syncWith(root, only(link("tree/skill", alias)));
      expect(code).toBe(0);
      expect(await syncWith(root, only(link("tree/skill", store)))).toStrictEqual({
        code: 0,
        stderr: "",
        stdout: "repo sync: wrote tree/skill\n",
      });
      expect(fs.readlinkSync(path.join(root, "tree/skill"))).toBe(store);
    } finally {
      removeAlias(alias);
    }
  },
);

it("on win32 treats a target whose parent dirs are spelled another way as the same directory", async () => {
  const root = fixture();
  const store = path.join(root, "store");
  fs.mkdirSync(store);
  const alias = aliasOf(root);

  try {
    const { code } = await syncWith(root, {
      ...only(link("tree/skill", path.join(alias, "store"))),
      platform: "win32",
    });

    expect(code).toBe(0);
    const symlink = vi.spyOn(fs, "symlinkSync");
    expect(await syncWith(root, { ...only(link("tree/skill", store)), platform: "win32" })).toStrictEqual({
      code: 0,
      stderr: "",
      stdout: "repo sync: up to date\n",
    });
    expect(symlink).not.toHaveBeenCalled();
  } finally {
    removeAlias(alias);
  }
});

// A posix symlink on win32 needs a privilege the junction does not, so win32 runs only its own platform.
const platforms = process.platform === "win32" ? (["win32"] as const) : (["linux", "win32"] as const);

it.each(platforms)(
  "on %s rewrites a link that reaches the target only through another generated link, leaving none dangling",
  async (platform) => {
    const root = fixture();
    fs.mkdirSync(path.join(root, "store/x"), { recursive: true });
    const through = [link(".agents/skills/x", "../../store/x"), link(".claude/skills/x", "../../.agents/skills/x")];
    const { code } = await syncWith(root, { generators: [() => ({ errors: [], outputs: through })], platform });
    expect(code).toBe(0);

    const direct = await syncWith(root, { ...only(link(".claude/skills/x", "../../store/x")), platform });
    expect(direct.code).toBe(0);
    expect(direct.stdout).toBe("repo sync: wrote .claude/skills/x; removed .agents/skills/x\n");
    expect(linkText(path.join(root, ".claude/skills/x"))).toBe("../../store/x");
    expect(fs.existsSync(path.join(root, ".claude/skills/x"))).toBe(true);
    expect(exists(root, ".agents")).toBe(false);
  },
);

it("reports a failed link and exits 1", async () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, "store"));
  vi.spyOn(fs, "symlinkSync").mockImplementationOnce(() => {
    throw new Error("EPERM: operation not permitted, symlink");
  });
  // Injected, so the posix link call runs on win32 too; the mock keeps it from needing the symlink privilege.
  expect(await syncWith(root, { ...only(link("tree/skill", "../store")), platform: "linux" })).toStrictEqual({
    code: 1,
    stderr:
      "repo sync: tree/skill: cannot write: EPERM: operation not permitted, symlink; " +
      "restored 0 outputs, nothing changed\n",
    stdout: "",
  });
});
