import { expect, it } from "vitest";

import { BASE_CONFIG } from "./__fixtures__/base-config.ts";
import {
  OUTPUTS,
  containing,
  file,
  fixture,
  noPost,
  read,
  syncWith,
  useSyncKit,
  write,
} from "./__fixtures__/sync-kit.ts";
import { AGENT_DEFAULTS } from "./agent-defaults.constants.ts";
import { CONFIG_FILE } from "./config.constants.ts";
import { planSync } from "./sync-outputs.ts";
import { type PostPass } from "./sync/git-files.ts";
import { type Generator, type SyncContext } from "./sync/outputs.ts";

useSyncKit();

const NO_AGENTS = { ...AGENT_DEFAULTS, hosts: [], skills: [] };

type Planned = ReturnType<Generator>;

const UP_TO_DATE = { code: 0, stderr: "", stdout: "repo sync: up to date\n" };

/** A planning context over a docs-only config, reading nothing from disk unless `read` says so. */
function context(readFile: SyncContext["read"] = () => null): SyncContext {
  return {
    config: { agents: NO_AGENTS, packs: ["docs"], ...BASE_CONFIG },
    read: readFile,
    root: "/repo",
    workspace: { manifest: {}, packages: [], root: "/repo" },
  };
}

function ok(): Planned {
  return { errors: [], outputs: [file("a.txt")] };
}

function boom(): never {
  throw new Error("EACCES: cannot read x");
}

function first(): Planned {
  return { errors: [], outputs: [file("a.txt"), file("b.txt")] };
}

function second(): Planned {
  return { errors: [], outputs: [file("a.txt", "other\n")] };
}

function hosts(ctx: SyncContext): Planned {
  return { errors: [], outputs: [file("hosts.txt", ctx.config.agents.hosts.join(","))] };
}

it("runs every generator in order and concatenates outputs and errors", () => {
  const files = new Map([
    [".gitignore", "# >>> @workerstack/repo\n"],
    ["bunfig.toml", "[test]\n"],
  ]);

  const plan = planSync(context((rel) => files.get(rel) ?? null));
  // The git files pass runs after the generators, over what they produced, even when one of them failed.
  expect(plan.outputs.map((output) => output.path)).toStrictEqual([
    "references/INDEX.md",
    ".gitignore",
    ".gitattributes",
    ".vscode/settings.json",
  ]);
  expect(plan.errors).toStrictEqual(["bunfig.toml is hand-written; delete it so repo sync can own it"]);
  expect(plan.outputs[1]).toMatchObject({ repairs: ["closed repo:ignore"] });
});

it("runs the given post-passes in order, each over the outputs planned before it, and reports one that throws", () => {
  const ctx = context();
  const seen: string[][] = [];

  function adding(rel: string): PostPass {
    return (_ctx, outputs) => {
      seen.push(outputs.map((output) => output.path));

      return { errors: [], outputs: [file(rel)] };
    };
  }

  expect(planSync(ctx, [ok], [adding("b.txt"), adding("c.txt")]).outputs.map((output) => output.path)).toStrictEqual([
    "a.txt",
    "b.txt",
    "c.txt",
  ]);
  expect(seen).toStrictEqual([["a.txt"], ["a.txt", "b.txt"]]);
  expect(planSync(ctx, [ok], [boom])).toStrictEqual({ errors: ["EACCES: cannot read x"], outputs: [file("a.txt")] });
});

it("reports a generator that throws as an error and keeps running the others", () => {
  const plan = planSync(context(), [boom, ok], noPost);
  expect(plan).toStrictEqual({ errors: ["EACCES: cannot read x"], outputs: [file("a.txt")] });
});

it("refuses two outputs with one path, naming the generators that planned them", () => {
  const plan = planSync(context(), [first, second], noPost);
  expect(plan.errors).toStrictEqual(["a.txt: planned by first and second; rename one"]);
});

it("plans every output for a clean repo", () => {
  const plan = planSync(context());
  const expected = OUTPUTS.filter((rel) => !rel.startsWith("packages/"));
  expect(plan.errors).toStrictEqual([]);
  expect(plan.outputs.map((output) => output.path)).toStrictEqual(expected);
});

it("is read again, so the second run converges on the new config", async () => {
  const root = fixture('export default { packs: ["agents"], agents: { hosts: ["claude"] } }\n');
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
  expect(await syncWith(root, deps, "--check")).toStrictEqual(UP_TO_DATE);
});
