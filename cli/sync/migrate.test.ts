import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { BUN } from "../../dev/test-paths.ts";
import { HOSTS, loadConfig, type ResolvedConfig, DEFAULT_COMMIT } from "../config.ts";
import { computeOutputs, runSync } from "../sync.ts";
import { untrackedEntries } from "./git-files.ts";
import { HOST_TREES } from "./hosts.ts";
import { readWorkspace } from "./workspace.ts";
import { HOOK_COMMANDS_KEY, hashText } from "./stock-history.ts";
import {
  COPIED_MARKER,
  applyMigration,
  conflictLines,
  generatedFiles,
  planAdoption,
  planMigration,
  planRuleUpgrade,
  trackedRels,
  type MigrateDeps,
  type MigrationStep,
} from "./migrate.ts";

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE_TGZ = path.join(SELF_ROOT, "cli", "sync", "fixtures", "copied.tgz");
/** The packed copied install, extracted once; a packed fixture keeps its .claude/skills out of the repo's own tree. */
const FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-copied-fixture-"));
tar.x({ file: FIXTURE_TGZ, cwd: FIXTURE, sync: true });
// the packed config lists packs that no longer exist; the migration under test starts from a config that loads
fs.writeFileSync(
  path.join(FIXTURE, "workerstack.config.ts"),
  'import { defineConfig } from "@workerstack/repo"\n\nexport default defineConfig({\n  packs: ["agents", "docs"],\n})\n',
);
const CONFIG: ResolvedConfig = {
  packs: ["agents"],
  agents: { hosts: HOSTS, skills: [] },
  commit: DEFAULT_COMMIT,
  lint: { skip: [] },
};
const LINES = [
  "repo sync: moved .rulesync/rules/team.md to .repo/rules/team.md",
  "repo sync: moved .rulesync/subagents/reviewer.md to .repo/subagents/reviewer.md",
  "repo sync: moved .agents/skills/deploy to .repo/skills/deploy",
  'repo sync: moved your sections "Our hooks" of .rulesync/reference/hooks.md to references/hooks.md',
  "repo sync: moved .rulesync/reference/deploy.md to references/deploy.md",
  "repo sync: moved your AGENTS.md text to .repo/rules/agents.md",
  "repo sync: moved your .claude/settings.json keys permissions.allow to .repo/settings/claude.json",
  "repo sync: moved .rulesync/lessons/ (1) to .repo/lessons/",
  "repo sync: moved your .rulesync/hooks.jsonc to .repo/hooks.jsonc (it now replaces the stock hooks)",
  "repo sync: moved your .rulesync/mcp-policy.jsonc to .repo/mcp-policy.jsonc",
  'repo sync: moved packs ["listen"] from .rulesync/repo.features.jsonc to agents.skills in workerstack.config.ts',
];
const UNTRACKED = "AGENTS.md, .mcp.json, .agents/, .claude/, .codex/, .cursor/, .grok/";
const FINAL = `repo sync: untracked ${UNTRACKED} (now generated) and removed the copied .rulesync/; commit the result`;
const FINAL_NO_GIT = "repo sync: removed the copied .rulesync/";

const temps: string[] = [];

afterAll(() => fs.rmSync(FIXTURE, { recursive: true, force: true }));

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-migrate-"));
  temps.push(dir);
  return dir;
}

