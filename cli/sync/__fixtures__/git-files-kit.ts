// Contexts, planned outputs and readers for the git files suites: `.gitignore`, `.gitattributes` and the editor settings.
import { parse } from "jsonc-parser";

import { type Host } from "../../config.ts";
import { BASE_CONFIG } from "../../__fixtures__/base-config.ts";
import { gitFiles } from "../git-files.ts";
import { HOST_TREES } from "../hosts.ts";
import type { Managed, Output, SyncContext } from "../outputs.ts";
import { regionHash } from "../region.ts";

export const IGNORE_BASE = [".tmp/", ".worktrees/", ".repo/tmp/", "coverage/"];
/** The `#` region `name` holding `rows`, as sync writes it. */
export const region = (name: string, rows: readonly string[]) =>
  `# repo:${name} ${regionHash(rows.join("\n"))}\n${rows.map((row) => `${row}\n`).join("")}# /repo:${name}\n`;
export const attributes = (...rels: string[]) =>
  region("generated", ["* text=auto eol=lf", ...rels.map((rel) => `${rel} linguist-generated`)]);

export type Fixture = { hosts?: Host[]; name?: string; files?: Record<string, string> };

export function context({ hosts = [], name = "app", files = {} }: Fixture = {}): SyncContext {
  return {
    config: {
      agents: { hosts, skills: [] },
      packs: ["agents"],
      ...BASE_CONFIG,
    },
    read: (rel) => files[rel] ?? null,
    root: "/repo",
    workspace: { manifest: { name }, packages: [], root: "/repo" },
  };
}

export const file = (rel: string, tracked: boolean, managed: Managed = "whole"): Output => ({
  content: `${rel}\n`,
  kind: "file",
  managed,
  path: rel,
  tracked,
});
export const link = (rel: string, tracked: boolean): Output => ({
  kind: "link",
  managed: "whole",
  path: rel,
  target: "elsewhere",
  tracked,
});

/** What the trees generator plans for `hosts`: AGENTS.md (shared, so tracked), .mcp.json and a file in each dir the hosts own, none committed. */
export function treeOutputs(hosts: readonly Host[], tracked: boolean): Output[] {
  const dirs = hosts.flatMap((host) => HOST_TREES[host].owns);
  return [
    ...(hosts.length > 0 ? [file("AGENTS.md", true, "block")] : []),
    ...(hosts.includes("claude") ? [file(".mcp.json", tracked)] : []),
    ...dirs.map((dir) => file(`${dir}config.toml`, tracked)),
    ...dirs.map((dir) => link(`${dir}skills-link`, tracked)),
  ];
}

export const outputOf = (outputs: Output[], rel: string): string => {
  const found = outputs.find((output) => output.path === rel);
  if (found?.kind !== "file") throw new Error(`no file output ${rel}`);
  return found.content;
};
export const run = (fixture: Fixture, outputs: Output[]) => gitFiles(context(fixture), outputs);
export const gitignoreOf = (fixture: Fixture, outputs: Output[]) => outputOf(run(fixture, outputs).outputs, ".gitignore");
export const gitattributesOf = (fixture: Fixture, outputs: Output[]) =>
  outputOf(run(fixture, outputs).outputs, ".gitattributes");
export const settingsOf = (fixture: Fixture, outputs: Output[]) =>
  outputOf(run(fixture, outputs).outputs, ".vscode/settings.json");
export const readonlyOf = (text: string): string[] =>
  Object.keys(
    (parse(text) /* the settings file is a JSON object of maps */ as Record<string, Record<string, boolean>>)[
      "files.readonlyInclude"
    ] ?? {},
  );
export const block = (...entries: string[]) => region("ignore", [...IGNORE_BASE, "node_modules/", ...entries]);
/** The repairs the git files pass reports on `rel`, none planned beside it. */
export const repairsOf = (fixture: Fixture, rel: string) => {
  const found = run(fixture, []).outputs.find((output) => output.path === rel);
  return found?.kind === "file" ? found.repairs : undefined;
};
