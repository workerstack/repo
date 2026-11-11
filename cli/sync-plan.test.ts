import { expect, it } from "vitest";

import { CONFIG_FILE } from "./config.constants.ts";
import { BASE_CONFIG } from "./fixtures/base-config.ts";
import { OUTPUTS, containing, file, fixture, noPost, read, syncWith, useSyncKit, write } from "./fixtures/sync-kit.ts";
import { planSync } from "./sync-outputs.ts";
import { type PostPass } from "./sync/git-files.ts";
import { type Generator, type SyncContext } from "./sync/outputs.ts";

useSyncKit();
const NO_AGENTS = { hosts: [], skills: [] };

it("runs every generator in order and concatenates outputs and errors", () => {
  const files: Record<string, string> = {
    ".gitignore": "# >>> @workerstack/repo\n",
    "bunfig.toml": "[test]\n",
  };
  const plan = planSync({
    config: { agents: NO_AGENTS, packs: ["docs"], ...BASE_CONFIG },
    read: (rel) => files[rel] ?? null,
    root: "/repo",
    workspace: { manifest: {}, packages: [], root: "/repo" },
  });
  // The git files pass runs after the generators, over what they produced, even when one of them failed.
  expect(plan.outputs.map((output) => output.path)).toEqual([
    "references/INDEX.md",
    ".gitignore",
    ".gitattributes",
    ".vscode/settings.json",
  ]);
  expect(plan.errors).toEqual(["bunfig.toml is hand-written; delete it so repo sync can own it"]);
  expect(plan.outputs[1]).toMatchObject({ repairs: ["closed repo:ignore"] });
});

it("runs the given post-passes in order, each over the outputs planned before it, and reports one that throws", () => {
  const ctx: SyncContext = {
    config: { agents: NO_AGENTS, packs: ["docs"], ...BASE_CONFIG },
    read: () => null,
    root: "/repo",
    workspace: { manifest: {}, packages: [], root: "/repo" },
  };
  const ok: Generator = () => ({ errors: [], outputs: [file("a.txt")] });
  const seen: string[][] = [];
  const adding =
    (rel: string): PostPass =>
    (_ctx, outputs) => {
      seen.push(outputs.map((output) => output.path));
      return { errors: [], outputs: [file(rel)] };
    };
  expect(planSync(ctx, [ok], [adding("b.txt"), adding("c.txt")]).outputs.map((output) => output.path)).toEqual([
    "a.txt",
    "b.txt",
    "c.txt",
  ]);
  expect(seen).toEqual([["a.txt"], ["a.txt", "b.txt"]]);
  const boom = () => {
    throw new Error("post failed");
  };
  expect(planSync(ctx, [ok], [boom])).toEqual({ errors: ["post failed"], outputs: [file("a.txt")] });
});

it("reports a generator that throws as an error and keeps running the others", () => {
  const boom: Generator = () => {
    throw new Error("EACCES: cannot read x");
  };
  const ok: Generator = () => ({ errors: [], outputs: [file("a.txt")] });
  const plan = planSync(
    {
      config: { agents: NO_AGENTS, packs: ["docs"], ...BASE_CONFIG },
      read: () => null,
      root: "/repo",
      workspace: { manifest: {}, packages: [], root: "/repo" },
    },
    [boom, ok],
    noPost,
  );
  expect(plan).toEqual({ errors: ["EACCES: cannot read x"], outputs: [file("a.txt")] });
});

it("refuses two outputs with one path, naming the generators that planned them", () => {
  const first: Generator = () => ({ errors: [], outputs: [file("a.txt"), file("b.txt")] });
  const second: Generator = () => ({ errors: [], outputs: [file("a.txt", "other\n")] });
  const plan = planSync(
    {
      config: { agents: NO_AGENTS, packs: ["docs"], ...BASE_CONFIG },
      read: () => null,
      root: "/repo",
      workspace: { manifest: {}, packages: [], root: "/repo" },
    },
    [first, second],
    noPost,
  );
  expect(plan.errors).toEqual(["a.txt: planned by first and second; rename one"]);
});

it("plans every output for a clean repo", () => {
  const plan = planSync({
    config: { agents: NO_AGENTS, packs: ["docs"], ...BASE_CONFIG },
    read: () => null,
    root: "/repo",
    workspace: { manifest: {}, packages: [], root: "/repo" },
  });
  expect(plan.errors).toEqual([]);
  expect(plan.outputs.map((output) => output.path)).toEqual(OUTPUTS.filter((rel) => !rel.startsWith("packages/")));
});

it("is read again, so the second run converges on the new config", async () => {
  const root = fixture('export default { packs: ["agents"], agents: { hosts: ["claude"] } }\n');
  const hosts: Generator = (ctx) => ({ errors: [], outputs: [file("hosts.txt", ctx.config.agents.hosts.join(","))] });
  const deps = { formats: [{ comment: null, format: "text" as const, match: () => true }], generators: [hosts] };
  const { code } = await syncWith(root, deps);
  expect(code).toBe(0);
  expect(read(root, "hosts.txt")).toBe("claude");

  write(root, CONFIG_FILE, 'export default { packs: ["agents"], agents: { hosts: ["codex"] } }\n');
  expect(await syncWith(root, deps, "--check")).toMatchObject({
    code: 1,
    stderr: containing("hosts.txt is out of date"),
  });
  const { code: again } = await syncWith(root, deps);
  expect(again).toBe(0);
  expect(read(root, "hosts.txt")).toBe("codex");
  expect(await syncWith(root, deps, "--check")).toEqual({ code: 0, stderr: "", stdout: "repo sync: up to date\n" });
});
