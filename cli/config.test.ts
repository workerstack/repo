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

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
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
    expect(await loadConfig(root)).toEqual({ ok: true, config: { packs: ["docs", "agents"], agents: AGENTS } });
  });

  it("keeps an empty pack list as declared", async () => {
    expect(await loadConfig(repo("export default { packs: [] }\n"))).toEqual({
      ok: true,
      config: { packs: [], agents: AGENTS },
    });
  });

  it("accepts the standards pack", async () => {
    expect(await loadConfig(repo('export default { packs: ["standards"] }\n'))).toEqual({
      ok: true,
      config: { packs: ["standards"], agents: AGENTS },
    });
  });

  it("defaults the packs to agents, standards and docs, with or without workspaces in package.json", async () => {
    const expected = { ok: true, config: { packs: ["agents", "standards", "docs"], agents: AGENTS } };
    expect(await loadConfig(repo("export default {}\n"))).toEqual(expected);
    expect(await loadConfig(repo("export default {}\n", { name: "fixture", workspaces: ["packages/*"] }))).toEqual(
      expected,
    );
    expect(await loadConfig(repo("export default {}\n", null))).toEqual(expected);
  });

  it.each(["release", "workspace", "personal"])("rejects the removed pack %s", async (name) => {
    expect(await loadConfig(repo(`export default { packs: ["${name}"] }\n`))).toEqual({
      ok: false,
      errors: [`workerstack.config.ts: packs[0]: "${name}" is not a pack; use agents, standards or docs`],
    });
  });

  it.each(['["docs"]', "[]"])("rejects agents without the agents pack (packs %s)", async (list) => {
    expect(await loadConfig(repo(`export default { packs: ${list}, agents: { skills: ["listen"] } }\n`))).toEqual({
      ok: false,
      errors: ['workerstack.config.ts: agents: set only with the agents pack; add "agents" to packs or delete agents'],
    });
  });

  it("rejects an unknown key", async () => {
    expect(await loadConfig(repo("export default { pakcs: [] }\n"))).toEqual({
      ok: false,
      errors: ['workerstack.config.ts: unknown key "pakcs"'],
    });
  });

  it("rejects each unknown key alongside a valid one", async () => {
    expect(await loadConfig(repo('export default { packs: ["docs"], a: 1, b: 2 }\n'))).toEqual({
      ok: false,
      errors: ['workerstack.config.ts: unknown key "a"', 'workerstack.config.ts: unknown key "b"'],
    });
  });

  it("rejects a name that is not a pack", async () => {
    expect(await loadConfig(repo('export default { packs: ["docs", "lint"] }\n'))).toEqual({
      ok: false,
      errors: ['workerstack.config.ts: packs[1]: "lint" is not a pack; use agents, standards or docs'],
    });
  });

  it("rejects a pack listed twice", async () => {
    expect(await loadConfig(repo('export default { packs: ["docs", "docs"] }\n'))).toEqual({
      ok: false,
      errors: ['workerstack.config.ts: packs: "docs" is listed twice'],
    });
  });

  it("counts a pack listed more than twice", async () => {
    expect(await loadConfig(repo('export default { packs: ["docs", "agents", "docs", "docs"] }\n'))).toEqual({
      ok: false,
      errors: ['workerstack.config.ts: packs: "docs" is listed 3 times'],
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
      expect(await loadConfig(root)).toMatchObject({ ok: true, config: { packs: ["agents"] } });
      expect(await loadConfig(root)).toMatchObject({ ok: true, config: { packs: ["agents"] } });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(seen.filter((name) => name.startsWith(".workerstack.config."))).toEqual([]);

      fs.writeFileSync(path.join(root, CONFIG_FILE), 'export default { packs: ["docs"] }\n');
      expect(await loadConfig(root)).toMatchObject({ ok: true, config: { packs: ["docs"] } });
      expect(fs.readdirSync(root).sort()).toEqual(["package.json", CONFIG_FILE]);
    } finally {
      watcher.close();
    }
  });

  it("reports a changed config that throws, leaving no copy behind", async () => {
    const root = repo('export default { packs: ["agents"] }\n');
    await loadConfig(root);
    fs.writeFileSync(path.join(root, CONFIG_FILE), 'throw new Error("config exploded")\n');
    expect(await loadConfig(root)).toMatchObject({ ok: false, errors: [expect.stringMatching(/config exploded/)] });
    expect(fs.readdirSync(root).sort()).toEqual(["package.json", CONFIG_FILE]);
  });
});

