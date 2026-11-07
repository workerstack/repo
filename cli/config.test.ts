import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG_FILE, defaultPacks, defineConfig, findRoot, loadConfig } from "./config.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temps: string[] = [];

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
      'import { defineConfig } from "@workerstack/repo"\n\nexport default defineConfig({\n  packs: ["docs", "release"],\n})\n',
    );
    linkPackage(root);
    expect(await loadConfig(root)).toEqual({ ok: true, config: { packs: ["docs", "release"] } });
  });

  it("keeps an empty pack list as declared", async () => {
    expect(await loadConfig(repo("export default { packs: [] }\n"))).toEqual({ ok: true, config: { packs: [] } });
  });

  it("defaults the packs for a single-package repo", async () => {
    expect(await loadConfig(repo("export default {}\n"))).toEqual({
      ok: true,
      config: { packs: ["agents", "standards", "docs", "release"] },
    });
  });

  it("defaults the packs with workspace when package.json has workspaces", async () => {
    const root = repo("export default {}\n", { name: "fixture", workspaces: ["packages/*"] });
    expect(await loadConfig(root)).toEqual({
      ok: true,
      config: { packs: ["agents", "standards", "docs", "release", "workspace"] },
    });
  });

  it("defaults the packs without workspace when there is no package.json", async () => {
    expect(await loadConfig(repo("export default {}\n", null))).toEqual({
      ok: true,
      config: { packs: ["agents", "standards", "docs", "release"] },
    });
  });

  it.each([
    ["is not JSON", "{ nope"],
    ["is not an object", "[]"],
  ])("names package.json when defaults need it and it %s", async (_, manifest) => {
    const result = await loadConfig(repo("export default {}\n", manifest));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^package\.json: \S/);
  });

  it("reads no package.json when the config declares its packs", async () => {
    expect(await loadConfig(repo('export default { packs: ["docs"] }\n', "{ nope"))).toEqual({
      ok: true,
      config: { packs: ["docs"] },
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
      errors: [
        'workerstack.config.ts: packs[1]: "lint" is not a pack; use agents, standards, docs, release, workspace or personal',
      ],
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
    const config = { packs: ["docs", "release"] as const };
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
  it("is agents, standards, docs and release for a single-package repo", () => {
    expect(defaultPacks(false)).toEqual(["agents", "standards", "docs", "release"]);
  });

  it("adds workspace for a repo with workspaces", () => {
    expect(defaultPacks(true)).toEqual(["agents", "standards", "docs", "release", "workspace"]);
  });
});
