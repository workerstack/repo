import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONFIG_FILE,
  HOSTS,
  SKILL_PACKS,
  defaultPacks,
  defineConfig,
  enabledSkills,
  findRoot,
  loadConfig,
} from "./config.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temps: string[] = [];
const AGENTS = { hosts: ["claude", "codex", "antigravity", "grok", "cursor"], skills: [] };
const COMMIT = { maxChangedLines: 1000 };
const LINT = { skip: [] };
const KNIP = { ignore: [] };
const CI = { checks: {} };
const NIGHTLY = { secrets: [], shards: 1 };
const COVERAGE = {
  floors: "coverage-floors.json",
  knownFailures: "known-failures.json",
  mutate: ["src/**/*.ts"],
  mutationFloors: "mutation-floors.json",
};

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-config-"));
  temps.push(dir);
  return dir;
}

/** A temp repo root holding `config` as workerstack.config.ts, and `manifest` as package.json unless it is null. */
function repo(config: string, manifest: object | string | null = { name: "fixture" }): string {
  const root = tempDir();
  fs.writeFileSync(path.join(root, CONFIG_FILE), config);
  if (manifest !== null) {
    const text = typeof manifest === "string" ? manifest : JSON.stringify(manifest);
    fs.writeFileSync(path.join(root, "package.json"), text);
  }
  return root;
}

/** Links `<root>/node_modules/@workerstack/repo` to this checkout, as an install of the package would. */
function linkPackage(root: string): void {
  const scope = path.join(root, "node_modules", "@workerstack");
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(REPO_ROOT, path.join(scope, "repo"), "junction");
}

