import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";

import { readGoldens } from "../../dev/capture-tree-goldens.ts";
import { HOSTS, type Host } from "../config.ts";
import { BASE_CONFIG } from "../fixtures/base-config.ts";
import { GIT_FILE_PATHS, gitFiles, listedFiles, untrackedEntries } from "./git-files.ts";
import { HOST_TREES } from "./hosts.ts";
import type { Managed, Output, SyncContext } from "./outputs.ts";
import { regionHash } from "./region.ts";

const IGNORE_BASE = [".tmp/", ".worktrees/", ".repo/tmp/", "coverage/"];
/** The `#` region `name` holding `rows`, as sync writes it. */
const region = (name: string, rows: readonly string[]) =>
  `# repo:${name} ${regionHash(rows.join("\n"))}\n${rows.map((row) => `${row}\n`).join("")}# /repo:${name}\n`;
const attributes = (...rels: string[]) =>
  region("generated", ["* text=auto eol=lf", ...rels.map((rel) => `${rel} linguist-generated`)]);

type Fixture = { hosts?: Host[]; name?: string; files?: Record<string, string> };

function context({ hosts = [], name = "app", files = {} }: Fixture = {}): SyncContext {
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

const file = (path: string, tracked: boolean, managed: Managed = "whole"): Output => ({
  content: `${path}\n`,
  kind: "file",
  managed,
  path,
  tracked,
});
const link = (path: string, tracked: boolean): Output => ({
  kind: "link",
  managed: "whole",
  path,
  target: "elsewhere",
  tracked,
});

/** What the trees generator plans for `hosts`: AGENTS.md (shared, so tracked), .mcp.json and a file in each dir the hosts own, none committed. */
function treeOutputs(hosts: readonly Host[], tracked: boolean): Output[] {
  const dirs = hosts.flatMap((host) => HOST_TREES[host].owns);
  return [
    ...(hosts.length > 0 ? [file("AGENTS.md", true, "block")] : []),
    ...(hosts.includes("claude") ? [file(".mcp.json", tracked)] : []),
    ...dirs.map((dir) => file(`${dir}config.toml`, tracked)),
    ...dirs.map((dir) => link(`${dir}skills-link`, tracked)),
  ];
}

const outputOf = (outputs: Output[], rel: string): string => {
  const found = outputs.find((output) => output.path === rel);
  if (found?.kind !== "file") throw new Error(`no file output ${rel}`);
  return found.content;
};
const run = (fixture: Fixture, outputs: Output[]) => gitFiles(context(fixture), outputs);
const gitignoreOf = (fixture: Fixture, outputs: Output[]) => outputOf(run(fixture, outputs).outputs, ".gitignore");
const gitattributesOf = (fixture: Fixture, outputs: Output[]) =>
  outputOf(run(fixture, outputs).outputs, ".gitattributes");
const settingsOf = (fixture: Fixture, outputs: Output[]) =>
  outputOf(run(fixture, outputs).outputs, ".vscode/settings.json");
const readonlyOf = (text: string): string[] =>
  Object.keys((parse(text) as Record<string, Record<string, boolean>>)["files.readonlyInclude"] ?? {});
const block = (...entries: string[]) => region("ignore", [...IGNORE_BASE, "node_modules/", ...entries]);
/** The repairs the git files pass reports on `rel`, none planned beside it. */
const repairsOf = (fixture: Fixture, rel: string) => {
  const found = run(fixture, []).outputs.find((output) => output.path === rel);
  return found?.kind === "file" ? found.repairs : undefined;
};

describe("the gitignore block", () => {
  it("lists .mcp.json and every host dir for the untracked trees of all hosts, and never the shared AGENTS.md", () => {
    expect(gitignoreOf({ hosts: [...HOSTS] }, treeOutputs(HOSTS, false))).toBe(
      block(".mcp.json", ".agents/", ".claude/", ".codex/", ".cursor/", ".grok/"),
    );
  });

  it("lists only what the enabled hosts own, a parent dir covering its children", () => {
    expect(gitignoreOf({ hosts: ["claude"] }, treeOutputs(["claude"], false))).toBe(block(".mcp.json", ".claude/"));
    expect(gitignoreOf({ hosts: ["codex"] }, treeOutputs(["codex"], false))).toBe(block(".agents/skills/", ".codex/"));
    const both: Host[] = ["codex", "antigravity"];
    expect(gitignoreOf({ hosts: both }, treeOutputs(both, false))).toBe(block(".agents/", ".codex/"));
  });

  it("lists an untracked output outside every host dir by its exact path, and an untracked link by its dir", () => {
    const outputs = [file("generated/out.txt", false), link(".claude/skills/ask", false)];
    expect(gitignoreOf({ hosts: ["claude"] }, outputs)).toBe(block("generated/out.txt", ".claude/"));
  });

  it("ignores the vitest preset's report directory, so lint does not scan generated coverage reports", () => {
    const hosts: Host[] = ["claude"];
    expect(gitignoreOf({ hosts, name: "@workerstack/repo" }, treeOutputs(hosts, true)).split("\n")).toContain(
      "coverage/",
    );
  });

  it("lists nothing untracked for this repo, whose trees are committed, and keeps its own dependency line outside", () => {
    const self = { hosts: ["claude", "codex"] as Host[], name: "@workerstack/repo" };
    expect(gitignoreOf(self, treeOutputs(self.hosts, true))).toBe(region("ignore", IGNORE_BASE));
  });

  it("lists no tracked output and no block output, tracked or not", () => {
    const outputs = [
      file("bunfig.toml", true),
      file("references/INDEX.md", false, "block"),
      file(".gitattributes", false, "block"),
    ];
    expect(gitignoreOf({ hosts: ["claude"] }, outputs)).toBe(block());
  });

  it("writes the block alone when .gitignore is missing, empty or blank", () => {
    for (const files of [{}, { ".gitignore": "" }, { ".gitignore": "\n\n" }] as Record<string, string>[])
      expect(gitignoreOf({ files }, [])).toBe(block());
  });

  it("appends the block after one blank line, adding a missing trailing newline first", () => {
    expect(gitignoreOf({ files: { ".gitignore": "dist" } }, [])).toBe(`dist\n\n${block()}`);
    expect(gitignoreOf({ files: { ".gitignore": "node_modules/\n.tmp/\n\n\n" } }, [])).toBe(
      `node_modules/\n.tmp/\n\n${block()}`,
    );
  });

  it("converts the old block in place in one pass, whatever its label, keeping the text around it", () => {
    const text = "dist/\n# >>> @workerstack/repo (old label)\n.cache/\n# <<< @workerstack/repo\n\n.env\n";
    const fixture = { files: { ".gitignore": text } };
    expect(gitignoreOf(fixture, [])).toBe(`dist/\n${block()}\n.env\n`);
    expect(repairsOf(fixture, ".gitignore")).toStrictEqual(["converted the old markers to repo:ignore"]);
    const again = { files: { ".gitignore": gitignoreOf(fixture, []) } };
    expect([gitignoreOf(again, []), repairsOf(again, ".gitignore")]).toStrictEqual([
      gitignoreOf(fixture, []),
      undefined,
    ]);
  });

  it("leaves a current .gitignore byte-identical and does not take a longer marker for the begin marker", () => {
    const current = `dist/\n\n${block()}`;
    expect(gitignoreOf({ files: { ".gitignore": current } }, [])).toBe(current);
    expect(repairsOf({ files: { ".gitignore": current } }, ".gitignore")).toBeUndefined();
    const longer = "# >>> @workerstack/repository\n";
    expect(gitignoreOf({ files: { ".gitignore": longer } }, [])).toBe(`${longer}\n${block()}`);
  });

  it("closes a region left open, old or new form, for .gitignore and .gitattributes alike, instead of failing", () => {
    const files = {
      ".gitattributes": "# repo:generated 0badc0de\n* text=auto eol=lf\n*.png binary\n",
      ".gitignore": "dist/\n# >>> @workerstack/repo (generated by repo sync)\n.tmp/\n",
    };
    const result = run({ files }, []);
    expect(result.errors).toStrictEqual([]);
    expect(outputOf(result.outputs, ".gitignore")).toBe(`dist/\n${block()}`);
    expect(outputOf(result.outputs, ".gitattributes")).toBe(`${attributes()}*.png binary\n`);
    expect(repairsOf({ files }, ".gitignore")).toStrictEqual(["closed repo:ignore"]);
    expect(repairsOf({ files }, ".gitattributes")).toStrictEqual(["closed repo:generated"]);
  });
});

describe("untrackedEntries", () => {
  it("is what the gitignore block lists for the outputs, without the base lines", () => {
    expect(untrackedEntries(["claude"], treeOutputs(["claude"], false))).toStrictEqual([".mcp.json", ".claude/"]);
    expect(untrackedEntries(["claude"], treeOutputs(["claude"], true))).toStrictEqual([]);
    expect(untrackedEntries([], [file("AGENTS.md", false)])).toStrictEqual(["AGENTS.md"]);
  });

  it("adds the pattern of knip's ignore-free copies beside knip.json, sorted among the files", () => {
    const outputs = [file("AGENTS.md", false), file("knip.json", false), file(".oxlintrc.json", false)];
    expect(untrackedEntries([], outputs)).toStrictEqual([
      "AGENTS.md",
      "knip.json",
      "knip.unignored-*.json",
      ".oxlintrc.json",
      ".oxlintrc.unskipped-*.json",
    ]);
  });
});

describe("untrackedEntries in a Rust repo", () => {
  it("adds cargo's target dir beside the toolchain pin, after the files, and not without it", () => {
    const rust = ["rust-toolchain.toml", "rustfmt.toml", "clippy.toml", "deny.toml"].map((rel) => file(rel, false));
    expect(untrackedEntries([], rust)).toStrictEqual([
      "clippy.toml",
      "deny.toml",
      "rust-toolchain.toml",
      "rustfmt.toml",
      "target/",
    ]);
    expect(untrackedEntries([], [file("rustfmt.toml", false), file("deny.toml", false)])).toStrictEqual([
      "deny.toml",
      "rustfmt.toml",
    ]);
  });
});

describe("the gitattributes block", () => {
  it("sets LF and marks every tracked whole file output, sorted, with no link, untracked or block output", () => {
    const outputs = [
      file("bunfig.toml", true),
      file("AGENTS.md", true),
      file(".agents/agents/implementer-deep.md", true),
      link(".claude/skills/ask", true),
      file(".claude/settings.json", false),
      file("references/INDEX.md", true, "block"),
      file(".gitignore", true, "block"),
    ];
    expect(gitattributesOf({}, outputs)).toBe(
      attributes(".agents/agents/implementer-deep.md", "AGENTS.md", "bunfig.toml"),
    );
  });

  it("sets LF alone when nothing is tracked, as in a consumer whose only tracked output is a block", () => {
    expect(gitattributesOf({ hosts: ["claude"] }, treeOutputs(["claude"], false))).toBe(attributes());
  });

  it("converts the old block in place in one pass and keeps the user's lines outside it", () => {
    const old = "# >>> @workerstack/repo (generated by repo sync)\n* text=auto eol=lf\nstale linguist-generated\n";
    const files = { ".gitattributes": `*.png binary\n\n${old}# <<< @workerstack/repo\n\n*.lock -diff\n` };
    expect(gitattributesOf({ files }, [file("bunfig.toml", true)])).toBe(
      `*.png binary\n\n${attributes("bunfig.toml")}\n*.lock -diff\n`,
    );
    expect(repairsOf({ files }, ".gitattributes")).toStrictEqual(["converted the old markers to repo:generated"]);
  });
});

describe("files.readonlyInclude in .vscode/settings.json", () => {
  const OUTPUTS = [file("bunfig.toml", true), file(".claude/settings.json", false), link(".claude/skills/ask", false)];

  it("creates the file with the exact path of every whole file output, sorted, and no link", () => {
    expect(settingsOf({}, OUTPUTS)).toBe(
      '{\n  "files.readonlyInclude": {\n    ".claude/settings.json": true,\n    "bunfig.toml": true\n  }\n}\n',
    );
    expect(settingsOf({ files: { ".vscode/settings.json": " \n" } }, OUTPUTS)).toBe(settingsOf({}, OUTPUTS));
  });

  it("leaves out block outputs and does not lock a user file inside a generated dir", () => {
    const outputs = [
      ...OUTPUTS,
      file(".gitignore", true, "block"),
      file(".vscode/settings.json", true, "block"),
      file("references/INDEX.md", true, "block"),
    ];
    expect(readonlyOf(settingsOf({}, outputs))).toStrictEqual([".claude/settings.json", "bunfig.toml"]);
    expect(readonlyOf(settingsOf({}, outputs))).not.toContain(".claude");
    expect(readonlyOf(settingsOf({}, outputs))).not.toContain(".claude/mine.md");
  });

  it("adds the map to a commented file and keeps every other key and comment byte for byte", () => {
    const before = '// my editor\n{\n  "editor.tabSize": 4, // wide\n\t/* keep */ "files.autoSave": "off",\n}\n';
    const after = settingsOf({ files: { ".vscode/settings.json": before } }, OUTPUTS);
    expect(after.startsWith("// my editor\n{\n")).toBe(true);
    expect(after.endsWith('\n  "editor.tabSize": 4, // wide\n\t/* keep */ "files.autoSave": "off",\n}\n')).toBe(true);
    expect(readonlyOf(after)).toStrictEqual([".claude/settings.json", "bunfig.toml"]);
    expect(parse(after)).toMatchObject({ "editor.tabSize": 4, "files.autoSave": "off" });
  });

  it("replaces a map of the user's own, and keeps the keys around it as written", () => {
    const before =
      '{\n  // lock\n  "files.readonlyInclude": { "mine.txt": true, "bunfig.toml": false },\n  "editor.tabSize": 2 /* last */\n}\n';
    const after = settingsOf({ files: { ".vscode/settings.json": before } }, OUTPUTS);
    expect(readonlyOf(after)).toStrictEqual([".claude/settings.json", "bunfig.toml"]);
    expect(parse(after)["files.readonlyInclude"]["bunfig.toml"]).toBe(true);
    expect(after.startsWith("{\n  // lock\n  ")).toBe(true);
    expect(after.endsWith('"editor.tabSize": 2 /* last */\n}\n')).toBe(true);
  });

  it("is stable: a second pass over its own output changes nothing", () => {
    const first = settingsOf({ files: { ".vscode/settings.json": '{\n  // c\n  "a": 1\n}\n' } }, OUTPUTS);
    expect(settingsOf({ files: { ".vscode/settings.json": first } }, OUTPUTS)).toBe(first);
    const replaced = settingsOf(
      { files: { ".vscode/settings.json": '{"files.readonlyInclude": {"x": true}}' } },
      OUTPUTS,
    );
    expect(settingsOf({ files: { ".vscode/settings.json": replaced } }, OUTPUTS)).toBe(replaced);
  });

  it("keeps CRLF line endings of a file that uses them", () => {
    const after = settingsOf({ files: { ".vscode/settings.json": '{\r\n  "a": 1\r\n}\r\n' } }, OUTPUTS);
    expect(after.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("writes an empty map when there is no whole output", () => {
    expect(settingsOf({}, [])).toBe('{\n  "files.readonlyInclude": {}\n}\n');
  });

  it("leaves a file that is not valid JSONC as is, naming the error and its line, and still plans the rest", () => {
    for (const [text, line] of [
      ['{ "a": }', 1],
      ['{\r\n  "a": 1,\r\n  "b": \r\n}\r\n', 4],
    ] as const) {
      const result = run({ files: { ".vscode/settings.json": text } }, []);
      expect(result.errors).toStrictEqual([]);
      expect(result.outputs.map((output) => output.path)).toStrictEqual(GIT_FILE_PATHS);
      expect(outputOf(result.outputs, ".vscode/settings.json")).toBe(text);
      expect(repairsOf({ files: { ".vscode/settings.json": text } }, ".vscode/settings.json")).toStrictEqual([
        `not valid JSONC at line ${line} (ValueExpected); left as is`,
      ]);
    }
  });

  it("leaves a file that holds no JSON object as is, with the warning, and still plans the rest", () => {
    for (const text of ["[]", "1", "null"]) {
      const result = run({ files: { ".vscode/settings.json": text } }, []);
      expect([result.errors, outputOf(result.outputs, ".vscode/settings.json")]).toStrictEqual([[], text]);
      expect(repairsOf({ files: { ".vscode/settings.json": text } }, ".vscode/settings.json")).toStrictEqual([
        "must hold a JSON object; left as is",
      ]);
    }
  });
});

describe("the golden fixture's outputs", () => {
  const goldens = [...readGoldens().keys()];
  /** Each golden as the trees generator plans it: AGENTS.md a tracked shared file, every other one owned whole. */
  const planned = (tracked: boolean) =>
    goldens.map((rel) => (rel === "AGENTS.md" ? file(rel, true, "block") : file(rel, tracked)));
  const owned = goldens.filter((rel) => rel !== "AGENTS.md");
  const outputs = planned(false);

  it("are ignored by host dir, read-only by exact path, and marked generated by none (a consumer commits none but AGENTS.md)", () => {
    const fixture = { hosts: [...HOSTS] };
    expect(gitignoreOf(fixture, outputs)).toBe(block(".agents/", ".claude/", ".codex/", ".cursor/", ".grok/"));
    expect(readonlyOf(settingsOf(fixture, outputs))).toStrictEqual([...owned].sort());
    expect(gitattributesOf(fixture, outputs)).toBe(attributes());
  });

  it("are marked generated one line each when the repo commits them", () => {
    const lines = gitattributesOf({ hosts: [...HOSTS] }, planned(true)).split("\n");
    expect(lines.filter((line) => line.endsWith(" linguist-generated"))).toStrictEqual(
      [...owned].sort().map((rel) => `${rel} linguist-generated`),
    );
  });
});

describe("listedFiles", () => {
  it("lists tracked and untracked files git does not ignore, with extra ignore lines applied, sorted", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-listed-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: root });
      for (const rel of ["b.ts", "a/x.ts", "skip/y.ts", "ignored.log"]) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), "x");
      }
      fs.writeFileSync(path.join(root, ".gitignore"), "*.log\n");
      expect(listedFiles(root, ["skip/"])).toStrictEqual([".gitignore", "a/x.ts", "b.ts"]);
      expect(listedFiles(path.join(root, "missing"), [])).toBeNull();
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("package outputs", () => {
  const packageOutputs = (tracked: boolean): Output[] => [
    file("packages/web/AGENTS.md", true, "block"),
    file("packages/web/CLAUDE.md", tracked),
    link("packages/web/.claude/skills/deploy", tracked),
    file(".claude/rules/packages/web/x.md", tracked),
  ];

  it("lists each untracked package output by its exact path, beside the collapsed host dir, and never its shared AGENTS.md", () => {
    expect(gitignoreOf({ hosts: ["claude"] }, packageOutputs(false))).toBe(
      block("packages/web/.claude/skills/deploy", "packages/web/CLAUDE.md", ".claude/"),
    );
  });

  it("marks tracked package files generated and read-only by exact path, and ignores nothing", () => {
    const outputs = packageOutputs(true);
    expect(gitignoreOf({ hosts: ["claude"], name: "@workerstack/repo" }, outputs)).toBe(region("ignore", IGNORE_BASE));
    expect(gitattributesOf({}, outputs)).toContain("packages/web/CLAUDE.md linguist-generated\n");
    expect(gitattributesOf({}, outputs)).not.toContain("packages/web/AGENTS.md");
    const readonly = parse(settingsOf({}, outputs))["files.readonlyInclude"] as Record<string, boolean>;
    expect(readonly["packages/web/AGENTS.md"]).toBeUndefined();
    expect(readonly["packages/web/CLAUDE.md"]).toBe(true);
  });
});