function write(root: string, rel: string, text: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(root: string, rel: string): boolean {
  return (
    fs.existsSync(path.join(root, rel)) || fs.lstatSync(path.join(root, rel), { throwIfNoEntry: false }) !== undefined
  );
}

function git(root: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

/** The recorded copied install in a temp dir: the fixture, this repo linked as the stock package, one commit. */
function copied(options: { git?: boolean } = {}): string {
  const root = tempDir();
  fs.cpSync(FIXTURE, root, { recursive: true, verbatimSymlinks: true });
  fs.mkdirSync(path.join(root, "node_modules", "@workerstack"), { recursive: true });
  fs.symlinkSync(SELF_ROOT, path.join(root, "node_modules", "@workerstack", "repo"), "dir");
  if (options.git !== false) {
    git(root, "init", "-q");
    fs.appendFileSync(path.join(root, ".git", "info", "exclude"), "node_modules/\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "copied install");
  }
  return root;
}

function stockOf(root: string): string {
  return path.join(root, "node_modules", "@workerstack", "repo");
}

/** Every file and link under `root` outside node_modules and .git, with its text or link target. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (rel === "" && (entry.name === "node_modules" || entry.name === ".git")) continue;
      if (entry.isSymbolicLink()) out[next] = `-> ${fs.readlinkSync(path.join(root, next))}`;
      else if (entry.isDirectory()) walk(next);
      else out[next] = fs.readFileSync(path.join(root, next), "utf8");
    }
  };
  walk("");
  return out;
}

/** What sync generates for `root` before it migrates: the stock's own generated text, as runSync hands it over. */
async function generatedOf(root: string): Promise<[Map<string, string>, string[]]> {
  const config = await loadConfig(root);
  const workspace = readWorkspace(root);
  if (!config.ok || !workspace.ok) throw new Error("the copied install does not load");
  const planned = computeOutputs(root, config.config, workspace.workspace);
  if (!planned.ok) throw new Error(planned.errors.join("\n"));
  return [generatedFiles(planned.outputs), untrackedEntries(config.config.agents.hosts, planned.outputs)];
}

let fixtureFiles: Promise<[Map<string, string>, string[]]> | undefined;
/** The generated files and ignore entries of the copied fixture, the same for every copy of it; rendered once. */
function fixturePlanned(): Promise<[Map<string, string>, string[]]> {
  fixtureFiles ??= generatedOf(copied({ git: false }));
  return fixtureFiles;
}

async function migrate(root: string, deps: MigrateDeps = {}): Promise<string[]> {
  return applyMigration(root, planMigration(root, stockOf(root), ...(await fixturePlanned()), deps), deps);
}

/** repo sync in `root`; `full` runs every generator, otherwise none, so only the migration and the checks run. */
function sync(root: string, args: string[], full = false) {
  const out: string[] = [];
  const err: string[] = [];
  const io = { cwd: root, stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) };
  return runSync(args, io, full ? {} : { generators: [], post: [] }).then((code) => ({ code, out, err }));
}

describe("planMigration on a copied install", () => {
  it("is empty without the copied-install marker", async () => {
    const root = copied({ git: false });
    fs.rmSync(path.join(root, COPIED_MARKER));
    expect(planMigration(root, stockOf(root), ...(await fixturePlanned()))).toEqual([]);
  });

  it("names the moves in the order of Usage, then one untrack and one removal", async () => {
    const root = copied();
    const steps = planMigration(root, stockOf(root), ...(await fixturePlanned()));
    const notes = steps.flatMap((step) => ("note" in step ? [`repo sync: ${step.note}`] : []));
    expect(notes).toEqual(LINES);
    expect(steps.map((step) => step.kind).slice(-2)).toEqual(["untrack", "remove"]);
    expect(steps.find((step) => step.kind === "untrack")).toEqual({
      kind: "untrack",
      paths: UNTRACKED.split(", "),
    });
  });

  it("plans the same steps for a root with a trailing separator", async () => {
    const root = copied();
    expect(planMigration(`${root}${path.sep}`, stockOf(root), ...(await fixturePlanned()))).toEqual(
      planMigration(root, stockOf(root), ...(await fixturePlanned())),
    );
  });
});

describe("applyMigration on a copied install", () => {
  it("moves each file, prints each line and leaves only generated paths behind", async () => {
    const root = copied();
    const lines = await migrate(root);
    expect(lines).toEqual([...LINES, FINAL]);

    expect(read(root, ".repo/rules/team.md")).toBe(read(FIXTURE, ".rulesync/rules/team.md"));
    expect(read(root, ".repo/subagents/reviewer.md")).toBe(read(FIXTURE, ".rulesync/subagents/reviewer.md"));
    expect(read(root, ".repo/skills/deploy/SKILL.md")).toBe(read(FIXTURE, ".agents/skills/deploy/SKILL.md"));
    expect(read(root, "references/deploy.md")).toBe("# Deploy\n\nHow we deploy: `make deploy`.\n");
    expect(read(root, "references/hooks.md")).toBe(
      "# Hooks\n\n## Our hooks\n\nWe also run `make lint` from a pre-push hook.\n",
    );
    expect(read(root, ".repo/rules/agents.md")).toBe(
      "---\ndescription: Carried over from your earlier setup\n---\nOur team notes: ship on Fridays only with a rollback plan.\n",
    );
    expect(JSON.parse(read(root, ".repo/settings/claude.json"))).toEqual({
      permissions: { allow: ["Bash(make lint:*)"] },
    });
    expect(read(root, ".repo/lessons/x.md")).toBe(read(FIXTURE, ".rulesync/lessons/x.md"));
    expect(exists(root, ".repo/lessons/INDEX.md")).toBe(false);
    expect(read(root, ".repo/hooks.jsonc")).toBe(read(FIXTURE, ".rulesync/hooks.jsonc"));
    expect(read(root, ".repo/mcp-policy.jsonc")).toBe(read(FIXTURE, ".rulesync/mcp-policy.jsonc"));
    expect(read(root, "workerstack.config.ts")).toBe(
      'import { defineConfig } from "@workerstack/repo"\n\nexport default defineConfig({\n  agents: { skills: ["listen"] },\n  packs: ["agents", "docs"],\n})\n',
    );

    // stock-only copies are gone: the whole copied tree and every stock skill copy
    expect(exists(root, ".rulesync")).toBe(false);
    expect(exists(root, ".agents/skills/ask")).toBe(false);
    expect(exists(root, ".agents/skills/deploy")).toBe(false);
    // untracked, not deleted: generated trees stay for sync to overwrite; the two files whose own text moved are gone
    expect(exists(root, ".claude/agents/scout.md")).toBe(true);
    expect(exists(root, "AGENTS.md")).toBe(false);
    expect(exists(root, ".claude/settings.json")).toBe(false);
    const tracked = git(root, "ls-files").split("\n");
    for (const dir of [".agents/", ".claude/", ".codex/", ".cursor/", ".grok/", "AGENTS.md", ".mcp.json"]) {
      expect(tracked.filter((file) => file.startsWith(dir) || file === dir)).toEqual([]);
    }
    expect(tracked).toContain(".vscode/tasks.json");
    expect(tracked).toContain("package.json");
  });

  it("leaves a config that still loads, with the pack in agents.skills", async () => {
    const root = copied();
    await migrate(root);
    const loaded = await loadConfig(root);
    expect(loaded).toEqual({
      ok: true,
      config: {
        packs: ["agents", "docs"],
        agents: { hosts: HOSTS, skills: ["listen"] },
        commit: { maxChangedLines: 1000 },
        lint: { skip: [] },
      },
    });
  });

  it("plans nothing on a second run", async () => {
    const root = copied();
    await migrate(root);
    const before = snapshot(root);
    expect(planMigration(root, stockOf(root), ...(await fixturePlanned()))).toEqual([]);
    expect(await migrate(root)).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it("skips the untrack step outside git and still removes the copy", async () => {
    const root = copied({ git: false });
    const steps = planMigration(root, stockOf(root), ...(await fixturePlanned()));
    expect(steps.map((step) => step.kind)).not.toContain("untrack");
    expect(await applyMigration(root, steps)).toEqual([...LINES, FINAL_NO_GIT]);
    expect(exists(root, ".rulesync")).toBe(false);
  });
});

describe("a destination that already exists", () => {
  it("stops with one line naming both paths and changes nothing", async () => {
    const root = copied();
    write(root, ".repo/rules/team.md", "other text\n");
    const before = snapshot(root);
    const steps = planMigration(root, stockOf(root), ...(await fixturePlanned()));
    expect(conflictLines(steps)).toEqual([
      "repo sync: cannot move .rulesync/rules/team.md: .repo/rules/team.md already exists and differs; merge them by hand, then run `bun repo sync`",
    ]);
    expect(await applyMigration(root, steps)).toEqual(conflictLines(steps));
    expect(snapshot(root)).toEqual(before);
    expect(git(root, "ls-files", "AGENTS.md")).toBe("AGENTS.md\n");
  });

  it("through runSync exits 1 with that line on stderr and writes nothing", async () => {
    const root = copied();
    write(root, ".repo/rules/team.md", "other text\n");
    const before = snapshot(root);
    const result = await sync(root, []);
    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      "repo sync: cannot move .rulesync/rules/team.md: .repo/rules/team.md already exists and differs; merge them by hand, then run `bun repo sync`\n",
    ]);
    expect(snapshot(root)).toEqual(before);
  });

  it("goes on when the destination holds the same text", async () => {
    const root = copied();
    write(root, ".repo/rules/team.md", read(root, ".rulesync/rules/team.md"));
    const lines = await migrate(root);
    expect(lines[0]).toBe(LINES[0]);
    expect(exists(root, ".rulesync")).toBe(false);
  });
});

describe("repo sync around the migration", () => {
  it("--check prints the pending count, exits 1 and writes nothing", async () => {
    const root = copied();
    const before = snapshot(root);
    const count = planMigration(root, stockOf(root), ...(await fixturePlanned())).length;
    const result = await sync(root, ["--check"], true);
    expect(result.code).toBe(1);
    expect(result.err).toEqual([`repo sync: ${count} migration steps pending; run \`bun repo sync\`\n`]);
    expect(result.out).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it("runs the migration first and prints its lines before the sync summary", async () => {
    const root = copied();
    const result = await sync(root, [], true);
    expect(result.code).toBe(0);
    expect(result.out.slice(0, LINES.length + 1)).toEqual([...LINES, FINAL].map((line) => `${line}\n`));
    expect(exists(root, ".rulesync")).toBe(false);
    expect(await sync(root, ["--check"], true)).toMatchObject({ code: 0, out: ["repo sync: up to date\n"] });
  });

  it("a full sync after the migration carries the consumer's own content into the trees", async () => {
    const root = copied();
    const own = JSON.parse(read(root, ".claude/settings.json")) as { hooks: Record<string, unknown[]> };
    own.hooks.PostToolUse = [
      ...(own.hooks.PostToolUse ?? []),
      { matcher: "Write", hooks: [{ type: "command", command: "make post-write", timeout: 5 }] },
    ];
    write(root, ".claude/settings.json", JSON.stringify(own, null, 2));
    const result = await sync(root, [], true);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    const agents = read(root, "AGENTS.md");
    expect(agents).toContain("Team rule: run `make lint` before every push.");
    expect(agents).toContain("Our team notes: ship on Fridays only with a rollback plan.");
    const settings = JSON.parse(read(root, ".claude/settings.json")) as {
      permissions: { allow: string[] };
      hooks: { PostToolUse: { matcher: string }[] };
    };
    expect(settings.permissions.allow).toContain("Bash(make lint:*)");
    expect(settings.hooks.PostToolUse.map((group) => group.matcher)).toEqual(expect.arrayContaining(["Edit", "Write"]));
    expect(JSON.stringify(settings.hooks.PostToolUse)).toContain("make post-write");
    expect(read(root, ".mcp.json")).toContain("docs-mcp");
    expect(exists(root, ".claude/agents/reviewer.md")).toBe(true);
    expect(fs.readlinkSync(path.join(root, ".claude/skills/deploy"))).toContain("deploy");
    // a new process reads the migrated config, which this one cached before the migration
    for (const args of [[], ["--check"]]) {
      const again = spawnSync(BUN, [path.join(SELF_ROOT, "bin", "repo.ts"), "sync", ...args], {
        cwd: root,
        encoding: "utf8",
      });
      expect({ status: again.status, out: again.stdout }).toEqual({ status: 0, out: "repo sync: up to date\n" });
    }
  }, 180_000);
});

describe("a failure after the migration", () => {
  it("leaves no source to adopt again: the next sync succeeds with the AGENTS.md line once", async () => {
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
    expect(err).toEqual(["repo sync: forced failure\n", "repo sync: nothing written\n"]);
    expect(exists(root, ".rulesync")).toBe(false);
    expect(exists(root, "AGENTS.md")).toBe(false);

    const second = await sync(root, [], true);
    expect(second.err).toEqual([]);
    expect(second.code).toBe(0);
    const line = "Our team notes: ship on Fridays only with a rollback plan.";
    expect(read(root, "AGENTS.md").split(line)).toHaveLength(2);
    expect(JSON.parse(read(root, ".claude/settings.json"))).toMatchObject({
      permissions: { allow: expect.arrayContaining(["Bash(make lint:*)"]) },
    });
  }, 180_000);

  it("treats an overlay that already holds a stale AGENTS.md text as adopted, not as a conflict", async () => {
    const root = copied();
    await migrate(root);
    write(
      root,
      "AGENTS.md",
      "<!-- repo:begin -->\nstock\n<!-- repo:end -->\nOur team notes: ship on Fridays only with a rollback plan.\n",
    );
    write(root, ".claude/settings.json", JSON.stringify({ permissions: { allow: ["Bash(make lint:*)"] } }));
    const result = await sync(root, [], true);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(read(root, "AGENTS.md").split("ship on Fridays")).toHaveLength(2);
  }, 180_000);
});

describe("a crash between steps", () => {
  it("is finished by the next run, whichever step it follows, with the marker removed last", async () => {
    const reference = copied();
    const planned = planMigration(reference, stockOf(reference), ...(await fixturePlanned()));
    await migrate(reference);
    const expected = snapshot(reference);
    const expectedTracked = git(reference, "ls-files");

    for (let crashAfter = 0; crashAfter < planned.length; crashAfter++) {
      const root = copied();
      const deps: MigrateDeps = {
        afterStep: (index) => {
          if (index === crashAfter) throw new Error("crash");
        },
      };
      await expect(migrate(root, deps)).rejects.toThrow("crash");
      expect(exists(root, COPIED_MARKER), `marker after step ${crashAfter} (${planned[crashAfter]!.kind})`).toBe(
        crashAfter < planned.length - 1,
      );
      if (crashAfter < planned.length - 1) {
        await migrate(root);
      }
      expect(snapshot(root), `after a crash behind step ${crashAfter}`).toEqual(expected);
      expect(git(root, "ls-files")).toBe(expectedTracked);
    }
  }, 180_000);

  it("replans only the removal when .rulesync/ was half removed", async () => {
    const reference = copied();
    await migrate(reference);

    const root = copied();
    const steps = planMigration(root, stockOf(root), ...(await fixturePlanned()));
    await applyMigration(root, steps.slice(0, -1));
    fs.rmSync(path.join(root, ".rulesync", "scripts", "browser.ts"));
    fs.rmSync(path.join(root, ".rulesync", "rules"), { recursive: true });
    const rest = planMigration(root, stockOf(root), ...(await fixturePlanned()));
    expect(rest.map((step) => step.kind)).toEqual(["remove"]);
    await applyMigration(root, rest);
    expect(snapshot(root)).toEqual(snapshot(reference));
  });
});

describe("Windows spellings", () => {
  it("reads tracked paths with backslashes or a drive prefix as root-relative posix paths", () => {
    expect(
      trackedRels(
        [
          "AGENTS.md",
          ".claude\\settings.json",
          "C:\\proj\\.agents\\skills\\ask\\SKILL.md",
          "c:/PROJ/.grok/config.toml",
          "D:\\elsewhere\\x",
          "",
        ],
        "C:\\proj",
      ),
    ).toEqual(["AGENTS.md", ".claude/settings.json", ".agents/skills/ask/SKILL.md", ".grok/config.toml"]);
  });

  it("plans the same untrack paths from git output in either spelling", async () => {
    const root = copied();
    const posix = planMigration(root, stockOf(root), ...(await fixturePlanned()));
    const spelled = planMigration(root, stockOf(root), ...(await fixturePlanned()), {
      tracked: () => [
        "AGENTS.md",
        ".mcp.json",
        `${root.replaceAll("/", "\\")}\\.agents\\skills\\ask\\SKILL.md`,
        ".claude\\settings.json",
        ".codex\\config.toml",
        ".cursor\\hooks.json",
        ".grok\\config.toml",
      ],
    });
    expect(spelled).toEqual(posix);
  });
});

const MARKER_FILE = { [COPIED_MARKER]: "// copied script\n" };
const DEFINE = "const defineConfig = (config: object) => config\n";
const SIMPLE_CONFIG = `${DEFINE}export default defineConfig({\n  packs: ["agents"],\n})\n`;
/** A stock package as it is packed: sources under `agents/`, scripts under `cli/scripts/`, no generated trees. */
const STOCK_FILES: Record<string, string> = {
  "package.json": '{ "name": "@workerstack/repo" }\n',
  "agents/rules/overview.md": "---\nroot: true\n---\n# Overview\n\n## Stock\n\nbody\n",
  "agents/rules/plain.md": "---\nroot: false\n---\nno heading and no sections\n",
  "agents/subagents/scout.md": "scout\n",
  "agents/hooks.jsonc": "{}\n",
  "agents/mcp-policy.jsonc": "{}\n",
  "agents/global-settings/claude.json": "{}\n",
  "agents/skills/ask/SKILL.md": "ask\n",
  "references/hooks.md": "---\ntags: [hooks]\n---\n# Hooks\n\n## Stock\n\nbody\n",
  "references/bare.md": "bare\n\n## Stock\n\nbody\n",
  "references/cascade.md": "# Cascade\n\n## Stock\n\nbody\n",
};
/** What sync generates from that stock, which the package does not ship. */
const GENERATED: Record<string, string> = {
  ".claude/settings.json": '{ "permissions": { "allow": ["A"] }, "env": { "X": "1" } }\n',
};

/** The ignore entries sync derives for `config` when every host generated a file in each dir it owns. */
function ignoredOf(config: ResolvedConfig): string[] {
  const paths = [
    "AGENTS.md",
    ".mcp.json",
    ...config.agents.hosts.flatMap((host) => HOST_TREES[host].owns.map((dir) => `${dir}x`)),
  ];
  const outputs = paths.map((rel) => ({
    kind: "file" as const,
    path: rel,
    content: "",
    tracked: false,
    managed: "whole" as const,
  }));
  return untrackedEntries(config.agents.hosts, outputs);
}

type Mini = { root: string; stock: string; generated: Map<string, string> };

/** A small copied install over a fake stock package, so each rule can be tried alone. */
function mini(
  files: Record<string, string>,
  options: { stock?: Record<string, string>; generated?: Record<string, string>; git?: boolean } = {},
): Mini {
  const dir = tempDir();
  const stock = path.join(dir, "stock");
  const root = path.join(dir, "root");
  for (const [rel, text] of Object.entries({ ...STOCK_FILES, ...options.stock })) write(stock, rel, text);
  for (const [rel, text] of Object.entries({ ...MARKER_FILE, "workerstack.config.ts": SIMPLE_CONFIG, ...files })) {
    write(root, rel, text);
  }
  if (options.git === true) {
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "copied install");
  }
  return { root, stock, generated: new Map(Object.entries({ ...GENERATED, ...options.generated })) };
}

function planOf(m: Mini, config: ResolvedConfig = CONFIG, deps: MigrateDeps = {}): MigrationStep[] {
  return planMigration(m.root, m.stock, m.generated, ignoredOf(config), deps);
}

/** The lines of each step that prints one, in order. */
function notes(steps: readonly MigrationStep[]): string[] {
  return steps.flatMap((step) => ("note" in step ? [step.note] : []));
}

function contents(steps: readonly MigrationStep[]): string[] {
  return steps.flatMap((step) => (step.kind === "write" ? [step.content] : []));
}

const yours = (rel: string) =>
  `repo sync: ${rel} is yours and nothing reads it; move it out of .rulesync (to references/ if it explains something) or delete it, then run \`bun repo sync\``;
const REMOVAL: MigrationStep = { kind: "remove", paths: [".rulesync"] };
const clash = (from: string, to: string) =>
  `repo sync: cannot move ${from}: ${to} already exists and differs; merge them by hand, then run \`bun repo sync\``;

describe("a stock package as it is packed", () => {
  const CONSUMER_STOCK = path.join(SELF_ROOT, "cli", "sync", "fixtures", "consumer-stock");
  const RULE = "agents/rules/overview.md";
  const SETTINGS = '{ "permissions": { "deny": ["Agent(Explore)"] } }\n';
  const MCP = '{ "mcpServers": { "stock": { "command": "s" } } }\n';
  const generated = new Map([
    [".claude/settings.json", SETTINGS],
    [".mcp.json", MCP],
  ]);
  const none: MigrateDeps = { history: {}, tracked: () => null };
  const RULE_FRONTMATTER = "---\ndescription: Carried over from your earlier setup\n---\n";

  /** A copied install over the frozen stock snapshot: `agents/` and `cli/scripts/`, no `.rulesync/`, no generated trees. */
  function packed(files: Record<string, string>): Mini {
    const dir = tempDir();
    const stock = path.join(dir, "stock");
    const root = path.join(dir, "root");
    fs.cpSync(CONSUMER_STOCK, stock, { recursive: true });
    write(stock, "package.json", '{ "name": "@workerstack/repo" }\n');
    write(stock, "agents/skills/ask/SKILL.md", "ask\n");
    for (const [rel, text] of Object.entries({ ...MARKER_FILE, "workerstack.config.ts": SIMPLE_CONFIG, ...files }))
      write(root, rel, text);
    return { root, stock, generated };
  }

  it("splits the extra sections of an edited stock rule into a -local file", () => {
    const own = `${read(CONSUMER_STOCK, RULE)}\n## Ours\n\nship on Fridays\n`;
    expect(planOf(packed({ ".rulesync/rules/overview.md": own }), CONFIG, none)).toEqual([
      {
        kind: "write",
        path: ".repo/rules/overview-local.md",
        content: `${RULE_FRONTMATTER}## Ours\n\nship on Fridays\n`,
        note: 'moved your sections "Ours" of .rulesync/rules/overview.md to .repo/rules/overview-local.md',
      },
      REMOVAL,
    ]);
  });

  it("moves an own key of .claude/settings.json to .repo/settings/claude.json", () => {
    const own = JSON.stringify({ permissions: { deny: ["Agent(Explore)"] }, model: "opus" });
    expect(planOf(packed({ ".claude/settings.json": own }), CONFIG, none)).toEqual([
      {
        kind: "write",
        path: ".repo/settings/claude.json",
        content: `${JSON.stringify({ model: "opus" }, null, 2)}\n`,
        note: "moved your .claude/settings.json keys model to .repo/settings/claude.json",
      },
      { kind: "remove", paths: [".claude/settings.json", ".rulesync"] },
    ]);
  });

  it("removes an unedited copy of a stock skill instead of moving it", () => {
    expect(planOf(packed({ ".agents/skills/ask/SKILL.md": "ask\n" }), CONFIG, none)).toEqual([
      { kind: "remove", paths: [".agents/skills/ask", ".rulesync"] },
    ]);
  });

  it("leaves an unedited real copy of a stock skill under .claude/skills alone, and moves one with an extra file", () => {
    const unedited = packed({ ".claude/skills/ask/SKILL.md": "ask\n" });
    expect(planAdoption(unedited.root, unedited.stock, CONFIG, [], [], none)).toEqual([]);
    const edited = packed({ ".claude/skills/ask/SKILL.md": "ask\n", ".claude/skills/ask/notes.md": "mine\n" });
    expect(planAdoption(edited.root, edited.stock, CONFIG, [], [], none)).toEqual([
      {
        kind: "move",
        from: ".claude/skills/ask",
        to: ".repo/skills/ask",
        note: "moved .claude/skills/ask to .repo/skills/ask",
        mark: {
          path: ".claude/skills/ask/SKILL.md",
          content: "---\noverrides: ask\n---\nask\n",
          note: "marked .repo/skills/ask/SKILL.md with overrides: ask (it replaces the stock skill)",
        },
      },
    ]);
  });

  it("keeps an own MCP server of .mcp.json in .repo/mcp.json, and not the stock one", () => {
    const m = packed({
      ".mcp.json": JSON.stringify({ mcpServers: { stock: { command: "s" }, docs: { command: "d" } } }),
    });
    const outputs = [...generated].map(([rel, content]) => ({
      kind: "file" as const,
      path: rel,
      content,
      tracked: false,
      managed: "whole" as const,
    }));
    expect(planAdoption(m.root, m.stock, CONFIG, outputs, [], none)).toEqual([
      {
        kind: "write",
        path: ".repo/mcp.json",
        content: `${JSON.stringify({ mcpServers: { docs: { command: "d" } } }, null, 2)}\n`,
        note: "moved your .mcp.json keys mcpServers.docs to .repo/mcp.json",
      },
    ]);
  });
});

describe("planMigration without a usable stock", () => {
  it("plans nothing while the stock package is not installed", () => {
    const m = mini({});
    fs.rmSync(path.join(m.stock, "package.json"));
    expect(planOf(m)).toEqual([]);
  });

  it("plans only the removal for an install that holds nothing of its own", () => {
    expect(planOf(mini({}))).toEqual([REMOVAL]);
  });
});

describe("rules", () => {
  it("moves a rule the stock lacks, and keeps stock rules live by writing extra sections to a -local sibling", () => {
    const m = mini({
      ".rulesync/rules/team.md": "own\n",
      ".rulesync/rules/overview.md":
        "---\nroot: true\n---\n# Mine\n\n## Stock\n\nedited body\n\n## Ours\n\nlocal text\n\n## Also\n\nmore\n",
      ".rulesync/rules/plain.md": "---\nroot: false\n---\n## Extra\n\nhere\n",
    });
    expect(planOf(m).slice(0, 3)).toEqual([
      {
        kind: "write",
        path: ".repo/rules/overview-local.md",
        content:
          "---\ndescription: Carried over from your earlier setup\n---\n# Overview\n\n## Ours\n\nlocal text\n\n## Also\n\nmore\n",
        note: 'moved your sections "Ours", "Also" of .rulesync/rules/overview.md to .repo/rules/overview-local.md',
      },
      {
        kind: "write",
        path: ".repo/rules/plain-local.md",
        content: "---\ndescription: Carried over from your earlier setup\n---\n## Extra\n\nhere\n",
        note: 'moved your sections "Extra" of .rulesync/rules/plain.md to .repo/rules/plain-local.md',
      },
      {
        kind: "move",
        from: ".rulesync/rules/team.md",
        to: ".repo/rules/team.md",
        note: "moved .rulesync/rules/team.md to .repo/rules/team.md",
      },
    ]);
  });

  it("leaves a stock rule with no extra sections to the removal, and a -local sibling already written alone", () => {
    const m = mini({
      ".rulesync/rules/overview.md": "---\nroot: true\n---\n# Overview\n\n## Stock\n\nbody\n",
      ".rulesync/rules/plain.md": "---\nroot: false\n---\n## Extra\n\nhere\n",
      ".repo/rules/plain-local.md": "---\ndescription: Carried over from your earlier setup\n---\n## Extra\n\nhere\n",
    });
    expect(planOf(m)).toEqual([REMOVAL]);
  });

  it("stops on a -local sibling that holds other text", () => {
    const m = mini({
      ".rulesync/rules/plain.md": "---\nroot: false\n---\n## Extra\n\nhere\n",
      ".repo/rules/plain-local.md": "other\n",
    });
    expect(conflictLines(planOf(m))).toEqual([clash(".rulesync/rules/plain.md", ".repo/rules/plain-local.md")]);
  });
});

describe("subagents and skills", () => {
  it("moves an edited stock subagent whole as an override, and leaves an identical one to the removal", () => {
    const m = mini({
      ".rulesync/subagents/scout.md": "edited scout\n",
      ".rulesync/subagents/orchestrator.md": "own\n",
    });
    expect(notes(planOf(m))).toEqual([
      "moved .rulesync/subagents/orchestrator.md to .repo/subagents/orchestrator.md",
      "moved your edited .rulesync/subagents/scout.md to .repo/subagents/scout.md (it now replaces the stock subagent)",
    ]);
    expect(planOf(mini({ ".rulesync/subagents/scout.md": "scout\r\n" }))).toEqual([REMOVAL]);
  });

  it("moves an edited stock skill whole, a skill the stock lacks, and removes the identical copies", () => {
    const m = mini(
      {
        ".agents/skills/ask/SKILL.md": "edited\n",
        ".agents/skills/deploy/SKILL.md": "deploy\n",
        ".agents/skills/bro/SKILL.md": "bro\n",
        ".agents/skills/README.md": "not a skill\n",
      },
      { stock: { "agents/skills/bro/SKILL.md": "bro\n" } },
    );
    expect(planOf(m)).toEqual([
      {
        kind: "move",
        from: ".agents/skills/ask",
        to: ".repo/skills/ask",
        note: "moved your edited .agents/skills/ask to .repo/skills/ask (it now replaces the stock skill)",
        mark: {
          path: ".agents/skills/ask/SKILL.md",
          content: "---\noverrides: ask\n---\nedited\n",
          note: "marked .repo/skills/ask/SKILL.md with overrides: ask (it replaces the stock skill)",
        },
      },
      {
        kind: "move",
        from: ".agents/skills/deploy",
        to: ".repo/skills/deploy",
        note: "moved .agents/skills/deploy to .repo/skills/deploy",
      },
      { kind: "remove", paths: [".agents/skills/bro", ".rulesync"] },
    ]);
  });

  it("treats a skill whose file list differs as edited", () => {
    const m = mini({ ".agents/skills/ask/SKILL.md": "ask\n", ".agents/skills/ask/extra.md": "extra\n" });
    expect(planOf(m)[0]).toMatchObject({ kind: "move", from: ".agents/skills/ask" });
  });
});

describe("references", () => {
  it("drops old generated files and stock copies, writes extra sections, moves everything else", () => {
    const m = mini({
      ".rulesync/reference/law.md": "# Law\n",
      ".rulesync/reference/INDEX.md": "generated\n",
      ".rulesync/reference/cascade.md": "# Cascade\n\n## Stock\n\nbody\n",
      ".rulesync/reference/hooks.md": "# Hooks\n\n## Stock\n\nbody\n\n## A\n\n1\n\n## B\n\n2\n",
      ".rulesync/reference/bare.md": "bare\n\n## Stock\n\nbody\n\n## C\n\nthree\n",
      ".rulesync/reference/deploy.md": "# Deploy\n",
      ".rulesync/reference/notes.txt": "not markdown\n",
      ".rulesync/reference/nested/more.md": "# More\n",
    });
    const steps = planOf(m);
    expect(notes(steps)).toEqual([
      'moved your sections "C" of .rulesync/reference/bare.md to references/bare.md',
      'moved your sections "A", "B" of .rulesync/reference/hooks.md to references/hooks.md',
      "moved .rulesync/reference/deploy.md to references/deploy.md",
      "moved .rulesync/reference/nested to references/nested",
      "moved .rulesync/reference/notes.txt to references/notes.txt",
    ]);
    expect(contents(steps)).toEqual(["# bare.md\n\n## C\n\nthree\n", "# Hooks\n\n## A\n\n1\n\n## B\n\n2\n"]);
  });

  it("takes the heading from the consumer's copy when the stock has none, then from the file name", () => {
    const m = mini(
      {
        ".rulesync/reference/a.md": "# Mine\n\n## S\n\nx\n\n## Own\n\ny\n",
        ".rulesync/reference/b.md": "text\n\n## S\n\nx\n\n## Own\n\ny\n",
      },
      { stock: { "references/a.md": "stock\n\n## S\n\nx\n", "references/b.md": "stock\n\n## S\n\nx\n" } },
    );
    expect(contents(planOf(m))).toEqual(["# Mine\n\n## Own\n\ny\n", "# b.md\n\n## Own\n\ny\n"]);
  });

  it("appends extra sections after text already at the destination, and does nothing when they are there", () => {
    const own = ".rulesync/reference/hooks.md";
    const text = "# Hooks\n\n## Stock\n\nbody\n\n## Ours\n\nmine\n";
    const appended = mini({ [own]: text, "references/hooks.md": "# Hooks\n\nconsumer text\n\n" });
    expect(contents(planOf(appended))).toEqual(["# Hooks\n\nconsumer text\n\n## Ours\n\nmine\n"]);
    const there = mini({ [own]: text, "references/hooks.md": "# Hooks\n\n## Ours\n\nmine\n" });
    expect(planOf(there)).toEqual([REMOVAL]);
    const same = mini({ [own]: STOCK_FILES["references/hooks.md"]! });
    expect(planOf(same)).toEqual([REMOVAL]);
  });

  it("stops on a moved file whose destination holds other text, and on a dir against a file", () => {
    const m = mini({
      ".rulesync/reference/deploy.md": "# Deploy\n",
      "references/deploy.md": "# Other\n",
      ".rulesync/reference/guide/one.md": "1\n",
      "references/guide": "a file\n",
    });
    expect(conflictLines(planOf(m))).toEqual([
      clash(".rulesync/reference/deploy.md", "references/deploy.md"),
      clash(".rulesync/reference/guide", "references/guide"),
    ]);
  });
});

describe("AGENTS.md text and .claude/settings.json keys", () => {
  const block = "<!-- repo:begin -->\n\nstock\n\n<!-- repo:end -->\n";

  it("plans nothing for a missing AGENTS.md, one with only the guarded block, or text already moved", () => {
    expect(planOf(mini({}))).toEqual([REMOVAL]);
    expect(planOf(mini({ "AGENTS.md": block }))).toEqual([REMOVAL]);
    const moved = mini({
      "AGENTS.md": `${block}\nours\n`,
      ".repo/rules/agents.md": "---\ndescription: Carried over from your earlier setup\n---\nours\n",
    });
    expect(planOf(moved)).toEqual([{ kind: "remove", paths: ["AGENTS.md", ".rulesync"] }]);
  });

  it("takes a settings overlay as done only when it holds every key and list item, and stops otherwise", () => {
    const settings = JSON.stringify({ model: "opus", permissions: { allow: ["Zed"] } });
    const plan = (overlay: string) =>
      conflictLines(planOf(mini({ ".claude/settings.json": settings, ".repo/settings/claude.json": overlay })));
    expect(plan(JSON.stringify({ model: "opus", other: 1, permissions: { allow: ["Zed", "Y"] } }))).toEqual([]);
    for (const overlay of [
      JSON.stringify({ model: "sonnet", permissions: { allow: ["Zed"] } }),
      JSON.stringify({ model: "opus", permissions: { allow: ["Y"] } }),
      JSON.stringify({ model: "opus", permissions: [] }),
      JSON.stringify({ model: "opus" }),
      "{",
    ]) {
      expect(plan(overlay), overlay).toEqual([clash(".claude/settings.json", ".repo/settings/claude.json")]);
    }
  });

  it("takes an overlay that already holds the text as done, not as a conflict", () => {
    const moved = mini({
      "AGENTS.md": `${block}\nours\n`,
      ".repo/rules/agents.md": "---\ndescription: Carried over from your earlier setup\n---\nbefore\n\nours\n\nafter\n",
      ".claude/settings.json": JSON.stringify({ permissions: { allow: ["A"] } }),
      ".repo/settings/claude.json": JSON.stringify({ permissions: { allow: ["A", "B"], deny: ["D"] }, model: "x" }),
    });
    expect(conflictLines(planOf(moved))).toEqual([]);
    expect(planOf(moved).map((step) => step.kind)).toEqual(["remove"]);
  });

  it("stops when .repo/rules/agents.md holds other text", () => {
    const m = mini({ "AGENTS.md": `${block}\nours\n`, ".repo/rules/agents.md": "other\n" });
    expect(conflictLines(planOf(m))).toEqual([clash("AGENTS.md", ".repo/rules/agents.md")]);
  });

  it("moves list items, new keys and changed values, and the hooks apart", () => {
    const m = mini({
      ".claude/settings.json": JSON.stringify({
        permissions: { allow: ["A", "B"], deny: ["D"] },
        env: { X: "2", Y: "1" },
        model: "opus",
      }),
    });
    const [step] = planOf(m);
    expect(step).toMatchObject({
      kind: "write",
      path: ".repo/settings/claude.json",
      note: "moved your .claude/settings.json keys permissions.allow, permissions.deny, env.X, env.Y, model to .repo/settings/claude.json",
    });
    expect(JSON.parse(contents([step!])[0]!)).toEqual({
      permissions: { allow: ["B"], deny: ["D"] },
      env: { X: "2", Y: "1" },
      model: "opus",
    });
  });

  it("plans nothing for settings the stock already has, a missing file, an unreadable stock file or none generated", () => {
    expect(planOf(mini({ ".claude/settings.json": GENERATED[".claude/settings.json"]! }))).toEqual([REMOVAL]);
    expect(planOf(mini({}))).toEqual([REMOVAL]);
    const unreadable = mini(
      { ".claude/settings.json": '{ "env": { "Z": "1" } }' },
      { generated: { ".claude/settings.json": "{" } },
    );
    expect(planOf(unreadable)).toEqual([REMOVAL]);
    // a host left out of the config: sync generates no settings to compare with, so the file is left alone
    const ungenerated = mini({ ".claude/settings.json": '{ "env": { "Z": "1" } }' });
    ungenerated.generated.delete(".claude/settings.json");
    expect(planOf(ungenerated)).toEqual([REMOVAL]);
    expect(planOf(mini({ ".claude/settings.json": "[]" }))).toEqual([REMOVAL]);
  });

  it("asks for the keys by hand when settings.json is not JSON", async () => {
    const m = mini({ ".claude/settings.json": "{" });
    const steps = planOf(m);
    expect(steps[0]).toEqual({
      kind: "note",
      note: ".claude/settings.json is not valid JSON; copy any keys of yours into .repo/settings/claude.json",
    });
    expect((await applyMigration(m.root, steps))[0]).toBe(
      "repo sync: .claude/settings.json is not valid JSON; copy any keys of yours into .repo/settings/claude.json",
    );
  });

  it("stops when the settings overlay holds other keys", () => {
    const m = mini({ ".claude/settings.json": '{ "model": "opus" }', ".repo/settings/claude.json": "{}\n" });
    expect(conflictLines(planOf(m))).toEqual([clash(".claude/settings.json", ".repo/settings/claude.json")]);
  });
});

describe("lessons and overrides", () => {
  it("moves lessons into an existing .repo/lessons, leaves INDEX.md, and drops an identical file", async () => {
    const m = mini({
      ".rulesync/lessons/a.md": "a\n",
      ".rulesync/lessons/b.md": "b\n",
      ".rulesync/lessons/INDEX.md": "old index\n",
      ".rulesync/lessons/sub/c.md": "c\n",
      ".repo/lessons/sub/d.md": "d\n",
      ".repo/lessons/b.md": "b\n",
      ".repo/lessons/INDEX.md": "new index\n",
    });
    const steps = planOf(m);
    expect(notes(steps)).toEqual(["moved .rulesync/lessons/ (3) to .repo/lessons/"]);
    await applyMigration(m.root, steps);
    expect(read(m.root, ".repo/lessons/a.md")).toBe("a\n");
    expect(read(m.root, ".repo/lessons/sub/c.md")).toBe("c\n");
    expect(read(m.root, ".repo/lessons/sub/d.md")).toBe("d\n");
    expect(read(m.root, ".repo/lessons/INDEX.md")).toBe("new index\n");
    expect(exists(m.root, ".rulesync")).toBe(false);
  });

  it("plans nothing for a lessons dir that holds only its index, and stops on a differing lesson", () => {
    expect(planOf(mini({ ".rulesync/lessons/INDEX.md": "x\n" }))).toEqual([REMOVAL]);
    const m = mini({ ".rulesync/lessons/a.md": "a\n", ".repo/lessons/a.md": "other\n" });
    expect(conflictLines(planOf(m))).toEqual([clash(".rulesync/lessons", ".repo/lessons")]);
  });

  it("moves permissions.json and each global-settings file that differs from stock, and no identical file", () => {
    const m = mini(
      {
        ".rulesync/permissions.json": '{ "deny": [] }\n',
        ".rulesync/global-settings/claude.json": "{}\n",
        ".rulesync/global-settings/codex.toml": "x = 1\n",
        ".rulesync/global-settings/grok.toml": "y = 1\n",
        ".rulesync/hooks.jsonc": "{}\r\n",
        ".rulesync/mcp-policy.jsonc": "{}\n",
      },
      { stock: { "agents/global-settings/grok.toml": "y = 2\n" } },
    );
    expect(notes(planOf(m))).toEqual([
      "moved your .rulesync/permissions.json to .repo/permissions.json",
      "moved your .rulesync/global-settings/codex.toml to .repo/global-settings/codex.toml",
      "moved your .rulesync/global-settings/grok.toml to .repo/global-settings/grok.toml (it now replaces the stock one)",
    ]);
  });

  it("stops on any other entry of the copied dir and changes nothing", async () => {
    const m = mini({ ".rulesync/custom.md": "mine\n", ".rulesync/repo.features.jsonc": "{}\n" });
    expect(conflictLines(planOf(m))).toEqual([yours(".rulesync/custom.md")]);
    expect(await applyMigration(m.root, planOf(m))).toEqual([yours(".rulesync/custom.md")]);
    expect(fs.existsSync(path.join(m.root, ".repo/custom.md"))).toBe(false);
    expect(read(m.root, ".rulesync/custom.md")).toBe("mine\n");
  });
});

describe("packs", () => {
  const packs = (text: string) => ({ ".rulesync/repo.features.jsonc": text });
  const MOVED =
    'moved packs ["speak", "clasp"] from .rulesync/repo.features.jsonc to agents.skills in workerstack.config.ts';
  const ASK =
    'could not add the packs ["listen"] of .rulesync/repo.features.jsonc to workerstack.config.ts; add agents: { skills: ["listen"] } there';

  it("inserts agents.skills for each known pack once, in the config's line endings", async () => {
    const m = mini(packs('// packs\n{ "packs": ["speak", "bogus", "speak", "clasp"] }'));
    write(m.root, "workerstack.config.ts", SIMPLE_CONFIG.replaceAll("\n", "\r\n"));
    const steps = planOf(m);
    expect(notes(steps)).toEqual([MOVED]);
    expect(await applyMigration(m.root, steps)).toContain(`repo sync: ${MOVED}`);
    expect(read(m.root, "workerstack.config.ts")).toBe(
      `${DEFINE}export default defineConfig({\n  agents: { skills: ["speak", "clasp"] },\n  packs: ["agents"],\n})\n`.replaceAll(
        "\n",
        "\r\n",
      ),
    );
  });

  it("adds agents to a packs list that lacks it, so the moved agents.skills stays valid", async () => {
    const m = mini(packs('{ "packs": ["speak"] }'));
    write(m.root, "workerstack.config.ts", `${DEFINE}export default defineConfig({\n  packs: ["docs"],\n})\n`);
    await applyMigration(m.root, planOf(m));
    const text = read(m.root, "workerstack.config.ts");
    expect(text).toContain('agents: { skills: ["speak"] }');
    expect(text).toMatch(/packs: \[[^\]]*"docs"[^\]]*\]/);
    expect(text).toMatch(/packs: \[[^\]]*"agents"[^\]]*\]/);
  });

  it("puts agents alone into an empty packs list", async () => {
    const m = mini(packs('{ "packs": ["speak"] }'));
    write(m.root, "workerstack.config.ts", `${DEFINE}export default defineConfig({ packs: [] })\n`);
    await applyMigration(m.root, planOf(m));
    expect(read(m.root, "workerstack.config.ts")).toBe(
      `${DEFINE}export default defineConfig({\n  agents: { skills: ["speak"] }, packs: ["agents"] })\n`,
    );
  });

  it("plans nothing for no packs, a features file that is not JSON, or packs the config already lists", () => {
    expect(planOf(mini(packs('{ "packs": [] }')))).toEqual([REMOVAL]);
    expect(planOf(mini(packs("{")))).toEqual([REMOVAL]);
    expect(planOf(mini(packs('{ "packs": "listen" }')))).toEqual([REMOVAL]);
    const listed = mini(packs('{ "packs": ["listen"] }'));
    write(
      listed.root,
      "workerstack.config.ts",
      `${DEFINE}export default defineConfig({ agents: { skills: ['listen'] } })\n`,
    );
    expect(planOf(listed)).toEqual([REMOVAL]);
  });

  it("asks the user to add the key when the config has an agents key without the pack, or no defineConfig call", () => {
    const own = mini(packs('{ "packs": ["listen"] }'));
    write(
      own.root,
      "workerstack.config.ts",
      `${DEFINE}export default defineConfig({ "agents": { hosts: ["claude"] } })\n`,
    );
    expect(planOf(own)[0]).toEqual({ kind: "note", note: ASK });
    const plain = mini(packs('{ "packs": ["listen"] }'));
    write(plain.root, "workerstack.config.ts", "export default {}\n");
    expect(planOf(plain)[0]).toEqual({ kind: "note", note: ASK });
  });

  it("puts the config back and says so when the inserted key does not take effect", async () => {
    const m = mini(packs('{ "packs": ["listen"] }'));
    const before = `${DEFINE}// call defineConfig({ later\nexport default defineConfig(\n  { packs: ["agents"] },\n)\n`;
    write(m.root, "workerstack.config.ts", before);
    const steps = planOf(m);
    expect(steps[0]).toMatchObject({ kind: "write", path: "workerstack.config.ts" });
    expect(await applyMigration(m.root, steps)).toContain(
      'repo sync: could not add agents.skills ["listen"] to workerstack.config.ts; add agents: { skills: ["listen"] } there',
    );
    expect(read(m.root, "workerstack.config.ts")).toBe(before);
  });
});

