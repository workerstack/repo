import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { STOCK_SKILLS_REL } from "../cli/scripts/skill-conflicts.ts";
import { runSync } from "../cli/sync.ts";
import { capture, respond, tmpDir } from "./sync-pstack-fixtures.ts";
import { BRO_LONG, BRO_NO_INVOCATION, BRO_SHORT } from "./sync-pstack-write-fixtures.ts";
import { syncPstackSkills } from "./sync-pstack-write.ts";

vi.mock(new URL("../cli/sync.ts", import.meta.url).href, () => ({ runSync: vi.fn<() => Promise<number>>() }));

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

const BRO_URL = "https://raw.githubusercontent.com/backnotprop/pstack/main/skills/bro/SKILL.md";

it("writes adapted files and skips generate on --no-generate", async () => {
  const root = tmpDir("pstack-sync-", tmpDirs);
  let generated = 0;
  const { out, io } = capture();

  const result = await syncPstackSkills({
    argv: ["--skill", "bro", "--no-generate"],
    fetchImpl: (url) =>
      Promise.resolve(
        url === BRO_URL
          ? { ok: true, status: 200, text: () => Promise.resolve(BRO_LONG) }
          : { ok: false, status: 404, text: () => Promise.resolve("") },
      ),
    generateFn: () => {
      generated += 1;
    },
    io,
    workspaceRoot: root,
  });

  expect(result.ok).toBe(true);
  expect(generated).toBe(0);
  expect(out.join("")).toContain("write bro/SKILL.md");
  expect(fs.readFileSync(path.join(root, STOCK_SKILLS_REL, "bro", "SKILL.md"), "utf8")).toContain("Slash `/bro` only.");
});

it("regenerates through runSync in the workspace, not a package script", async () => {
  const root = tmpDir("pstack-gen-", tmpDirs);
  vi.mocked(runSync).mockImplementationOnce((_args, io) => {
    io.stdout("repo sync: wrote AGENTS.md\n");

    return Promise.resolve(0);
  });
  const { out, io } = capture();

  const result = await syncPstackSkills({
    argv: ["--skill", "bro"],
    fetchImpl: respond(BRO_SHORT),
    io,
    workspaceRoot: root,
  });

  expect(result.ok).toBe(true);
  expect(runSync).toHaveBeenCalledWith([], expect.objectContaining({ cwd: root }));
  expect(out.join("")).toContain("repo sync: wrote AGENTS.md");
});

it("fails when runSync exits non-zero", async () => {
  vi.mocked(runSync).mockResolvedValueOnce(1);

  const result = await syncPstackSkills({
    argv: ["--skill", "bro"],
    fetchImpl: respond(BRO_SHORT),
    io: capture().io,
    workspaceRoot: tmpDir("pstack-gen-fail-", tmpDirs),
  });

  expect(result).toMatchObject({ error: "repo sync exited 1", ok: false });
});

it("fails with the message when generateFn throws", async () => {
  const result = await syncPstackSkills({
    argv: ["--skill", "bro"],
    fetchImpl: respond(BRO_SHORT),
    generateFn: () => {
      throw new Error("boom");
    },
    io: capture().io,
    workspaceRoot: tmpDir("pstack-gen-throw-", tmpDirs),
  });

  expect(result).toMatchObject({ error: "boom", ok: false });
});

it("--check reports drift without writing", async () => {
  const root = tmpDir("pstack-check-", tmpDirs);
  const dest = path.join(root, STOCK_SKILLS_REL, "bro");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "SKILL.md"), "stale\n");

  const result = await syncPstackSkills({
    argv: ["--skill", "bro", "--check"],
    fetchImpl: respond(BRO_NO_INVOCATION),
    generateFn: () => {
      throw new Error("generate should not run");
    },
    io: capture().io,
    workspaceRoot: root,
  });

  expect(result.ok).toBe(false);
  expect(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8")).toBe("stale\n");
});
