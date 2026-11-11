import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { HOSTS, SKILL_PACKS } from "./config.ts";
import { BASE_CONFIG } from "./fixtures/base-config.ts";
import {
  PACKS_LINE,
  config,
  defaultBody,
  fakeExec,
  hostsList,
  oxfmtBin,
  stubPkgRoot,
  tmp,
  useInitKit,
} from "./fixtures/init-kit.ts";
import { init, writeConfigIfMissing } from "./init.ts";
import { standards } from "./sync/standards.ts";

useInitKit();
/** A resolved config's agents with no host and no skill. */
const NO_AGENTS = { hosts: [], skills: [] };

it("writes the default packs and all five hosts when the repo has no config", () => {
  const dest = tmp("repo-config-");
  init(dest, { execFileSync: fakeExec(), pkgRoot: stubPkgRoot() });
  expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(config(defaultBody()));
  expect(HOSTS).toEqual(["claude", "codex", "antigravity", "grok", "cursor"]);
});

it("writes the same default packs when package.json declares workspaces", () => {
  const dest = tmp("repo-config-ws-");
  fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "app", workspaces: ["packages/*"] }));
  init(dest, { execFileSync: fakeExec(), pkgRoot: stubPkgRoot() });
  expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(config(defaultBody()));
});

it("keeps a config the repo already has", () => {
  const dest = tmp("repo-config-keep-");
  const own = 'export default { packs: ["docs"] }\n';
  fs.writeFileSync(path.join(dest, "workerstack.config.ts"), own);
  init(dest, { execFileSync: fakeExec(), packs: ["listen"], pkgRoot: stubPkgRoot() });
  expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(own);
});

it("writes the default packs for a dir without package.json", () => {
  const dest = tmp("repo-config-bare-");
  writeConfigIfMissing(dest);
  expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(config(defaultBody()));
});

it("writes the chosen skill packs as agents.skills", () => {
  const dest = tmp("repo-config-skills-");
  writeConfigIfMissing(dest, ["listen", "speak"]);
  expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(
    config(`${PACKS_LINE}  agents: { hosts: [${hostsList()}], skills: ["listen", "speak"] },\n`),
  );
});

it("breaks agents over lines when one line would pass 120 columns", () => {
  const dest = tmp("repo-config-wide-");
  writeConfigIfMissing(dest, [...SKILL_PACKS]);
  expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(
    config(
      `${PACKS_LINE}  agents: {\n    hosts: [${hostsList()}],\n\
    skills: ["google-workspace", "listen", "speak", "clasp"],\n  },\n`,
    ),
  );
});

it.each([[[]], [["listen"]], [[...SKILL_PACKS]]])(
  "writes files the pinned oxfmt finds formatted under the standards config (skills %j)",
  (skills) => {
    const dest = tmp("repo-config-fmt-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({ name: "app", scripts: { build: "tsc" }, workspaces: ["packages/*"] }),
    );
    init(dest, { execFileSync: fakeExec(), packs: skills, pkgRoot: stubPkgRoot() });
    const ctx = {
      config: { agents: NO_AGENTS, packs: ["standards" as const], ...BASE_CONFIG },
      read: () => null,
      root: dest,
      workspace: { manifest: {}, packages: [], root: dest },
    };
    for (const output of standards(ctx, []).outputs) {
      if (output.kind === "file") {
        fs.mkdirSync(path.dirname(path.join(dest, output.path)), { recursive: true });
        fs.writeFileSync(path.join(dest, output.path), output.content);
      }
    }
    const run = spawnSync(process.execPath, [oxfmtBin(), "--check"], { cwd: dest, encoding: "utf8" });
    expect(run.stdout + run.stderr).toContain("All matched files use the correct format");
    expect(run.status).toBe(0);
  },
);

it("writes no skills key for an empty choice", () => {
  const dest = tmp("repo-config-none-");
  writeConfigIfMissing(dest, []);
  expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(config(defaultBody()));
});