describe("untracking", () => {
  it("lists only the generated paths of the enabled hosts that git tracks", () => {
    const m = mini(
      {
        "AGENTS.md": "x\n",
        ".mcp.json": "{}\n",
        ".claude/settings.json": "{}\n",
        ".cursor/hooks.json": "{}\n",
        ".vscode/tasks.json": "{}\n",
      },
      { git: true },
    );
    const claudeOnly: ResolvedConfig = {
      packs: ["agents"],
      agents: { hosts: ["claude"], skills: [] },
      commit: DEFAULT_COMMIT,
      lint: { skip: [] },
    };
    expect(planOf(m, claudeOnly).find((step) => step.kind === "untrack")).toEqual({
      kind: "untrack",
      paths: ["AGENTS.md", ".mcp.json", ".claude/"],
    });
    expect(planOf(m).find((step) => step.kind === "untrack")).toEqual({
      kind: "untrack",
      paths: ["AGENTS.md", ".mcp.json", ".claude/", ".cursor/"],
    });
  });

  it("plans no untrack when nothing generated is tracked, or when git cannot answer", () => {
    expect(planOf(mini({ "package.json": "{}\n" }, { git: true }))).toEqual([REMOVAL]);
    const broken = mini({ ".mcp.json": "{}\n" });
    fs.mkdirSync(path.join(broken.root, ".git"));
    expect(planOf(broken)).toEqual([REMOVAL]);
  });

  it("stops with the git message when the index cannot be changed, and leaves the copy for the next run", async () => {
    const m = mini({ "AGENTS.md": "x\n" }, { git: true });
    fs.writeFileSync(path.join(m.root, ".git", "index.lock"), "");
    await expect(applyMigration(m.root, planOf(m))).rejects.toThrow(/git rm --cached failed: .*index\.lock/s);
    expect(exists(m.root, COPIED_MARKER)).toBe(true);
    fs.rmSync(path.join(m.root, ".git", "index.lock"));
    expect(await applyMigration(m.root, planOf(m))).toEqual([
      "repo sync: untracked AGENTS.md (now generated) and removed the copied .rulesync/; commit the result",
    ]);
  });
});