describe("loadConfig", () => {
  it("returns the packs a config declares through defineConfig", async () => {
    const root = repo(
      'import { defineConfig } from "@workerstack/repo"\n\nexport default defineConfig({\n  packs: ["docs", "agents"],\n})\n',
    );
    linkPackage(root);
    expect(await loadConfig(root)).toEqual({
      config: {
        agents: AGENTS,
        ci: CI,
        commit: COMMIT,
        coverage: COVERAGE,
        knip: KNIP,
        lint: LINT,
        nightly: NIGHTLY,
        packs: ["docs", "agents"],
        tdd: false,
      },
      ok: true,
    });
  });

  it("keeps an empty pack list as declared", async () => {
    expect(await loadConfig(repo("export default { packs: [] }\n"))).toEqual({
      config: {
        agents: AGENTS,
        ci: CI,
        commit: COMMIT,
        coverage: COVERAGE,
        knip: KNIP,
        lint: LINT,
        nightly: NIGHTLY,
        packs: [],
        tdd: false,
      },
      ok: true,
    });
  });

  it("accepts the standards pack", async () => {
    expect(await loadConfig(repo('export default { packs: ["standards"] }\n'))).toEqual({
      config: {
        agents: AGENTS,
        ci: CI,
        commit: COMMIT,
        coverage: COVERAGE,
        knip: KNIP,
        lint: LINT,
        nightly: NIGHTLY,
        packs: ["standards"],
        tdd: false,
      },
      ok: true,
    });
  });

  it("defaults the packs to agents, standards and docs, with or without workspaces in package.json", async () => {
    const expected = {
      config: {
        agents: AGENTS,
        ci: CI,
        commit: COMMIT,
        coverage: COVERAGE,
        knip: KNIP,
        lint: LINT,
        nightly: NIGHTLY,
        packs: ["agents", "standards", "docs"],
        tdd: false,
      },
      ok: true,
    };
    expect(await loadConfig(repo("export default {}\n"))).toEqual(expected);
    expect(await loadConfig(repo("export default {}\n", { name: "fixture", workspaces: ["packages/*"] }))).toEqual(
      expected,
    );
    expect(await loadConfig(repo("export default {}\n", null))).toEqual(expected);
  });

  it.each(["personal"])("rejects the removed pack %s", async (name) => {
    expect(await loadConfig(repo(`export default { packs: ["${name}"] }\n`))).toStrictEqual({
      errors: [
        `workerstack.config.ts: packs[0]: "${name}" is not a pack; use agents, standards, docs, release or workspace`,
      ],
      ok: false,
    });
  });

  it("accepts the workspace pack", async () => {
    expect(await loadConfig(repo('export default { packs: ["workspace"] }\n'))).toMatchObject({
      config: { packs: ["workspace"] },
      ok: true,
    });
  });

  it("accepts the release pack", async () => {
    expect(await loadConfig(repo('export default { packs: ["release"] }\n'))).toMatchObject({
      config: { packs: ["release"] },
      ok: true,
    });
  });

  it.each(['["docs"]', "[]"])("rejects agents without the agents pack (packs %s)", async (list) => {
    expect(await loadConfig(repo(`export default { packs: ${list}, agents: { skills: ["listen"] } }\n`))).toStrictEqual(
      {
        errors: [
          'workerstack.config.ts: agents: set only with the agents pack; add "agents" to packs or delete agents',
        ],
        ok: false,
      },
    );
  });

  it("reads the commit size limit under the standards pack, the default packs included", async () => {
    const limit = { commit: { maxChangedLines: 1500 } };
    expect(
      await loadConfig(repo('export default { packs: ["standards"], commit: { maxChangedLines: 1500 } }\n')),
    ).toMatchObject({ config: limit, ok: true });
    expect(await loadConfig(repo("export default { commit: { maxChangedLines: 1500 } }\n"))).toMatchObject({
      config: limit,
      ok: true,
    });
    expect(await loadConfig(repo('export default { packs: ["standards"], commit: {} }\n'))).toMatchObject({
      config: { commit: COMMIT },
      ok: true,
    });
  });

  it.each(['["docs"]', "[]"])("rejects commit without the standards pack (packs %s)", async (list) => {
    expect(
      await loadConfig(repo(`export default { packs: ${list}, commit: { maxChangedLines: 1500 } }\n`)),
    ).toStrictEqual({
      errors: [
        'workerstack.config.ts: commit: set only with the standards pack; add "standards" to packs or delete commit',
      ],
      ok: false,
    });
  });

  it.each(["0", "-5", "10.5", '"1500"'])("rejects a size limit of %s", async (value) => {
    expect(await loadConfig(repo(`export default { commit: { maxChangedLines: ${value} } }\n`))).toStrictEqual({
      errors: ["workerstack.config.ts: commit.maxChangedLines: must be a whole number of lines above 0"],
      ok: false,
    });
  });

  it("rejects an unknown key under commit, and a commit that is not an object", async () => {
    expect(await loadConfig(repo("export default { commit: { maxLines: 5 } }\n"))).toStrictEqual({
      errors: ['workerstack.config.ts: commit: unknown key "maxLines"'],
      ok: false,
    });
    expect(await loadConfig(repo("export default { commit: 5 }\n"))).toStrictEqual({
      errors: ["workerstack.config.ts: commit: must be an object like { maxChangedLines: 1000 }"],
      ok: false,
    });
  });

  it("rejects an unknown key", async () => {
    expect(await loadConfig(repo("export default { pakcs: [] }\n"))).toStrictEqual({
      errors: ['workerstack.config.ts: unknown key "pakcs"'],
      ok: false,
    });
  });

  it("rejects each unknown key alongside a valid one", async () => {
    expect(await loadConfig(repo('export default { packs: ["docs"], a: 1, b: 2 }\n'))).toStrictEqual({
      errors: ['workerstack.config.ts: unknown key "a"', 'workerstack.config.ts: unknown key "b"'],
      ok: false,
    });
  });

  it("rejects a name that is not a pack", async () => {
    expect(await loadConfig(repo('export default { packs: ["docs", "lint"] }\n'))).toStrictEqual({
      errors: [
        'workerstack.config.ts: packs[1]: "lint" is not a pack; use agents, standards, docs, release or workspace',
      ],
      ok: false,
    });
  });

  it("rejects a pack listed twice", async () => {
    expect(await loadConfig(repo('export default { packs: ["docs", "docs"] }\n'))).toStrictEqual({
      errors: ['workerstack.config.ts: packs: "docs" is listed twice'],
      ok: false,
    });
  });

  it("counts a pack listed more than twice", async () => {
    expect(await loadConfig(repo('export default { packs: ["docs", "agents", "docs", "docs"] }\n'))).toStrictEqual({
      errors: ['workerstack.config.ts: packs: "docs" is listed 3 times'],
      ok: false,
    });
  });

  it("rejects packs that are not a list", async () => {
    const result = await loadConfig(repo('export default { packs: "docs" }\n'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^workerstack\.config\.ts: packs: \S/);
  });

  it("rejects a default export that is not an object", async () => {
    const result = await loadConfig(repo('export default "docs"\n'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^workerstack\.config\.ts: .*default export/);
  });

  it("rejects a config with no default export", async () => {
    const result = await loadConfig(repo('export const packs = ["docs"]\n'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^workerstack\.config\.ts: .*no default export/);
  });

  it("says to install where the config imports @workerstack/repo and nothing provides it", async () => {
    // vitest resolves a bare import from its own root, so the import bun makes is run in bun itself.
    const root = repo('import { defineConfig } from "@workerstack/repo";\n\nexport default defineConfig({});\n');
    const script = `import { loadConfig } from ${JSON.stringify(path.join(REPO_ROOT, "cli/config.ts"))};
console.log(JSON.stringify(await loadConfig(${JSON.stringify(root)})));`;
    const run = spawnSync(process.execPath, ["--no-install", "-e", script], { cwd: root, encoding: "utf8" });
    const installHint = `workerstack.config.ts: @workerstack/repo is not installed in ${root}; run \`bun install\` there`;
    expect(JSON.parse(run.stdout)).toStrictEqual({ errors: [installHint], ok: false });
    const missing = () =>
      Promise.reject(new Error(`Cannot find package '@workerstack/repo' imported from ${root}/workerstack.config.ts`));
    expect(await loadConfig(root, missing)).toStrictEqual({ errors: [installHint], ok: false });
  });

  it("keeps the import's own message for any other package the config cannot find", async () => {
    const result = await loadConfig(repo('import x from "left-pad-nope";\n\nexport default x;\n'));
    expect(result).toMatchObject({
      errors: [expect.stringMatching(/^workerstack\.config\.ts: failed to load: .*left-pad-nope/)],
      ok: false,
    });
  });

  it("reports the message of an import that throws", async () => {
    const result = await loadConfig(repo('throw new Error("config exploded")\n'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^workerstack\.config\.ts: .*config exploded/);
  });

  it("reports a thrown value that is not an Error", async () => {
    const result = await loadConfig(repo('throw "config exploded"\n'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^workerstack\.config\.ts: .*config exploded/);
  });

  it("reads again a config whose text changed, and writes no copy for an unchanged one", async () => {
    const root = repo('export default { packs: ["agents"] }\n');
    const seen: string[] = [];
    const watcher = fs.watch(root, (_event, name) => seen.push(String(name)));
    try {
      expect(await loadConfig(root)).toMatchObject({ config: { packs: ["agents"] }, ok: true });
      expect(await loadConfig(root)).toMatchObject({ config: { packs: ["agents"] }, ok: true });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(seen.filter((name) => name.startsWith(".workerstack.config."))).toStrictEqual([]);

      fs.writeFileSync(path.join(root, CONFIG_FILE), 'export default { packs: ["docs"] }\n');
      expect(await loadConfig(root)).toMatchObject({ config: { packs: ["docs"] }, ok: true });
      expect(fs.readdirSync(root).sort()).toStrictEqual(["package.json", CONFIG_FILE]);
    } finally {
      watcher.close();
    }
  });

  it("reports a changed config that throws, leaving no copy behind", async () => {
    const root = repo('export default { packs: ["agents"] }\n');
    await loadConfig(root);
    fs.writeFileSync(path.join(root, CONFIG_FILE), 'throw new Error("config exploded")\n');
    expect(await loadConfig(root)).toMatchObject({ errors: [expect.stringMatching(/config exploded/)], ok: false });
    expect(fs.readdirSync(root).sort()).toStrictEqual(["package.json", CONFIG_FILE]);
  });
});

const SKIP = {
  files: ["src/cache.ts"],
  reason: "the parsed config cache lives for the process",
  rules: ["repo/no-module-state"],
};
const NO_REASON = "say why the rules are off, in three words or more";
/** A config with the agents and standards packs, or `packs`, and one `lint.skip` entry. */
const skipConfig = (skip: unknown, packs = '["agents", "standards"]') =>
  `export default { packs: ${packs}, lint: { skip: [${JSON.stringify(skip)}] } }\n`;
const refusal = (...errors: string[]) => ({ errors: errors.map((e) => `workerstack.config.ts: ${e}`), ok: false });

it("lint.skip: Usage's config resolves to its skip entries", async () => {
  const lint = `  lint: {\n    skip: [${JSON.stringify(SKIP)}],\n  },\n`;
  const usage = `export default defineConfig({\n  packs: ["agents", "standards"],\n${lint}});\n`;
  const root = repo(`import { defineConfig } from "@workerstack/repo";\n\n${usage}`);
  linkPackage(root);
  expect(await loadConfig(root)).toEqual({
    config: {
      agents: AGENTS,
      ci: CI,
      commit: COMMIT,
      coverage: COVERAGE,
      knip: KNIP,
      lint: { skip: [SKIP] },
      nightly: NIGHTLY,
      packs: ["agents", "standards"],
      tdd: false,
    },
    ok: true,
  });
});

it("lint.skip: defaults to no skips, with lint omitted or empty, the default packs included", async () => {
  const empty = { config: { ci: CI, coverage: COVERAGE, knip: KNIP, lint: LINT }, ok: true };
  expect(await loadConfig(repo('export default { packs: ["standards"], lint: {} }\n'))).toMatchObject(empty);
  expect(await loadConfig(repo('export default { packs: ["standards"] }\n'))).toMatchObject(empty);
  expect(await loadConfig(repo("export default { lint: { skip: [] } }\n"))).toMatchObject(empty);
});

it("lint.skip: refuses an entry without a reason, or with a reason under three words", async () => {
  const { reason: _, ...noReason } = SKIP;
  expect(await loadConfig(repo(skipConfig(noReason)))).toStrictEqual(refusal(`lint.skip[0].reason: ${NO_REASON}`));
  const short = skipConfig({ ...SKIP, reason: "cache state" });
  expect(await loadConfig(repo(short))).toStrictEqual(refusal(`lint.skip[0].reason: ${NO_REASON}`));
});

it("lint.skip: refuses an entry with no files or no rules", async () => {
  expect(await loadConfig(repo(skipConfig({ ...SKIP, files: [] })))).toStrictEqual(
    refusal("lint.skip[0].files: list at least one file glob"),
  );
  expect(await loadConfig(repo(skipConfig({ ...SKIP, rules: [] })))).toStrictEqual(
    refusal('lint.skip[0].rules: list at least one rule, like "repo/no-module-state"'),
  );
});

it("lint.skip: refuses an unknown key in an entry and under lint", async () => {
  expect(await loadConfig(repo(skipConfig({ ...SKIP, rule: "x" })))).toStrictEqual(
    refusal('lint.skip[0]: unknown key "rule"'),
  );
  const misspelt = 'export default { packs: ["standards"], lint: { skips: [] } }\n';
  expect(await loadConfig(repo(misspelt))).toStrictEqual(refusal('lint: unknown key "skips"'));
});

it.each(['["docs"]', "[]"])("lint.skip: refuses lint without the standards pack (packs %s)", async (list) => {
  expect(await loadConfig(repo(skipConfig(SKIP, list)))).toStrictEqual(
    refusal('lint: set only with the standards pack; add "standards" to packs or delete lint'),
  );
});

/** Usage's tag map: each package's one tag, and the tags each tag may import. */
const BOUNDARIES = {
  allow: { app: ["ui", "lib"], lib: [], ui: ["lib"] },
  tags: { "@app/lib": "lib", "@app/ui": "ui", "@app/web": "app" },
};

/** A standards config whose `lint.boundaries` is `boundaries`. */
function boundariesConfig(boundaries: unknown): string {
  return `export default { packs: ["standards"], lint: { boundaries: ${JSON.stringify(boundaries)} } }\n`;
}

it("lint.boundaries: Usage's tags and allow resolve as written, beside no skips", async () => {
  expect(await loadConfig(repo(boundariesConfig(BOUNDARIES)))).toMatchObject({
    config: { lint: { boundaries: BOUNDARIES, skip: [] } },
    ok: true,
  });
});

it.each([
  [{ ...BOUNDARIES, tags: { "@app/web": 7 } }, 'lint.boundaries.tags.@app/web: must be a tag name like "ui"'],
  [{ ...BOUNDARIES, tags: { "@app/web": "" } }, 'lint.boundaries.tags.@app/web: must be a tag name like "ui"'],
  [{ ...BOUNDARIES, allow: { lib: "ui" } }, "lint.boundaries.allow.lib: must be a list of tag names"],
  [["@app/web"], 'lint.boundaries: must be an object like { tags: { "@app/web": "app" }, allow: { app: [] } }'],
  [{ ...BOUNDARIES, layers: {} }, 'lint.boundaries: unknown key "layers"'],
])("lint.boundaries: refuses %j", async (boundaries, error) => {
  expect(await loadConfig(repo(boundariesConfig(boundaries)))).toStrictEqual(refusal(error));
});

describe("agents", () => {
  const agentsOf = async (source: string) => {
    const result = await loadConfig(repo(source));
    return result.ok ? result.config.agents : result.errors;
  };

  it("lists the hosts and skill packs", () => {
    expect(HOSTS).toStrictEqual(["claude", "codex", "antigravity", "grok", "cursor"]);
    expect(SKILL_PACKS).toStrictEqual(["google-workspace", "listen", "speak", "clasp"]);
  });

  it("parses agents.hosts and agents.skills", async () => {
    expect(
      await agentsOf(
        'export default { packs: ["agents"], agents: { hosts: ["codex", "claude"], skills: ["listen", "clasp"] } }\n',
      ),
    ).toStrictEqual({
      hosts: ["codex", "claude"],
      skills: ["listen", "clasp"],
    });
  });

  it("defaults hosts to all five and skills to none when only one is given", async () => {
    expect(await agentsOf('export default { packs: ["agents"], agents: { skills: ["speak"] } }\n')).toStrictEqual({
      hosts: [...HOSTS],
      skills: ["speak"],
    });
    expect(await agentsOf('export default { packs: ["agents"], agents: { hosts: ["grok"] } }\n')).toStrictEqual({
      hosts: ["grok"],
      skills: [],
    });
  });

  it("resolves a missing agents to every host and no skills", async () => {
    expect(await agentsOf("export default { packs: [] }\n")).toStrictEqual(AGENTS);
    expect(await agentsOf('export default { packs: ["agents"] }\n')).toStrictEqual(AGENTS);
  });

  it("rejects an unknown host", async () => {
    expect(await agentsOf('export default { packs: ["agents"], agents: { hosts: ["clod"] } }\n')).toStrictEqual([
      'workerstack.config.ts: agents.hosts[0]: "clod" is not a host; use claude, codex, antigravity, grok or cursor',
    ]);
  });

  it("rejects an unknown skill", async () => {
    expect(
      await agentsOf('export default { packs: ["agents"], agents: { skills: ["listen", "nope"] } }\n'),
    ).toStrictEqual([
      'workerstack.config.ts: agents.skills[1]: "nope" is not a skill pack; use google-workspace, listen, speak or clasp',
    ]);
  });

  it("rejects a duplicate host and a duplicate skill", async () => {
    expect(
      await agentsOf(
        'export default { packs: ["agents"], agents: { hosts: ["claude", "claude"], skills: ["listen", "listen"] } }\n',
      ),
    ).toStrictEqual([
      'workerstack.config.ts: agents.hosts: "claude" is listed twice',
      'workerstack.config.ts: agents.skills: "listen" is listed twice',
    ]);
  });

  it("rejects an empty hosts list", async () => {
    expect(await agentsOf('export default { packs: ["agents"], agents: { hosts: [] } }\n')).toStrictEqual([
      "workerstack.config.ts: agents.hosts: list at least one host",
    ]);
  });

  it("rejects an unknown key inside agents", async () => {
    expect(await agentsOf('export default { packs: ["agents"], agents: { host: [] } }\n')).toStrictEqual([
      'workerstack.config.ts: agents: unknown key "host"',
    ]);
  });
});

describe("findRoot", () => {
  it("returns the directory that holds the config when started there", () => {
    const root = repo("export default {}\n");
    expect(findRoot(root)).toBe(root);
  });

  it("walks up to the nearest ancestor that holds the config", () => {
    const outer = repo("export default {}\n");
    const inner = path.join(outer, "apps", "web");
    fs.mkdirSync(path.join(inner, "src"), { recursive: true });
    fs.writeFileSync(path.join(inner, CONFIG_FILE), "export default {}\n");
    expect(findRoot(path.join(inner, "src"))).toBe(inner);
    expect(findRoot(path.join(outer, "apps"))).toBe(outer);
  });

  it("returns null when no ancestor holds the config, whatever CLAUDE_PROJECT_DIR says", () => {
    const elsewhere = repo("export default {}\n");
    vi.stubEnv("CLAUDE_PROJECT_DIR", elsewhere);
    const empty = path.join(tempDir(), "a", "b");
    fs.mkdirSync(empty, { recursive: true });
    expect(findRoot(empty)).toBeNull();
  });
});

describe("defineConfig", () => {
  it("returns its argument", () => {
    const config = { packs: ["docs", "agents"] as const };
    expect(defineConfig(config)).toBe(config);
  });

  it("rejects an unknown pack or key at compile time", () => {
    // @ts-expect-error "lint" is not a pack
    expect(defineConfig({ packs: ["lint"] })).toStrictEqual({ packs: ["lint"] });
    // @ts-expect-error "pakcs" is not a key
    expect(defineConfig({ pakcs: [] })).toStrictEqual({ pakcs: [] });
  });
});

describe("defaultPacks", () => {
  it("is agents, standards and docs", () => {
    expect(defaultPacks()).toStrictEqual(["agents", "standards", "docs"]);
  });
});

describe("coverage", () => {
  it("defaults the floors and known-failures files, with coverage omitted or empty", async () => {
    const expected = { config: { coverage: COVERAGE }, ok: true };
    expect(await loadConfig(repo("export default {}\n"))).toMatchObject(expected);
    expect(await loadConfig(repo("export default { coverage: {} }\n"))).toMatchObject(expected);
  });

  it("takes each path as given and defaults the other", async () => {
    const floors = await loadConfig(repo('export default { coverage: { floors: "ratchets/floors.json" } }\n'));
    expect(floors).toMatchObject({ config: { coverage: { ...COVERAGE, floors: "ratchets/floors.json" } }, ok: true });
    const failures = await loadConfig(repo('export default { coverage: { knownFailures: "ratchets/kf.json" } }\n'));
    expect(failures).toMatchObject({
      config: { coverage: { ...COVERAGE, knownFailures: "ratchets/kf.json" } },
      ok: true,
    });
  });

  it("refuses an unknown key and a path that is not text", async () => {
    expect(await loadConfig(repo("export default { coverage: { floor: 'a.json' } }\n"))).toStrictEqual({
      errors: ['workerstack.config.ts: coverage: unknown key "floor"'],
      ok: false,
    });
    expect(await loadConfig(repo("export default { coverage: { floors: 5 } }\n"))).toStrictEqual({
      errors: ["workerstack.config.ts: coverage.floors: must be a file path like coverage-floors.json"],
      ok: false,
    });
  });
});

describe("coverage, mutation", () => {
  it("takes the globs to mutate and the mutation floors path as given", async () => {
    const source = 'export default { coverage: { mutate: ["cli/**/*.ts", "lib/*.ts"], mutationFloors: "m/f.json" } }\n';
    expect(await loadConfig(repo(source))).toMatchObject({
      config: { coverage: { ...COVERAGE, mutate: ["cli/**/*.ts", "lib/*.ts"], mutationFloors: "m/f.json" } },
      ok: true,
    });
  });

  it("refuses an empty glob list, a glob that is not text and a floors path that is not text", async () => {
    const errors = async (body: string) => {
      const loaded = await loadConfig(repo(`export default { coverage: { ${body} } }\n`));
      return loaded.ok ? [] : loaded.errors;
    };
    expect(await errors("mutate: []")).toStrictEqual([
      'workerstack.config.ts: coverage.mutate: must be a non-empty list of globs like ["src/**/*.ts"]',
    ]);
    expect(await errors("mutate: [5]")).toStrictEqual([
      'workerstack.config.ts: coverage.mutate[0]: must be a non-empty list of globs like ["src/**/*.ts"]',
    ]);
    expect(await errors("mutationFloors: 5")).toStrictEqual([
      "workerstack.config.ts: coverage.mutationFloors: must be a file path like coverage-floors.json",
    ]);
  });
});

describe("enabledSkills", () => {
  it("lists agents.skills of the repo at or above cwd", async () => {
    const root = repo('export default { packs: ["agents"], agents: { skills: ["speak", "clasp"] } }\n');
    fs.mkdirSync(path.join(root, "sub"));
    expect(await enabledSkills(path.join(root, "sub"))).toStrictEqual(["speak", "clasp"]);
  });

  it("is empty with no config above cwd", async () => {
    expect(await enabledSkills(tempDir())).toStrictEqual([]);
  });

  it("is empty when the config is invalid", async () => {
    const root = repo('export default { packs: ["agents"], agents: { skills: ["nope"] } }\n');
    expect(await enabledSkills(root)).toStrictEqual([]);
  });
});

describe("owner", () => {
  it("resolves to the name and github login, and is left out when omitted", async () => {
    const owner = { github: "lovrozagar", name: "Lovro Žagar" };
    const given = await loadConfig(repo(`export default { owner: ${JSON.stringify(owner)} }\n`));
    expect(given).toMatchObject({ config: { owner }, ok: true });
    const omitted = await loadConfig(repo("export default {}\n"));
    expect(omitted.ok && omitted.config.owner).toBeUndefined();
  });

  it("refuses an owner without a github login, and an unknown key", async () => {
    expect(await loadConfig(repo('export default { owner: { name: "A" } }\n'))).toStrictEqual(
      refusal("owner.github: must be a GitHub login like lovrozagar"),
    );
    const extra = 'export default { owner: { name: "A", github: "a", email: "x" } }\n';
    expect(await loadConfig(repo(extra))).toStrictEqual(refusal('owner: unknown key "email"'));
    expect(await loadConfig(repo('export default { owner: { name: "", github: "a" } }\n'))).toStrictEqual(
      refusal("owner.name: must be the owner's name, like Lovro Žagar"),
    );
  });
});

const DEPLOY = { cache: false, dependsOn: ["^build"] };
const tasks = (body: string) => `export default { packs: ["workspace"], turbo: { tasks: ${body} } }\n`;

it("turbo.tasks: parses tasks under the workspace pack", async () => {
  const loaded = await loadConfig(repo(tasks(JSON.stringify({ deploy: DEPLOY }))));
  expect(loaded).toMatchObject({ config: { turbo: { tasks: { deploy: DEPLOY } } }, ok: true });
});

it("turbo.tasks: resolves an empty turbo section to no tasks, and an omitted one to none", async () => {
  const empty = await loadConfig(repo('export default { packs: ["workspace"], turbo: {} }\n'));
  expect(empty).toMatchObject({ config: { turbo: { tasks: {} } }, ok: true });
  const omitted = await loadConfig(repo('export default { packs: ["workspace"] }\n'));
  expect(omitted).toMatchObject({ config: { turbo: undefined }, ok: true });
});

it.each(["typecheck", "test"])("turbo.tasks: refuses a task named %s", async (name) => {
  const loaded = await loadConfig(repo(tasks(JSON.stringify({ [name]: {} }))));
  expect(loaded).toStrictEqual(refusal(`turbo.tasks "${name}" is generated; pick another name`));
});

it("turbo.tasks: names every generated task it finds", async () => {
  const loaded = await loadConfig(repo(tasks("{ typecheck: {}, test: {}, ok: {} }")));
  expect(loaded).toStrictEqual(
    refusal(
      'turbo.tasks "typecheck" is generated; pick another name',
      'turbo.tasks "test" is generated; pick another name',
    ),
  );
});

it("turbo.tasks: refuses turbo without the workspace pack", async () => {
  const loaded = await loadConfig(repo('export default { packs: ["docs"], turbo: {} }\n'));
  expect(loaded).toStrictEqual(
    refusal('turbo: set only with the workspace pack; add "workspace" to packs or delete turbo'),
  );
});

it("turbo.tasks: refuses an unknown task key, a bad flag, a bad list and a turbo that is not an object", async () => {
  expect(await loadConfig(repo(tasks("{ a: { nope: 1 } }")))).toMatchObject({ ok: false });
  expect(await loadConfig(repo(tasks("{ a: { cache: 1 } }")))).toMatchObject({ ok: false });
  expect(await loadConfig(repo(tasks("{ a: { env: [1] } }")))).toMatchObject({ ok: false });
  expect(await loadConfig(repo(tasks("{ a: 1 }")))).toMatchObject({ ok: false });
  expect(await loadConfig(repo('export default { packs: ["workspace"], turbo: 1 }\n'))).toMatchObject({ ok: false });
  expect(await loadConfig(repo(tasks("1")))).toMatchObject({ ok: false });
});

it("link: parses a package-to-checkout map, and leaves it out when omitted", async () => {
  const map = { "@workerstack/flare": "../flare-wt" };
  const loaded = await loadConfig(repo(`export default { link: ${JSON.stringify(map)} }\n`));
  expect(loaded).toMatchObject({ config: { link: map }, ok: true });
  const omitted = await loadConfig(repo("export default {}\n"));
  expect(omitted).toMatchObject({ config: { link: undefined }, ok: true });
});

it("link: refuses a value that is not a path", async () => {
  const loaded = await loadConfig(repo('export default { link: { "@workerstack/flare": 1 } }\n'));
  expect(loaded).toStrictEqual(
    refusal("link.@workerstack/flare: must be a path like ../flare, relative to the repo root"),
  );
  expect(await loadConfig(repo("export default { link: [] }\n"))).toStrictEqual(
    refusal('link: must be an object like { "@workerstack/flare": "../flare" }'),
  );
});

it("clean: parses the extra build dir names, and leaves the section out when omitted", async () => {
  const loaded = await loadConfig(repo('export default { clean: { build: [".flare"] } }\n'));
  expect(loaded).toMatchObject({ config: { clean: { build: [".flare"] } }, ok: true });
  expect(await loadConfig(repo("export default { clean: {} }\n"))).toMatchObject({ config: { clean: {} }, ok: true });
  expect(await loadConfig(repo("export default {}\n"))).toMatchObject({ config: { clean: undefined }, ok: true });
});

it("clean: refuses a name that is a path, a list that is not names, and a section that is not an object", async () => {
  const name = 'clean.build[0]: must be a dir name like ".flare", not a path';
  expect(await loadConfig(repo('export default { clean: { build: ["a/b"] } }\n'))).toStrictEqual(refusal(name));
  expect(await loadConfig(repo("export default { clean: { build: 1 } }\n"))).toStrictEqual(
    refusal('clean.build: must be a list of dir names like [".flare"]'),
  );
  expect(await loadConfig(repo("export default { clean: [] }\n"))).toStrictEqual(
    refusal('clean: must be an object like { build: [".flare"] }'),
  );
});

it("ci.checks: parses named argv arrays, and defaults to none", async () => {
  const checks = { "product-tree": ["bun", "scripts/check/product-tree.ts"] };
  const loaded = await loadConfig(repo(`export default { ci: { checks: ${JSON.stringify(checks)} } }\n`));
  expect(loaded).toMatchObject({ config: { ci: { checks } }, ok: true });
  expect(await loadConfig(repo("export default {}\n"))).toMatchObject({ config: { ci: { checks: {} } }, ok: true });
  expect(await loadConfig(repo("export default { ci: {} }\n"))).toMatchObject({
    config: { ci: { checks: {} } },
    ok: true,
  });
});

it("ci.checks: refuses an empty argv, a built-in label and an unknown key, each naming the fix", async () => {
  expect(await loadConfig(repo("export default { ci: { checks: { a: [] } } }\n"))).toStrictEqual(
    refusal('ci.checks.a: must be a non-empty list of strings like ["bun", "scripts/check.ts"]'),
  );
  expect(await loadConfig(repo('export default { ci: { checks: { fmt: ["x"] } } }\n'))).toStrictEqual(
    refusal('ci.checks: "fmt" is a built-in gate label; pick another name'),
  );
  expect(await loadConfig(repo("export default { ci: { nope: 1 } }\n"))).toStrictEqual(
    refusal('ci: unknown key "nope"'),
  );
});
