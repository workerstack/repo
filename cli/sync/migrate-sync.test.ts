import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { bunPath } from "../../dev/test-paths.ts";
import { runSync } from "../sync.ts";
import { COPIED_MARKER } from "./migrate.constants.ts";
import {
  FINAL,
  HANDOVER,
  LINES,
  SELF_ROOT,
  copied,
  copiedPlan,
  dropFixture,
  exists,
  linkStock,
  read,
  readJson,
  snapshot,
  sync,
  write,
} from "./fixtures/copied-install.ts";
import { tempDir, useTempDirs } from "./fixtures/temp-dirs.ts";

useTempDirs();
afterAll(dropFixture);

const SLOW = 180_000;
/** What the first sync over the copied install prints: its old markers converted, an unhashed section hashed. */
const CONVERTED = [
  "repo sync: references/INDEX.md: added the hash to repo:stack\n",
  "repo sync: .gitignore: converted the old markers to repo:ignore\n",
];

/** The settings keys the full sync after the migration writes. */
interface MergedSettings {
  permissions: { allow: string[] };
  hooks: { PostToolUse: { matcher: string }[] };
}

/** Adds a PostToolUse hook of the consumer's own to the copied `.claude/settings.json`. */
function addOwnHook(root: string): void {
  const own = readJson<{ hooks: Record<string, unknown[]> }>(root, ".claude/settings.json");
  own.hooks.PostToolUse = [
    ...(own.hooks.PostToolUse ?? []),
    { matcher: "Write", hooks: [{ type: "command", command: "make post-write", timeout: 5 }] },
  ];
  write(root, ".claude/settings.json", JSON.stringify(own, null, 2));
}

/** A new process reads the migrated config, which the test's process cached before the migration. */
function expectUpToDateInNewProcess(root: string): void {
  for (const args of [[], ["--check"]]) {
    const again = spawnSync(bunPath(), [path.join(SELF_ROOT, "bin", "repo.ts"), "sync", ...args], {
      cwd: root,
      encoding: "utf8",
    });
    expect({ status: again.status, out: again.stdout }).toStrictEqual({ status: 0, out: "repo sync: up to date\n" });
  }
}

/** A consumer whose only copied-install trace is the marker, with this repo linked as the stock package. */
function bare(manifest: string): string {
  const root = tempDir("workerstack-migrate-");
  write(root, "workerstack.config.ts", "export default {}\n");
  write(root, "package.json", manifest);
  write(root, COPIED_MARKER, "// copied script\n");
  linkStock(root);
  return root;
}

it("--check prints the pending count, exits 1 and writes nothing", async () => {
  const root = copied();
  const before = snapshot(root);
  const count = (await copiedPlan(root)).length;
  const result = await sync(root, ["--check"], true);
  expect(result.code).toBe(1);
  expect(result.err).toStrictEqual([`repo sync: ${count} migration steps pending; run \`bun repo sync\`\n`]);
  expect(result.out).toStrictEqual([]);
  expect(snapshot(root)).toStrictEqual(before);
});

it("runs the migration first and prints its lines before the sync summary", async () => {
  const root = copied();
  const result = await sync(root, [], true);
  expect(result.code).toBe(0);
  const migration = [...LINES, FINAL, ...HANDOVER];
  expect(result.out.slice(0, migration.length)).toStrictEqual(migration.map((line) => `${line}\n`));
  expect(exists(root, ".rulesync")).toBe(false);
  expect(await sync(root, ["--check"], true)).toMatchObject({ code: 0, out: ["repo sync: up to date\n"] });
});

it(
  "a full sync after the migration carries the consumer's own content into the trees",
  async () => {
    const root = copied();
    addOwnHook(root);
    const result = await sync(root, [], true);
    expect(result.err).toStrictEqual(CONVERTED);
    expect(result.code).toBe(0);
    const settings = readJson<MergedSettings>(root, ".claude/settings.json");
    expect(settings.permissions.allow).toContain("Bash(make lint:*)");
    expect(settings.hooks.PostToolUse.map((group) => group.matcher)).toStrictEqual(
      expect.arrayContaining(["Edit", "Write"]),
    );
    expect(JSON.stringify(settings.hooks.PostToolUse)).toContain("make post-write");
    // .mcp.json is the user's: the handover moved the copied policy's one server into it, and sync writes it no more
    expect(readJson<{ mcpServers: unknown }>(root, ".mcp.json").mcpServers).toStrictEqual({
      docs: { command: "npx", args: ["-y", "docs-mcp"] },
    });
    expect(read(root, ".repo/mcp-policy.jsonc")).not.toContain('"servers"');
    expect(exists(root, ".claude/agents/reviewer.md")).toBe(true);
    expect(fs.readlinkSync(path.join(root, ".claude/skills/deploy"))).toContain("deploy");
    expectUpToDateInNewProcess(root);
  },
  SLOW,
);

it(
  "leaves no source to adopt again: the next sync succeeds with the settings key once",
  async () => {
    const root = copied();
    // fails only once the migration removed the copy, so the migration itself runs
    const failing = {
      generators: [
        (ctx: { read: (rel: string) => string | null }) => ({
          outputs: [],
          errors: ctx.read(COPIED_MARKER) === null ? ["forced failure"] : [],
        }),
      ],
    };
    const err: string[] = [];
    const code = await runSync([], { cwd: root, stdout: () => {}, stderr: (s) => err.push(s) }, failing);
    expect(code).toBe(1);
    expect(err).toStrictEqual(["repo sync: forced failure\n", "repo sync: nothing written\n"]);
    expect(exists(root, ".rulesync")).toBe(false);

    const second = await sync(root, [], true);
    expect(second.err).toStrictEqual(CONVERTED);
    expect(second.code).toBe(0);
    const settings = readJson<MergedSettings>(root, ".claude/settings.json");
    expect(settings.permissions.allow.filter((rule) => rule === "Bash(make lint:*)")).toHaveLength(1);
  },
  SLOW,
);

it("--check says 1 migration step for a single pending step", async () => {
  const result = await sync(bare('{ "name": "x" }\n'), ["--check"]);
  expect(result).toMatchObject({
    code: 1,
    err: ["repo sync: 1 migration step pending; run `bun repo sync`\n"],
    out: [],
  });
});

it("never migrates this repo, whatever files it holds", async () => {
  const root = bare('{ "name": "@workerstack/repo" }\n');
  const result = await sync(root, ["--check"]);
  expect(result.err.join("")).not.toContain("migration");
  expect(exists(root, COPIED_MARKER)).toBe(true);
});