describe("repo sync and the migration", () => {
  /** A consumer whose only copied-install trace is the marker, with this repo linked as the stock package. */
  function bare(manifest: string): string {
    const root = tempDir();
    write(root, "workerstack.config.ts", "export default {}\n");
    write(root, "package.json", manifest);
    write(root, COPIED_MARKER, "// copied script\n");
    fs.mkdirSync(path.join(root, "node_modules", "@workerstack"), { recursive: true });
    fs.symlinkSync(SELF_ROOT, path.join(root, "node_modules", "@workerstack", "repo"), "dir");
    return root;
  }

  it("--check says 1 migration step for a single pending step", async () => {
    const result = await sync(bare('{ "name": "x" }\n'), ["--check"]);
    expect(result).toMatchObject({
      code: 1,
      err: ["repo sync: 1 migration step pending; run `bun repo sync`\n"],
      out: [],
    });
  });

  it("reports a conflict as exit 0 under --postinstall, and a failed untrack as an error", async () => {
    const conflict = copied();
    write(conflict, ".repo/rules/team.md", "other\n");
    const result = await sync(conflict, ["--postinstall"]);
    expect(result.code).toBe(0);
    expect(result.err).toHaveLength(1);

    const locked = copied();
    fs.writeFileSync(path.join(locked, ".git", "index.lock"), "");
    const failed = await sync(locked, [], true);
    expect(failed.code).toBe(1);
    expect(failed.err).toEqual([expect.stringMatching(/^repo sync: git rm --cached failed: /)]);
    expect(exists(locked, COPIED_MARKER)).toBe(true);
  });

  it("reports a config that no longer loads after the migration", async () => {
    const root = copied();
    let loads = 0;
    const load: typeof loadConfig = async (dir) => {
      loads += 1;
      return loads === 1 ? loadConfig(dir) : { ok: false, errors: ["workerstack.config.ts: copy refused"] };
    };
    const err: string[] = [];
    const code = await runSync(
      [],
      { cwd: root, stdout: () => {}, stderr: (s) => err.push(s) },
      { generators: [], post: [], load },
    );
    expect(code).toBe(1);
    expect(err.join("")).toContain("copy refused");
    expect(exists(root, COPIED_MARKER)).toBe(false);
  });

  it("never migrates this repo, whatever files it holds", async () => {
    const root = bare('{ "name": "@workerstack/repo" }\n');
    const result = await sync(root, ["--check"]);
    expect(result.err.join("")).not.toContain("migration");
    expect(exists(root, COPIED_MARKER)).toBe(true);
  });
});