describe("agents", () => {
  const agentsOf = async (source: string) => {
    const result = await loadConfig(repo(source));
    return result.ok ? result.config.agents : result.errors;
  };

  it("lists the hosts and skill packs", () => {
    expect(HOSTS).toEqual(["claude", "codex", "antigravity", "grok", "cursor"]);
    expect(SKILL_PACKS).toEqual(["google-workspace", "listen", "speak", "clasp"]);
  });

  it("parses agents.hosts and agents.skills", async () => {
    expect(
      await agentsOf(
        'export default { packs: ["agents"], agents: { hosts: ["codex", "claude"], skills: ["listen", "clasp"] } }\n',
      ),
    ).toEqual({
      hosts: ["codex", "claude"],
      skills: ["listen", "clasp"],
    });
  });

  it("defaults hosts to all five and skills to none when only one is given", async () => {
    expect(await agentsOf('export default { packs: ["agents"], agents: { skills: ["speak"] } }\n')).toEqual({
      hosts: [...HOSTS],
      skills: ["speak"],
    });
    expect(await agentsOf('export default { packs: ["agents"], agents: { hosts: ["grok"] } }\n')).toEqual({
      hosts: ["grok"],
      skills: [],
    });
  });

  it("resolves a missing agents to every host and no skills", async () => {
    expect(await agentsOf("export default { packs: [] }\n")).toEqual(AGENTS);
    expect(await agentsOf('export default { packs: ["agents"] }\n')).toEqual(AGENTS);
  });

  it("rejects an unknown host", async () => {
    expect(await agentsOf('export default { packs: ["agents"], agents: { hosts: ["clod"] } }\n')).toEqual([
      'workerstack.config.ts: agents.hosts[0]: "clod" is not a host; use claude, codex, antigravity, grok or cursor',
    ]);
  });

  it("rejects an unknown skill", async () => {
    expect(await agentsOf('export default { packs: ["agents"], agents: { skills: ["listen", "nope"] } }\n')).toEqual([
      'workerstack.config.ts: agents.skills[1]: "nope" is not a skill pack; use google-workspace, listen, speak or clasp',
    ]);
  });

  it("rejects a duplicate host and a duplicate skill", async () => {
    expect(
      await agentsOf(
        'export default { packs: ["agents"], agents: { hosts: ["claude", "claude"], skills: ["listen", "listen"] } }\n',
      ),
    ).toEqual([
      'workerstack.config.ts: agents.hosts: "claude" is listed twice',
      'workerstack.config.ts: agents.skills: "listen" is listed twice',
    ]);
  });

  it("rejects an empty hosts list", async () => {
    expect(await agentsOf('export default { packs: ["agents"], agents: { hosts: [] } }\n')).toEqual([
      "workerstack.config.ts: agents.hosts: list at least one host",
    ]);
  });

  it("rejects an unknown key inside agents", async () => {
    expect(await agentsOf('export default { packs: ["agents"], agents: { host: [] } }\n')).toEqual([
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
    expect(defineConfig({ packs: ["lint"] })).toEqual({ packs: ["lint"] });
    // @ts-expect-error "pakcs" is not a key
    expect(defineConfig({ pakcs: [] })).toEqual({ pakcs: [] });
  });
});

describe("defaultPacks", () => {
  it("is agents, standards and docs", () => {
    expect(defaultPacks()).toEqual(["agents", "standards", "docs"]);
  });
});

describe("enabledSkills", () => {
  it("lists agents.skills of the repo at or above cwd", async () => {
    const root = repo('export default { packs: ["agents"], agents: { skills: ["speak", "clasp"] } }\n');
    fs.mkdirSync(path.join(root, "sub"));
    expect(await enabledSkills(path.join(root, "sub"))).toEqual(["speak", "clasp"]);
  });

  it("is empty with no config above cwd", async () => {
    expect(await enabledSkills(tempDir())).toEqual([]);
  });

  it("is empty when the config is invalid", async () => {
    const root = repo('export default { packs: ["agents"], agents: { skills: ["nope"] } }\n');
    expect(await enabledSkills(root)).toEqual([]);
  });
});
