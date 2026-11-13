import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT, repo, useConfigKit } from "./__fixtures__/config-kit.ts";
import { CONFIG_FILE } from "./config.constants.ts";
import { loadConfig } from "./config.ts";

useConfigKit();

const EXPLODED = /^repo\.config\.ts: .*config exploded/;

/** The errors of loading the config `source`, which must be refused. */
async function refusedErrors(source: string): Promise<readonly string[]> {
  const result = await loadConfig(repo(source));
  expect(result.ok).toBe(false);

  return result.ok ? [] : result.errors;
}

describe("loadConfig", () => {
  it("rejects a default export that is not an object", async () => {
    const result = await loadConfig(repo('export default "docs"\n'));
    expect(result.ok).toBe(false);

    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^repo\.config\.ts: .*default export/);
  });

  it("rejects a config with no default export", async () => {
    const result = await loadConfig(repo('export const packs = ["docs"]\n'));
    expect(result.ok).toBe(false);

    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^repo\.config\.ts: .*no default export/);
  });
});

describe("loadConfig", () => {
  it("says to install where the config imports @workerstack/repo and nothing provides it", async () => {
    // vitest resolves a bare import from its own root, so the import bun makes is run in bun itself.
    const root = repo('import { defineConfig } from "@workerstack/repo";\n\nexport default defineConfig({});\n');

    const script = `import { loadConfig } from ${JSON.stringify(path.join(REPO_ROOT, "cli/config.ts"))};
console.log(JSON.stringify(await loadConfig(${JSON.stringify(root)})));`;

    const run = spawnSync(process.execPath, ["--no-install", "-e", script], { cwd: root, encoding: "utf8" });

    const installHint = [
      `repo.config.ts: @workerstack/repo is not installed in ${root};`,
      "run `bun install` there",
    ].join(" ");

    expect(JSON.parse(run.stdout)).toStrictEqual({ errors: [installHint], ok: false });

    function missing() {
      return Promise.reject(new Error(`Cannot find package '@workerstack/repo' imported from ${root}/repo.config.ts`));
    }

    expect(await loadConfig(root, missing)).toStrictEqual({ errors: [installHint], ok: false });
  });
});

describe("loadConfig", () => {
  it("keeps the import's own message for any other package the config cannot find", async () => {
    const result = await loadConfig(repo('import x from "left-pad-nope";\n\nexport default x;\n'));
    expect(result).toMatchObject({
      errors: [expect.stringMatching(/^repo\.config\.ts: failed to load: .*left-pad-nope/)],
      ok: false,
    });
  });

  it("reports the message of an import that throws", async () => {
    const errors = await refusedErrors('throw new Error("config exploded")\n');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(EXPLODED);
  });

  it("reports a thrown value that is not an Error", async () => {
    const errors = await refusedErrors('throw "config exploded"\n');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(EXPLODED);
  });
});

describe("loadConfig", () => {
  it("reads again a config whose text changed, and writes no copy for an unchanged one", async () => {
    const root = repo('export default { packs: ["agents"] }\n');
    const seen: string[] = [];
    const watcher = fs.watch(root, (_event, name) => seen.push(String(name)));

    try {
      expect(await loadConfig(root)).toMatchObject({ config: { packs: ["agents"] }, ok: true });
      expect(await loadConfig(root)).toMatchObject({ config: { packs: ["agents"] }, ok: true });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(seen.filter((name) => name.startsWith(".repo.config."))).toStrictEqual([]);

      fs.writeFileSync(path.join(root, CONFIG_FILE), 'export default { packs: ["docs"] }\n');
      expect(await loadConfig(root)).toMatchObject({ config: { packs: ["docs"] }, ok: true });
      expect(fs.readdirSync(root).toSorted()).toStrictEqual(["package.json", CONFIG_FILE]);
    } finally {
      watcher.close();
    }
  });

  it("reports a changed config that throws, leaving no copy behind", async () => {
    const root = repo('export default { packs: ["agents"] }\n');
    await loadConfig(root);
    fs.writeFileSync(path.join(root, CONFIG_FILE), 'throw new Error("config exploded")\n');
    expect(await loadConfig(root)).toMatchObject({ errors: [expect.stringMatching(/config exploded/)], ok: false });
    expect(fs.readdirSync(root).toSorted()).toStrictEqual(["package.json", CONFIG_FILE]);
  });
});