describe("copies of older stock versions", () => {
  const OLD_RULE = "---\nroot: false\n---\n# Overview\n\n## Retired section\n\nold stock text\n";
  const OLD_HOOKS = '{ "old": true }\n';
  const hist = (entries: Record<string, string[]>): MigrateDeps => ({
    history: Object.fromEntries(Object.entries(entries).map(([rel, texts]) => [rel, texts.map(hashText)])),
  });

  it("removes a copy equal to an older stock version instead of moving it, whatever its line endings", () => {
    const m = mini({
      ".rulesync/rules/overview.md": OLD_RULE,
      ".rulesync/rules/retired.md": "a rule stock dropped\r\n",
      ".rulesync/subagents/gone.md": "a subagent stock dropped\n",
      ".rulesync/hooks.jsonc": OLD_HOOKS,
      ".rulesync/global-settings/old.toml": "x = 1\n",
      ".rulesync/reference/hooks.md": "# Hooks\n\n## Retired\n\nold\n",
      ".rulesync/reference/skills-guide.md": "# Guide\n",
      ".agents/skills/ask/SKILL.md": "old ask\n",
      ".agents/skills/gone/SKILL.md": "old gone\n",
      ".claude/settings.json": '{ "env": { "OLD": "1" } }\n',
      "AGENTS.md": "old whole agents file\n",
    });
    const deps = hist({
      ".rulesync/rules/overview.md": [OLD_RULE],
      ".rulesync/rules/retired.md": ["a rule stock dropped\n"],
      ".rulesync/subagents/gone.md": ["a subagent stock dropped\n"],
      ".rulesync/hooks.jsonc": [OLD_HOOKS],
      ".rulesync/global-settings/old.toml": ["x = 1\n"],
      "references/hooks.md": ["# Hooks\n\n## Retired\n\nold\n"],
      ".rulesync/reference/skills-guide.md": ["# Guide\n"],
      ".agents/skills/ask/SKILL.md": ["old ask\n"],
      ".agents/skills/gone/SKILL.md": ["old gone\n"],
      ".claude/settings.json": ['{ "env": { "OLD": "1" } }\n'],
      "AGENTS.md": ["old whole agents file\n"],
    });
    expect(planOf(m, CONFIG, deps)).toEqual([
      { kind: "remove", paths: [".agents/skills/ask", ".agents/skills/gone", ".rulesync"] },
    ]);
  });

  it("still moves an edit of an older version, and a file the history does not know", () => {
    const m = mini({
      ".rulesync/rules/overview.md": `${OLD_RULE}\n## Ours\n\nmine\n`,
      ".rulesync/hooks.jsonc": '{ "old": true, "mine": 1 }\n',
      ".agents/skills/ask/SKILL.md": "old ask\n",
      ".agents/skills/ask/extra.md": "my addition\n",
    });
    const deps = hist({
      ".rulesync/rules/overview.md": [OLD_RULE],
      ".rulesync/hooks.jsonc": [OLD_HOOKS],
      ".agents/skills/ask/SKILL.md": ["old ask\n"],
    });
    expect(notes(planOf(m, CONFIG, deps))).toEqual([
      'moved your sections "Retired section", "Ours" of .rulesync/rules/overview.md to .repo/rules/overview-local.md',
      "moved your edited .agents/skills/ask to .repo/skills/ask (it now replaces the stock skill)",
      "moved your .rulesync/hooks.jsonc to .repo/hooks.jsonc (it now replaces the stock hooks)",
    ]);
  });

  it("uses the shipped table: the recorded install's stock copies are all unedited", async () => {
    const root = copied();
    const moved = notes(planMigration(root, stockOf(root), ...(await fixturePlanned())));
    expect(moved).toEqual(LINES.map((line) => line.replace("repo sync: ", "")));
  });
});

