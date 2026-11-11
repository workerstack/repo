import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { grokConfigPath } from "./purge-paths.ts";
import { plant, plantHomes, readGrok, seedHome } from "./fixtures/purge-kit.ts";
import { bunPath } from "../../dev/test-paths";
import { childEnv } from "../env.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const repoCli = path.join(here, "..", "..", "bin", "repo.ts");
const tmpDir = plantHomes();

/** `repo purge-mcps` with `args`, run from `cwd` under `env`. */
function purgeCli(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return spawnSync(bunPath(), [repoCli, "purge-mcps", ...args], { encoding: "utf8", cwd, timeout: 20_000, env });
}

it("purgeGlobalMcps does not touch a fixture project .grok/config.toml", () => {
  const home = tmpDir("purge-mcp-home-");
  const ws = tmpDir("purge-mcp-ws-");
  seedHome(home);
  const projectBody = `[plugins]\nenabled = ["cloudflare"]\n`;
  const projectCfg = plant(ws, ".grok/config.toml", projectBody);
  const r = purgeCli(["--apply"], ws, childEnv({ HOME: home }));
  expect(r.status).toBe(0);
  expect(fs.readFileSync(projectCfg, "utf8")).toBe(projectBody);
  expect(readGrok(grokConfigPath(home)).plugins?.enabled ?? []).not.toContain("cloudflare");
});

it("CLI bad args exit 1", () => {
  const r = purgeCli(["--nope"], repoRoot, childEnv({ HOME: tmpDir("purge-mcp-cli-bad-") }));
  expect(r.status).toBe(1);
});

it("CLI smoke: dry-run with fake HOME", () => {
  const home = tmpDir("purge-mcp-cli-");
  seedHome(home);
  const grokBefore = fs.readFileSync(grokConfigPath(home), "utf8");
  const r = purgeCli([], repoRoot, childEnv({ HOME: home }));
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/dry-run/);
  expect(fs.readFileSync(grokConfigPath(home), "utf8")).toBe(grokBefore);
});

it("CLI: USERPROFILE without HOME (Windows env sim)", () => {
  const home = tmpDir("purge-mcp-userprofile-");
  seedHome(home);
  const grokBefore = fs.readFileSync(grokConfigPath(home), "utf8");
  const env: NodeJS.ProcessEnv = childEnv({ USERPROFILE: home });
  delete env.HOME;
  const r = purgeCli([], repoRoot, env);
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/dry-run/);
  expect(r.stdout).toContain(grokConfigPath(home));
  expect(fs.readFileSync(grokConfigPath(home), "utf8")).toBe(grokBefore);
});
