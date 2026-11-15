import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AGENTS, linkPackage, repo, useConfigKit } from "./__fixtures__/config-kit.ts";
import { LOCAL_CONFIG_FILE } from "./config.constants.ts";
import { loadConfig } from "./config.ts";

useConfigKit();

/** A committed config that sets approval and effort, as a team would. */
const COMMITTED = 'export default { agents: { defaultApproval: "away", defaultEffort: "fast" } }\n';

/** The agents of loading `committed` with the local file `local`, or the errors. */
async function agentsOf(committed: string, local?: string) {
  const result = await loadConfig(repo(committed, { name: "fixture" }, local));

  return result.ok ? result.config.agents : result.errors;
}

describe("repo.config.local.ts", () => {
  it("keeps the committed values when there is no local file", async () => {
    expect(await agentsOf(COMMITTED)).toStrictEqual({ ...AGENTS, defaultApproval: "away", defaultEffort: "fast" });
  });

  it("beats the committed value of each key it sets", async () => {
    const local = 'export default { agents: { defaultApproval: "ask", defaultStrategy: "spawn-fast" } }\n';

    expect(await agentsOf(COMMITTED, local)).toStrictEqual({
      ...AGENTS,
      defaultApproval: "ask",
      defaultEffort: "fast",
      defaultStrategy: "spawn-fast",
    });
  });

  it("falls to the committed value, then the package default, for a key it omits", async () => {
    expect(await agentsOf("export default {}\n", "export default {}\n")).toStrictEqual(AGENTS);
    expect(await agentsOf(COMMITTED, "export default { agents: {} }\n")).toStrictEqual({
      ...AGENTS,
      defaultApproval: "away",
      defaultEffort: "fast",
    });
  });
});

describe("repo.config.local.ts edits", () => {
  it("reads again a local file edited between two loads", async () => {
    const root = repo(
      "export default {}\n",
      { name: "fixture" },
      'export default { agents: { defaultEffort: "fast" } }\n',
    );

    expect(await loadConfig(root)).toMatchObject({ config: { agents: { defaultEffort: "fast" } }, ok: true });

    fs.writeFileSync(
      path.join(root, LOCAL_CONFIG_FILE),
      'export default { agents: { defaultEffort: "deep", defaultApproval: "away" } }\n',
    );

    expect(await loadConfig(root)).toMatchObject({
      config: { agents: { defaultApproval: "away", defaultEffort: "deep" } },
      ok: true,
    });
  });
});

describe("repo.config.local.ts load", () => {
  it("names the local file when it throws or has no default export", async () => {
    expect(await agentsOf("export default {}\n", 'throw new Error("local exploded")\n')).toStrictEqual([
      expect.stringMatching(/^repo\.config\.local\.ts: failed to load: .*local exploded/),
    ]);
    expect(await agentsOf("export default {}\n", "export const agents = {}\n")).toStrictEqual([
      "repo.config.local.ts: no default export; add `export default defineLocalConfig({ ... })`",
    ]);
  });
});

describe("repo.config.local.ts errors", () => {
  it("refuses a key other than the three defaults, at any depth", async () => {
    const only =
      "only agents.defaultApproval, defaultEffort and defaultStrategy go here; set the rest in repo.config.ts";

    expect(await agentsOf("export default {}\n", 'export default { agents: { hosts: ["claude"] } }\n')).toStrictEqual([
      `repo.config.local.ts: agents.hosts: ${only}`,
    ]);
    expect(await agentsOf("export default {}\n", "export default { lint: {} }\n")).toStrictEqual([
      `repo.config.local.ts: lint: ${only}`,
    ]);
    expect(await agentsOf("export default {}\n", 'export default { agents: { defaultMode: "ask" } }\n')).toStrictEqual([
      `repo.config.local.ts: agents.defaultMode: ${only}`,
    ]);
  });

  it("refuses a bad value with the committed file's message", async () => {
    expect(
      await agentsOf("export default {}\n", 'export default { agents: { defaultEffort: "slow" } }\n'),
    ).toStrictEqual(['repo.config.local.ts: agents.defaultEffort: must be "fast" or "deep"']);
  });

  it("still names repo.config.ts for a committed error beside a good local file", async () => {
    expect(
      await agentsOf('export default { agents: { defaultEffort: "slow" } }\n', "export default {}\n"),
    ).toStrictEqual(['repo.config.ts: agents.defaultEffort: must be "fast" or "deep"']);
  });
});

/** An importer that finds the committed file and fails the local one as an uninstalled package. */
function importer(file: string) {
  if (!file.endsWith("repo.config.local.ts")) return Promise.resolve({ default: {} });

  return Promise.reject(new Error(`Cannot find package '@workerstack/repo' imported from ${file}`));
}

describe("repo.config.local.ts as the docs write it", () => {
  it("loads defineLocalConfig from the package and applies it", async () => {
    const local = [
      'import { defineLocalConfig } from "@workerstack/repo";',
      "",
      'export default defineLocalConfig({ agents: { defaultApproval: "away", defaultEffort: "fast" } });',
      "",
    ].join("\n");

    const root = repo(COMMITTED, { name: "fixture" }, local);
    linkPackage(root);

    expect(await loadConfig(root)).toMatchObject({
      config: { agents: { defaultApproval: "away", defaultEffort: "fast", defaultStrategy: "free" } },
      ok: true,
    });
  });

  it("says to install when the local file imports a package nothing provides", async () => {
    const root = repo("export default {}\n", { name: "fixture" }, "export default {}\n");

    expect(await loadConfig(root, importer)).toStrictEqual({
      errors: [`repo.config.local.ts: @workerstack/repo is not installed in ${root}; run \`bun install\` there`],
      ok: false,
    });
  });
});