describe("no unknown text is deleted", () => {
  const none: MigrateDeps = { history: {} };

  it("moves a stock-named rule edited inside its sections whole, as an override", async () => {
    const m = mini({ ".rulesync/rules/overview.md": "---\nroot: true\n---\n# Overview\n\n## Stock\n\nedited body\n" });
    const steps = planOf(m, CONFIG, none);
    expect(notes(steps)).toEqual([
      "moved your edited .rulesync/rules/overview.md to .repo/rules/overview.md (it now replaces the stock rule)",
    ]);
    expect(await applyMigration(m.root, steps)).toContain(
      "repo sync: moved your edited .rulesync/rules/overview.md to .repo/rules/overview.md (it now replaces the stock rule)",
    );
    expect(read(m.root, ".repo/rules/overview.md")).toContain("edited body");
  });

  it("moves a stock-named reference edited inside its sections to references/", () => {
    const m = mini({ ".rulesync/reference/cascade.md": "# Cascade\n\n## Stock\n\nedited\n" });
    expect(notes(planOf(m, CONFIG, none))).toEqual([
      "moved your edited .rulesync/reference/cascade.md to references/cascade.md",
    ]);
  });

  it("stops on scripts, the pipeline file and settings other than claude.json that match no stock version, and drops those that do", () => {
    const m = mini(
      {
        ".rulesync/scripts/mine.ts": "export {}\n",
        ".rulesync/scripts/deep/tool.ts": "export {}\n",
        ".rulesync/scripts/stock.ts": "stock script\n",
        ".rulesync/repo.pipeline.jsonc": '{ "mine": 1 }\n',
        ".rulesync/settings/claude.json": "{}\n",
        ".rulesync/settings/codex.json": "{}\n",
      },
      { stock: { "cli/scripts/stock.ts": "stock script\n" } },
    );
    const steps = planOf(m, CONFIG, none);
    expect(conflictLines(steps)).toEqual([
      yours(".rulesync/scripts/deep/tool.ts"),
      yours(".rulesync/scripts/mine.ts"),
      yours(".rulesync/settings/codex.json"),
      yours(".rulesync/repo.pipeline.jsonc"),
    ]);
    // An edited settings/claude.json is the overlay's own file and keeps moving there.
    expect(notes(steps)).toEqual(["moved your .rulesync/settings/claude.json to .repo/settings/claude.json"]);
    const old = hashText("old script\n");
    const known = mini(
      { ".rulesync/scripts/old.ts": "old script\n", ".rulesync/repo.pipeline.jsonc": "{}\n" },
      {
        stock: { "agents/repo.pipeline.jsonc": "{}\n" },
      },
    );
    expect(planOf(known, CONFIG, { history: { ".rulesync/scripts/old.ts": [old] } })).toEqual([REMOVAL]);
  });

  it("stops on any other entry of the copied dir, one line per entry, and leaves reference and the features file to their own handling", () => {
    const m = mini({
      ".rulesync/notes.md": "mine\n",
      ".rulesync/misc/a.txt": "a\n",
      ".rulesync/repo.features.jsonc": "{}\n",
      ".rulesync/reference/deploy.md": "# Deploy\n",
    });
    const steps = planOf(m, CONFIG, none);
    expect(conflictLines(steps)).toEqual([yours(".rulesync/misc"), yours(".rulesync/notes.md")]);
    expect(notes(steps)).toEqual(["moved .rulesync/reference/deploy.md to references/deploy.md"]);
  });

  it("moves a folder found where a rule, subagent or global setting should be", () => {
    const m = mini({
      ".rulesync/rules/folder/a.md": "a\n",
      ".rulesync/subagents/folder/b.md": "b\n",
      ".rulesync/global-settings/folder/c.json": "{}\n",
    });
    expect(notes(planOf(m, CONFIG, none))).toEqual([
      "moved .rulesync/rules/folder to .repo/rules/folder",
      "moved .rulesync/subagents/folder to .repo/subagents/folder",
      "moved your .rulesync/global-settings/folder to .repo/global-settings/folder",
    ]);
  });

  it("refuses to overwrite a differing file when a move meets one written earlier in the run", async () => {
    const m = mini({ ".rulesync/settings/claude.json": '{ "a": 1 }\n', ".repo/settings/claude.json": '{ "b": 2 }\n' });
    await expect(
      applyMigration(m.root, [
        { kind: "move", from: ".rulesync/settings/claude.json", to: ".repo/settings/claude.json", note: "x" },
      ]),
    ).rejects.toThrow(/already exists and differs/);
    expect(read(m.root, ".rulesync/settings/claude.json")).toBe('{ "a": 1 }\n');
  });
});

describe("hooks in .claude/settings.json", () => {
  const stockGroup = { matcher: "Bash", hooks: [{ type: "command", command: "stock-cmd", timeout: 5 }] };
  const stockSettings = JSON.stringify({ hooks: { PreToolUse: [stockGroup] } });
  const opts = { generated: { ".claude/settings.json": stockSettings } };
  const TO = ".repo/settings/claude.json";

  it("carries hook groups and commands that no stock version ran, under the same event", async () => {
    const mine = { matcher: "Edit", hooks: [{ type: "command", command: "mine" }] };
    const mixed = {
      matcher: "Bash",
      hooks: [
        { type: "command", command: "stock-cmd", timeout: 5 },
        { type: "command", command: "mine-too" },
      ],
    };
    const m = mini(
      {
        ".claude/settings.json": JSON.stringify({
          permissions: { allow: ["X"] },
          hooks: {
            PreToolUse: [stockGroup, mixed],
            PostToolUse: [mine],
            Stop: [{ matcher: "*", hooks: [{ type: "command", command: "old stock" }] }],
          },
        }),
      },
      opts,
    );
    const deps: MigrateDeps = { history: { [HOOK_COMMANDS_KEY]: [hashText("old stock")] } };
    const steps = planOf(m, CONFIG, deps);
    expect(notes(steps).slice(0, 1)).toEqual([
      `moved your .claude/settings.json keys permissions to ${TO}\nmoved your .claude/settings.json hooks PreToolUse (1) to ${TO}\nmoved your .claude/settings.json hooks PostToolUse (1) to ${TO}`,
    ]);
    expect(JSON.parse(contents(steps)[0]!)).toEqual({
      permissions: { allow: ["X"] },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "mine-too" }] }],
        PostToolUse: [mine],
      },
    });
    expect((await applyMigration(m.root, steps)).slice(0, 3)).toEqual([
      `repo sync: moved your .claude/settings.json keys permissions to ${TO}`,
      `repo sync: moved your .claude/settings.json hooks PreToolUse (1) to ${TO}`,
      `repo sync: moved your .claude/settings.json hooks PostToolUse (1) to ${TO}`,
    ]);
  });

  it("carries only hooks when nothing else is new, and plans nothing when every command is stock", () => {
    const own = { type: "command", command: "mine" };
    const only = mini(
      { ".claude/settings.json": JSON.stringify({ hooks: { PostToolUse: [{ matcher: "x", hooks: [own] }] } }) },
      opts,
    );
    expect(notes(planOf(only, CONFIG, { history: {} }))).toEqual([
      `moved your .claude/settings.json hooks PostToolUse (1) to ${TO}`,
    ]);
    const stockOnly = mini({ ".claude/settings.json": JSON.stringify({ hooks: { PreToolUse: [stockGroup] } }) }, opts);
    expect(planOf(stockOnly, CONFIG, { history: {} })).toEqual([REMOVAL]);
  });

  it("carries a group or an event value it cannot read as it is, and a hook with no command", () => {
    const m = mini(
      {
        ".claude/settings.json": JSON.stringify({
          hooks: { A: ["text"], B: "odd", C: [{ matcher: "m", hooks: [{ type: "prompt" }] }], D: [{ matcher: "m" }] },
        }),
      },
      opts,
    );
    expect(JSON.parse(contents(planOf(m, CONFIG, { history: {} }))[0]!)).toEqual({
      hooks: { A: ["text"], B: ["odd"], C: [{ matcher: "m", hooks: [{ type: "prompt" }] }], D: [{ matcher: "m" }] },
    });
    const notObject = mini({ ".claude/settings.json": JSON.stringify({ hooks: "nope", env: { Z: "1" } }) }, opts);
    expect(notes(planOf(notObject, CONFIG, { history: {} }))).toEqual([
      `moved your .claude/settings.json keys env to ${TO}`,
    ]);
  });
});

