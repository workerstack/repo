import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { CONFIG_FILE } from "./config.constants.ts";
import { defaultPacks, defineConfig, enabledSkills, findRoot } from "./config.ts";
import { configDir, repo, useConfigKit } from "./fixtures/config-kit.ts";

useConfigKit();

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
    const empty = path.join(configDir(), "a", "b");
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

describe("enabledSkills", () => {
  it("lists agents.skills of the repo at or above cwd", async () => {
    const root = repo('export default { packs: ["agents"], agents: { skills: ["speak", "clasp"] } }\n');
    fs.mkdirSync(path.join(root, "sub"));
    expect(await enabledSkills(path.join(root, "sub"))).toStrictEqual(["speak", "clasp"]);
  });

  it("is empty with no config above cwd", async () => {
    expect(await enabledSkills(configDir())).toStrictEqual([]);
  });

  it("is empty when the config is invalid", async () => {
    const root = repo('export default { packs: ["agents"], agents: { skills: ["nope"] } }\n');
    expect(await enabledSkills(root)).toStrictEqual([]);
  });
});