describe("adopting what a consumer already has where sync generates", () => {
  const RULE = "# Team rules\n\nAlways run the linter.\n";
  const STOP = (rel: string) =>
    `repo sync: ${rel} is yours and would be ignored; move it under .repo/ (see node_modules/@workerstack/repo/references/map.md) or delete it, then run \`bun repo sync\`\n`;

  /** A consumer that never ran the copying init: a config, the stock linked in, and `files` committed. */
  function plain(files: Record<string, string>, options: { git?: boolean } = {}): string {
    const root = tempDir();
    write(root, "workerstack.config.ts", "export default {}\n");
    write(root, "package.json", JSON.stringify({ name: "fixture" }));
    for (const [rel, text] of Object.entries(files)) write(root, rel, text);
    fs.mkdirSync(path.join(root, "node_modules", "@workerstack"), { recursive: true });
    fs.symlinkSync(SELF_ROOT, path.join(root, "node_modules", "@workerstack", "repo"), "dir");
    if (options.git !== false) {
      git(root, "init", "-q");
      fs.appendFileSync(path.join(root, ".git", "info", "exclude"), "node_modules/\n");
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", "own files");
    }
    return root;
  }

  const tracked = (root: string): string[] => git(root, "ls-files").split("\n").filter(Boolean);

  it("takes a hand-written tracked AGENTS.md into .repo/rules/agents.md, the generated AGENTS.md and out of the index", async () => {
    const root = plain({ "AGENTS.md": RULE });
    const result = await sync(root, [], true);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("repo sync: adopted your AGENTS.md as .repo/rules/agents.md\n");
    expect(result.out).toContain("repo sync: untracked AGENTS.md (now generated); commit the result\n");
    expect(read(root, ".repo/rules/agents.md")).toBe(
      `---\ndescription: Carried over from your earlier setup\n---\n${RULE.trim()}\n`,
    );
    expect(read(root, "AGENTS.md")).toContain("Always run the linter.");
    expect(tracked(root)).not.toContain("AGENTS.md");
  }, 120_000);

  it("adopts nothing a previous sync wrote: an edited generated file is overwritten, not adopted", async () => {
    const root = plain({});
    expect((await sync(root, [], true)).code).toBe(0);
    write(root, "AGENTS.md", `${read(root, "AGENTS.md")}\nstray edit\n`);
    expect((await sync(root, [], true)).code).toBe(0);
    expect(exists(root, ".repo/rules/agents.md")).toBe(false);
    expect(read(root, "AGENTS.md")).not.toContain("stray edit");
  }, 120_000);

  it("adopts nothing that equals what sync would generate, even with the manifest gone", async () => {
    const root = plain({});
    expect((await sync(root, [], true)).code).toBe(0);
    fs.rmSync(path.join(root, ".repo", "tmp", "sync.json"));
    const result = await sync(root, [], true);
    expect(result.code).toBe(0);
    expect(result.out.join("")).not.toContain("adopted");
    expect(exists(root, ".repo/rules")).toBe(false);
  }, 120_000);

  it("takes the keys and hooks of a .claude/settings.json it does not generate into .repo/settings/claude.json", async () => {
    const mine = {
      permissions: { allow: ["Bash(make lint:*)"] },
      hooks: { PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "make post-write" }] }] },
    };
    const root = plain({ ".claude/settings.json": JSON.stringify(mine) });
    const result = await sync(root, [], true);
    expect(result.err).toEqual([]);
    expect(result.out).toContain(
      "repo sync: moved your .claude/settings.json keys permissions.allow to .repo/settings/claude.json\n",
    );
    expect(JSON.parse(read(root, ".repo/settings/claude.json"))).toEqual(mine);
    const settings = JSON.parse(read(root, ".claude/settings.json")) as { permissions: { allow: string[] } };
    expect(settings.permissions.allow).toContain("Bash(make lint:*)");
    expect(read(root, ".claude/settings.json")).toContain("make post-write");
    expect(tracked(root).filter((rel) => rel.startsWith(".claude/"))).toEqual([]);
  }, 120_000);

  it("stops on a .claude/settings.json or .mcp.json that is not a JSON object, changing nothing", async () => {
    for (const rel of [".claude/settings.json", ".mcp.json"]) {
      for (const text of ["{", "[]"]) {
        const root = plain({ [rel]: text });
        const before = snapshot(root);
        const result = await sync(root, [], true);
        expect(result.code).toBe(1);
        expect(result.err).toEqual([STOP(rel)]);
        expect(snapshot(root)).toEqual(before);
      }
    }
  }, 240_000);

  it("takes the servers of a .mcp.json it does not generate into .repo/mcp.json, merged back into the generated one", async () => {
    const server = { command: "npx", args: ["-y", "docs-mcp"] };
    const root = plain({ ".mcp.json": JSON.stringify({ mcpServers: { docs: server } }) });
    const result = await sync(root, [], true);
    expect(result.err).toEqual([]);
    expect(result.out).toContain("repo sync: moved your .mcp.json keys mcpServers.docs to .repo/mcp.json\n");
    expect(JSON.parse(read(root, ".repo/mcp.json"))).toEqual({ mcpServers: { docs: server } });
    expect((JSON.parse(read(root, ".mcp.json")) as { mcpServers: Record<string, unknown> }).mcpServers.docs).toEqual(
      server,
    );
    expect(tracked(root)).not.toContain(".mcp.json");
  }, 120_000);

  it("moves a real skill dir under .agents/skills or .claude/skills to .repo/skills and links it", async () => {
    const root = plain({
      ".claude/skills/deploy/SKILL.md": "---\nname: deploy\ndescription: ship\n---\nShip it.\n",
      ".agents/skills/lint/SKILL.md": "---\nname: lint\ndescription: lint\n---\nLint it.\n",
    });
    const result = await sync(root, [], true);
    expect(result.err).toEqual([]);
    expect(result.out).toContain("repo sync: moved .claude/skills/deploy to .repo/skills/deploy\n");
    expect(result.out).toContain("repo sync: moved .agents/skills/lint to .repo/skills/lint\n");
    expect(read(root, ".repo/skills/deploy/SKILL.md")).toContain("Ship it.");
    expect(fs.lstatSync(path.join(root, ".claude/skills/deploy")).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(path.join(root, ".agents/skills/lint")).isSymbolicLink()).toBe(true);
    expect(tracked(root).filter((rel) => rel.startsWith(".claude/") || rel.startsWith(".agents/"))).toEqual([]);
  }, 120_000);

  it("leaves a real skill dir that is an unedited stock copy to be replaced by its link", async () => {
    const root = plain({});
    fs.cpSync(path.join(SELF_ROOT, ".agents", "skills", "ask"), path.join(root, ".claude", "skills", "ask"), {
      recursive: true,
    });
    const result = await sync(root, [], true);
    expect(result.code).toBe(0);
    expect(exists(root, ".repo/skills")).toBe(false);
    expect(fs.lstatSync(path.join(root, ".claude/skills/ask")).isSymbolicLink()).toBe(true);
  }, 120_000);

  it("stops, changing nothing, on a file sync would overwrite with other text", async () => {
    const root = plain({});
    write(root, ".claude/agents/scout.md", "my own scout\n");
    const before = snapshot(root);
    const result = await sync(root, [], true);
    expect(result.code).toBe(1);
    expect(result.err).toEqual([STOP(".claude/agents/scout.md")]);
    expect(snapshot(root)).toEqual(before);
  }, 120_000);

  it("stops on a tracked file under a host dir that it cannot adopt, one line per file, and only those", async () => {
    const root = plain({
      ".claude/commands/b.md": "b\n",
      ".claude/commands/a.md": "a\n",
      ".cursor/rules/x.mdc": "x\n",
    });
    write(root, ".claude/commands/untracked.md", "u\n");
    const before = snapshot(root);
    const result = await sync(root, [], true);
    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      STOP(".claude/commands/a.md"),
      STOP(".claude/commands/b.md"),
      STOP(".cursor/rules/x.mdc"),
    ]);
    expect(snapshot(root)).toEqual(before);
    expect(tracked(root)).toContain(".claude/commands/a.md");
  }, 120_000);

  it("leaves an untracked file it does not generate alone", async () => {
    const root = plain({});
    write(root, ".claude/settings.local.json", "{}\n");
    const result = await sync(root, [], true);
    expect(result.code).toBe(0);
    expect(read(root, ".claude/settings.local.json")).toBe("{}\n");
  }, 120_000);

  it("reports a stop as exit 0 under --postinstall", async () => {
    const root = plain({ ".claude/commands/a.md": "a\n" });
    const result = await sync(root, ["--postinstall"], true);
    expect(result.code).toBe(0);
    expect(result.err).toEqual([STOP(".claude/commands/a.md")]);
  }, 120_000);

  it("--check prints the pending count, exits 1 and writes nothing", async () => {
    const root = plain({ "AGENTS.md": RULE });
    const before = snapshot(root);
    const result = await sync(root, ["--check"], true);
    expect(result.code).toBe(1);
    expect(result.err).toEqual(["repo sync: 2 adoption steps pending; run `bun repo sync`\n"]);
    expect(snapshot(root)).toEqual(before);
    const one = plain({ "AGENTS.md": RULE }, { git: false });
    expect((await sync(one, ["--check"], true)).err).toEqual([
      "repo sync: 1 adoption step pending; run `bun repo sync`\n",
    ]);
  }, 120_000);

  it("stops when .repo/rules/agents.md already holds other text", async () => {
    const root = plain({
      "AGENTS.md": RULE,
      ".repo/rules/agents.md": "---\ndescription: Carried over from your earlier setup\n---\nother\n",
    });
    const before = snapshot(root);
    const result = await sync(root, [], true);
    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      "repo sync: cannot move AGENTS.md: .repo/rules/agents.md already exists and differs; merge them by hand, then run `bun repo sync`\n",
    ]);
    expect(snapshot(root)).toEqual(before);
  }, 120_000);

  it("adopts outside git and does not untrack", async () => {
    const root = plain({ "AGENTS.md": RULE }, { git: false });
    const result = await sync(root, [], true);
    expect(result.code).toBe(0);
    expect(result.out.join("")).not.toContain("untracked");
    expect(read(root, ".repo/rules/agents.md")).toContain("Always run the linter.");
  }, 120_000);

  it("stops on a real file where a skill link belongs", async () => {
    const root = plain({});
    write(root, ".claude/skills/ask", "not a skill dir\n");
    const result = await sync(root, [], true);
    expect(result.code).toBe(1);
    expect(result.err).toEqual([STOP(".claude/skills/ask")]);
  }, 120_000);

  it("reports a move that fails while it runs, and a generator error the adoption causes", async () => {
    const both = plain({
      ".agents/skills/x/SKILL.md": "---\nname: x\n---\none\n",
      ".claude/skills/x/SKILL.md": "---\nname: x\n---\ntwo\n",
    });
    const clash = await sync(both, [], true);
    expect(clash.code).toBe(1);
    expect(clash.err.join("")).toContain("already exists and differs");

    const root = plain({ "AGENTS.md": RULE }, { git: false });
    const generator = (ctx: { read: (rel: string) => string | null }) =>
      ctx.read(".repo/rules/agents.md") === null
        ? {
            outputs: [
              {
                kind: "file" as const,
                path: "AGENTS.md",
                content: "generated\n",
                tracked: false,
                managed: "whole" as const,
              },
            ],
            errors: [],
          }
        : { outputs: [], errors: ["generator saw the adopted rule"] };
    const out: string[] = [];
    const err: string[] = [];
    const code = await runSync(
      [],
      { cwd: root, stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
      { generators: [generator] },
    );
    expect(code).toBe(1);
    expect(err).toEqual(["repo sync: generator saw the adopted rule\n", "repo sync: nothing written\n"]);
    expect(read(root, ".repo/rules/agents.md")).toContain("Always run the linter.");
  }, 120_000);

  describe("planAdoption on its own", () => {
    const file = (rel: string, content: string) => ({
      kind: "file" as const,
      path: rel,
      content,
      tracked: false,
      managed: "whole" as const,
    });
    const plan = (root: string, outputs: ReturnType<typeof file>[], deps: MigrateDeps = {}) =>
      planAdoption(root, stockOf(root), CONFIG, outputs, [], deps);

    it("plans nothing for a whitespace-only AGENTS.md", () => {
      const root = plain({ "AGENTS.md": "  \n" }, { git: false });
      expect(plan(root, [file("AGENTS.md", "generated\n")])).toEqual([]);
    });

    it("plans nothing for .mcp.json servers the generated one has, or when sync generates no JSON there", () => {
      const root = plain({ ".mcp.json": '{"mcpServers":{"a":{}}}' }, { git: false });
      expect(plan(root, [file(".mcp.json", '{"mcpServers":{"a":{},"b":{}}}')])).toEqual([]);
      expect(plan(root, [file(".mcp.json", "generated\n")])).toEqual([]);
    });

    it("skips a tracked file that is gone, a tracked link, and a tracked copy of a past stock file", () => {
      const root = plain({ ".claude/agents/gone.md": "x\n", ".claude/agents/old.md": "old\n" });
      fs.symlinkSync("../../elsewhere", path.join(root, ".claude", "linked"), "dir");
      git(root, "add", "-A");
      fs.rmSync(path.join(root, ".claude/agents/gone.md"));
      const history = { ".claude/agents/old.md": [hashText("old\n")] };
      expect(plan(root, [], { history })).toEqual([]);
    });
  });

  it("never adopts in this repo", async () => {
    const self = plain({ "AGENTS.md": RULE }, { git: false });
    write(self, "package.json", JSON.stringify({ name: "@workerstack/repo" }));
    expect((await sync(self, ["--check"], true)).err.join("")).not.toContain("adoption");
  }, 180_000);

  it("keeps the adoption and writes nothing else when its result is invalid", async () => {
    const root = plain({ "AGENTS.md": RULE }, { git: false });
    const agents = {
      kind: "file" as const,
      path: "AGENTS.md",
      content: "# Generated\n",
      tracked: false,
      managed: "whole" as const,
    };
    const deps = settingsOnceMade(".repo/rules/agents.md");
    const result = await run(root, { generators: [...deps.generators, () => ({ outputs: [agents], errors: [] })] });
    expect(result).toEqual({ code: 1, err: [SCHEMA_LINE, "repo sync: nothing written\n"] });
    expect(exists(root, ".repo/rules/agents.md")).toBe(true);
    expect(exists(root, SETTINGS)).toBe(false);
  });
});

const SETTINGS = ".claude/settings.json";
const BAD = '{"hooks":{"PreToolUse":"x"}}\n';
const SCHEMA_LINE =
  "repo sync: .claude/settings.json: hooks.PreToolUse: Invalid input: expected array, received string\n";
/** Plans a valid settings file until `made` exists, then an invalid one. */
const settingsOnceMade = (made: string) => ({
  generators: [
    (ctx: { read(rel: string): string | null }) => ({
      outputs: [
        {
          kind: "file" as const,
          path: SETTINGS,
          content: ctx.read(made) === null ? "{}\n" : BAD,
          tracked: false,
          managed: "whole" as const,
        },
      ],
      errors: [],
    }),
  ],
});
const run = async (root: string, deps: Parameters<typeof runSync>[2]) => {
  const err: string[] = [];
  const code = await runSync([], { cwd: root, stdout: () => {}, stderr: (s) => err.push(s) }, deps);
  return { code, err };
};

describe("repo sync validates what the migration and the adoption change", () => {
  it("keeps the migration and writes nothing else when its result is invalid", async () => {
    const root = copied({ git: false });
    const result = await run(root, settingsOnceMade(".repo/rules/team.md"));
    expect(result).toEqual({ code: 1, err: [SCHEMA_LINE, "repo sync: nothing written\n"] });
    expect(exists(root, ".rulesync")).toBe(false);
    expect(exists(root, ".repo/rules/team.md")).toBe(true);
    expect(exists(root, SETTINGS)).toBe(false);
    expect(exists(root, ".repo/tmp/sync.json")).toBe(false);
  });
});

describe("planRuleUpgrade", () => {
  const STOCK = {
    "package.json": '{ "name": "@workerstack/repo" }\n',
    "agents/rules/overview.md": "---\ndescription: Stock\n---\nstock\n",
    "agents/rules/deep/style.md": "---\ndescription: Stock\n---\nstock\n",
    "agents/subagents/scout.md": "---\nname: scout\n---\nstock\n",
  };

  /** A consumer holding `files` beside a fake stock package. */
  function upgradeRoot(files: Record<string, string>): { root: string; stock: string } {
    const dir = tempDir();
    const stock = path.join(dir, "stock");
    const root = path.join(dir, "root");
    for (const [rel, text] of Object.entries(STOCK)) write(stock, rel, text);
    fs.mkdirSync(root, { recursive: true });
    for (const [rel, text] of Object.entries(files)) write(root, rel, text);
    return { root, stock };
  }

  const plan = (files: Record<string, string>) => {
    const { root, stock } = upgradeRoot(files);
    return { root, stock, steps: planRuleUpgrade(root, stock) };
  };

  it("rewrites globs to paths, drops root and targets, and takes the description from the first heading", () => {
    const { steps } = plan({
      ".repo/rules/testing.md":
        '---\nroot: false\ntargets: ["*"]\nglobs:\n  - src/**\n  - lib/**\n---\n# Testing rules\n\nBody.\n',
    });
    expect(steps).toEqual([
      {
        kind: "write",
        path: ".repo/rules/testing.md",
        content: "---\ndescription: Testing rules\npaths:\n  - src/**\n  - lib/**\n---\n# Testing rules\n\nBody.\n",
        note: "rewrote .repo/rules/testing.md frontmatter (description added, globs → paths, root and targets dropped)",
      },
    ]);
  });

  it("falls back to the rule name for the description and reads comma-separated globs", () => {
    const { steps } = plan({ ".repo/rules/notes.md": '---\nglobs: "a/**, b/**"\n---\nNo heading.\n' });
    expect(contents(steps)).toEqual(["---\ndescription: notes\npaths:\n  - a/**\n  - b/**\n---\nNo heading.\n"]);
  });

  it.each([['["**/*"]'], ['["*"]'], ['["src/**", "**/*"]']])("turns globs %s into no paths", (globs) => {
    const { steps } = plan({ ".repo/rules/all.md": `---\ndescription: Keep me\nglobs: ${globs}\n---\nBody.\n` });
    expect(contents(steps)).toEqual(["---\ndescription: Keep me\n---\nBody.\n"]);
    expect(notes(steps)).toEqual(["rewrote .repo/rules/all.md frontmatter (globs dropped)"]);
  });

  it("keeps the other keys and the body byte for byte", () => {
    const { steps } = plan({
      ".repo/rules/x.md": "---\n# a note\nroot: false\ndescription: D\nextra: 'v'\n---\n# H\n\n---\ntext  \n",
    });
    expect(contents(steps)).toEqual(["---\n# a note\ndescription: D\nextra: 'v'\n---\n# H\n\n---\ntext  \n"]);
  });

  it("marks an old-format rule that bears a stock name, case-folded and nested, in the same step", () => {
    const { steps } = plan({
      ".repo/rules/Overview.md": "---\nroot: true\nglobs: ['**/*']\n---\n# Mine\n",
      ".repo/rules/deep/style.md": "---\nroot: false\n---\nBody\n",
    });
    expect(steps).toEqual([
      {
        kind: "write",
        path: ".repo/rules/Overview.md",
        content: "---\ndescription: Mine\noverrides: Overview\n---\n# Mine\n",
        note: "rewrote .repo/rules/Overview.md frontmatter (description added, root and globs dropped)\nmarked .repo/rules/Overview.md with overrides: Overview (it replaces the stock rule)",
      },
      {
        kind: "write",
        path: ".repo/rules/deep/style.md",
        content: "---\ndescription: style\noverrides: deep/style\n---\nBody\n",
        note: "rewrote .repo/rules/deep/style.md frontmatter (description added, root dropped)\nmarked .repo/rules/deep/style.md with overrides: deep/style (it replaces the stock rule)",
      },
    ]);
  });

  it("never marks a new-format file, and leaves a new-format rule that lacks a description alone", () => {
    const { steps } = plan({
      ".repo/rules/overview.md": "---\ndescription: Mine\n---\nBody\n",
      ".repo/rules/style.md": "---\npaths: [a]\n---\nBody\n",
      ".repo/subagents/scout.md": "---\nname: scout\ndescription: mine\n---\nBody\n",
    });
    expect(steps).toEqual([]);
  });

  it("does not mark an old-format file that bears no stock name", () => {
    const { steps } = plan({ ".repo/rules/team.md": "---\nroot: false\ndescription: Team\n---\nBody\n" });
    expect(contents(steps)).toEqual(["---\ndescription: Team\n---\nBody\n"]);
  });

  it("keeps an overrides that is already there and never doubles it", () => {
    const { steps } = plan({
      ".repo/rules/overview.md": "---\nroot: true\ndescription: D\noverrides: overview\n---\nB\n",
    });
    expect(contents(steps)).toEqual(["---\ndescription: D\noverrides: overview\n---\nB\n"]);
    expect(notes(steps)).toEqual(["rewrote .repo/rules/overview.md frontmatter (root dropped)"]);
  });

  it("marks an old-format subagent that bears a stock name and keeps its targets", () => {
    const { steps } = plan({
      ".repo/subagents/scout.md": "---\nname: scout\ntargets:\n  - claudecode\n---\nBody\n",
      ".repo/subagents/mine.md": "---\nname: mine\ntargets:\n  - claudecode\n---\nBody\n",
    });
    expect(steps).toEqual([
      {
        kind: "write",
        path: ".repo/subagents/scout.md",
        content: "---\noverrides: scout\nname: scout\ntargets:\n  - claudecode\n---\nBody\n",
        note: "marked .repo/subagents/scout.md with overrides: scout (it replaces the stock subagent)",
      },
    ]);
  });

  it("drops root and globs from a subagent", () => {
    const { steps } = plan({ ".repo/subagents/mine.md": "---\nname: mine\nroot: false\nglobs: [a]\n---\nBody\n" });
    expect(contents(steps)).toEqual(["---\nname: mine\n---\nBody\n"]);
  });

  it("keeps CRLF line endings when it rewrites", () => {
    const { steps } = plan({ ".repo/rules/crlf.md": "---\r\nroot: false\r\ndescription: D\r\n---\r\nBody\r\n" });
    expect(contents(steps)).toEqual(["---\r\ndescription: D\r\n---\r\nBody\r\n"]);
  });

  it("skips a file whose frontmatter does not parse, for the loader to report", () => {
    expect(plan({ ".repo/rules/a.md": "no fence\n", ".repo/rules/b.md": "---\nroot: [\n---\n" }).steps).toEqual([]);
  });

  it("plans nothing without .repo, and rewrites without a stock package", () => {
    const { root } = upgradeRoot({});
    expect(planRuleUpgrade(root, path.join(root, "missing"))).toEqual([]);
    write(root, ".repo/rules/a.md", "---\nroot: false\n---\nBody\n");
    expect(contents(planRuleUpgrade(root, path.join(root, "missing")))).toEqual(["---\ndescription: a\n---\nBody\n"]);
  });

  it("plans nothing on a second run", async () => {
    const { root, stock, steps } = plan({
      ".repo/rules/overview.md": "---\nroot: true\nglobs: ['**/*']\n---\n# Mine\n",
      ".repo/rules/testing.md": "---\nroot: false\nglobs: [src/**]\n---\nBody\n",
      ".repo/subagents/scout.md": "---\nname: scout\ntargets: [claudecode]\n---\nBody\n",
    });
    expect(steps).toHaveLength(3);
    const lines = await applyMigration(root, steps);
    expect(lines).toHaveLength(4);
    expect(lines.every((line) => line.startsWith("repo sync: "))).toBe(true);
    expect(planRuleUpgrade(root, stock)).toEqual([]);
  });
});

describe("migration and adoption mark what they move onto a stock name", () => {
  it("marks a moved stock rule, subagent and skill, and nothing else", async () => {
    const m = mini(
      {
        ".rulesync/rules/plain.md": "---\nroot: false\n---\nedited plain\n",
        ".rulesync/rules/team.md": "own\n",
        ".rulesync/subagents/scout.md": "---\nname: scout\n---\nedited scout\n",
        ".rulesync/subagents/mine.md": "own\n",
        ".agents/skills/ask/SKILL.md": "---\nname: ask\n---\nedited\n",
        ".agents/skills/deploy/SKILL.md": "deploy\n",
      },
      { stock: { "agents/rules/plain.md": "---\nroot: false\n---\nstock plain\n" } },
    );
    const lines = await applyMigration(m.root, planOf(m));
    expect(lines).toContain(
      "repo sync: moved your edited .rulesync/rules/plain.md to .repo/rules/plain.md (it now replaces the stock rule)",
    );
    expect(lines).toContain(
      "repo sync: marked .repo/rules/plain.md with overrides: plain (it replaces the stock rule)",
    );
    expect(lines).toContain(
      "repo sync: marked .repo/subagents/scout.md with overrides: scout (it replaces the stock subagent)",
    );
    expect(lines).toContain(
      "repo sync: marked .repo/skills/ask/SKILL.md with overrides: ask (it replaces the stock skill)",
    );
    expect(lines.filter((line) => line.includes("marked"))).toHaveLength(3);
    expect(read(m.root, ".repo/rules/plain.md")).toBe("---\noverrides: plain\nroot: false\n---\nedited plain\n");
    expect(read(m.root, ".repo/subagents/scout.md")).toBe("---\noverrides: scout\nname: scout\n---\nedited scout\n");
    expect(read(m.root, ".repo/skills/ask/SKILL.md")).toBe("---\noverrides: ask\nname: ask\n---\nedited\n");
    expect(read(m.root, ".repo/rules/team.md")).toBe("own\n");
    expect(read(m.root, ".repo/subagents/mine.md")).toBe("own\n");
    expect(read(m.root, ".repo/skills/deploy/SKILL.md")).toBe("deploy\n");
  });

  it("frames a file with no frontmatter", async () => {
    const m = mini({ ".agents/skills/ask/SKILL.md": "edited\n" });
    await applyMigration(m.root, planOf(m));
    expect(read(m.root, ".repo/skills/ask/SKILL.md")).toBe("---\noverrides: ask\n---\nedited\n");
  });

  it("does not double a mark that a stopped run already made", async () => {
    const m = mini({ ".agents/skills/ask/SKILL.md": "---\noverrides: ask\n---\nedited\n" });
    const lines = await applyMigration(m.root, planOf(m));
    expect(read(m.root, ".repo/skills/ask/SKILL.md")).toBe("---\noverrides: ask\n---\nedited\n");
    expect(lines.filter((line) => line.includes("marked"))).toEqual([]);
  });

  it("moves a stock rule whose frontmatter does not parse without marking it", async () => {
    const broken = "---\n: [\n---\nedited plain\n";
    const m = mini(
      { ".rulesync/rules/plain.md": broken },
      { stock: { "agents/rules/plain.md": "---\nroot: false\n---\nstock plain\n" } },
    );
    const lines = await applyMigration(m.root, planOf(m));
    expect(lines.filter((line) => line.includes("marked"))).toEqual([]);
    expect(read(m.root, ".repo/rules/plain.md")).toBe(broken);
  });

  it("moves an edited stock skill that has no SKILL.md without a mark", async () => {
    const m = mini({ ".agents/skills/ask/extra.md": "mine\n" });
    const lines = await applyMigration(m.root, planOf(m));
    expect(lines.filter((line) => line.includes("marked"))).toEqual([]);
    expect(read(m.root, ".repo/skills/ask/extra.md")).toBe("mine\n");
  });

  it("keeps CRLF line endings when it marks, and frames a frontmatter that never closes", async () => {
    const m = mini(
      {
        ".rulesync/rules/plain.md": "---\r\nroot: false\r\n---\r\nedited\r\n",
        ".rulesync/subagents/scout.md": "---\nname: scout\nunclosed\n",
      },
      { stock: { "agents/rules/plain.md": "---\nroot: false\n---\nstock plain\n" } },
    );
    await applyMigration(m.root, planOf(m));
    expect(read(m.root, ".repo/rules/plain.md")).toBe("---\r\noverrides: plain\r\nroot: false\r\n---\r\nedited\r\n");
    expect(read(m.root, ".repo/subagents/scout.md")).toBe("---\noverrides: scout\n---\n---\nname: scout\nunclosed\n");
  });

  it("marks an adopted skill that bears a stock name, so the first sync passes", async () => {
    const root = tempDir();
    write(root, "workerstack.config.ts", "export default {}\n");
    write(root, "package.json", JSON.stringify({ name: "fixture" }));
    write(root, ".claude/skills/ask/SKILL.md", "---\nname: ask\ndescription: mine\n---\nmy ask\n");
    fs.mkdirSync(path.join(root, "node_modules", "@workerstack"), { recursive: true });
    fs.symlinkSync(SELF_ROOT, path.join(root, "node_modules", "@workerstack", "repo"), "dir");
    const result = await sync(root, [], true);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.out.join("")).toContain(
      "repo sync: marked .repo/skills/ask/SKILL.md with overrides: ask (it replaces the stock skill)\n",
    );
    expect(read(root, ".repo/skills/ask/SKILL.md")).toContain("overrides: ask");
  }, 120_000);
});
