import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it, vi } from "vitest";

import { linkText } from "../dev/test-paths.ts";
import { CONFIG_FILE } from "./config.constants.ts";
import { read, region, syncWith, tempDir, useSyncKit, write } from "./fixtures/sync-kit.ts";
import { gitFiles } from "./sync/git-files.ts";

useSyncKit();
vi.setConfig({ testTimeout: 120_000 });

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rule = (extra: string, body: string) => `---\ndescription: d\n${extra}---\n${body}\n`;

/** The web package's own rules and skill, under its `.repo`. */
function writeWebRepo(root: string): void {
  write(
    root,
    "packages/web/.repo/rules/components.md",
    rule("", "Components live in src/components and use the ui kit."),
  );
  write(root, "packages/web/.repo/rules/api.md", rule("paths:\n  - src/api/**\n", "Api."));
  write(
    root,
    "packages/web/.repo/skills/deploy/SKILL.md",
    "---\nname: deploy\ndescription: Ships web.\n---\nDeploy.\n",
  );
}

function workspace(extra: Record<string, string> = {}): string {
  const root = tempDir();
  write(root, CONFIG_FILE, 'export default { packs: ["agents", "docs"], agents: { hosts: ["claude", "codex"] } }\n');
  write(root, "package.json", JSON.stringify({ name: "fixture", workspaces: ["packages/*"] }));
  const scope = path.join(root, "node" + "_modules", "@workerstack");
  fs.mkdirSync(scope, { recursive: true });
  fs.symlinkSync(SELF_ROOT, path.join(scope, "repo"), "dir");
  write(
    root,
    "packages/web/package.json",
    JSON.stringify({ dependencies: { "@acme/api": "1.0.0", "@workerstack/ui": "1.0.0" }, name: "@acme/web" }),
  );
  write(root, "packages/web/references/INDEX.md", "# Web\n");
  write(root, "packages/api/package.json", JSON.stringify({ name: "@acme/api" }));
  write(root, "packages/api/references/INDEX.md", "# Api\n");
  write(root, "packages/web/src/api/a.ts", "export {}\n");
  writeWebRepo(root);
  for (const [rel, text] of Object.entries(extra)) write(root, rel, text);
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}
const real = (cwd: string, ...args: string[]) => syncWith(cwd, { post: [gitFiles] }, ...args);

it("writes the package files, links and deps, ignores them, and is then clean", async () => {
  const root = workspace();
  expect(await real(root)).toMatchObject({ code: 0 });
  // The pathless package rule was handed over: its text is the user's, below the region.
  expect(read(root, "packages/web/AGENTS.md")).toMatch(
    /^<!-- repo:rules [\da-f]{8} -->\nStart at references\/INDEX\.md in this package\.\n\n## Rules by path\n- `packages\/web\/src\/api\/\*\*`: read `packages\/web\/\.repo\/rules\/api\.md`\n<!-- \/repo:rules -->\n\nComponents live in src\/components and use the ui kit\.\n$/,
  );
  expect(fs.existsSync(path.join(root, "packages/web/CLAUDE.md"))).toBe(false);
  expect(fs.existsSync(path.join(root, "packages/web/.repo/rules/components.md"))).toBe(false);
  expect(fs.existsSync(path.join(root, ".claude/rules/packages/web/components.md"))).toBe(false);
  expect(linkText(path.join(root, "packages/web/.claude/skills/deploy"))).toBe("../../.repo/skills/deploy");
  expect(linkText(path.join(root, "packages/web/.agents/skills/deploy"))).toBe("../../.repo/skills/deploy");
  expect(read(root, "AGENTS.md")).not.toContain("Components live");
  const deps = "- [@acme/api](../../api/references/INDEX.md)\n";
  expect(read(root, "packages/web/references/INDEX.md")).toBe(
    `# Web\n\n${region("<!-- ", " -->", ["deps", `${deps}- [@workerstack/ui](../../../node_modules/@workerstack/ui/references/INDEX.md)`])}`,
  );
  const ignored = execFileSync(
    "git",
    [
      "check-ignore",
      "packages/web/AGENTS.md",
      "packages/web/.claude/skills/deploy",
      "packages/web/.agents/skills/deploy",
      "packages/api/AGENTS.md",
    ],
    { cwd: root, encoding: "utf8" },
  );
  expect(ignored).toBe("packages/web/.claude/skills/deploy\npackages/web/.agents/skills/deploy\n");
  expect(await real(root, "--check")).toEqual({ code: 0, stderr: "", stdout: "repo sync: up to date\n" });
});

it("prints every package refusal in one go with nothing written", async () => {
  const root = workspace({
    ".repo/rules/packages/web/x.md": rule("paths:\n  - packages/**\n", "Clash."),
    "packages/web/.repo/lessons/a.md": "x\n",
    "packages/web/.repo/rules/components.md": rule("paths:\n  - src/**\n", "Components."),
    "packages/web/.repo/rules/x.md": rule('paths:\n  - "../api/**"\n', "X."),
    "packages/web/.repo/rules/y.md": rule("overrides: overview\n", "Y."),
  });
  expect(await real(root)).toEqual({
    code: 1,
    stderr:
      "repo sync: packages/web/.repo/lessons/: a package .repo holds only rules/ and skills/; lessons live in the root .repo\n" +
      'repo sync: packages/web/.repo/rules/x.md: paths "../api/**" leaves the package; scope it inside packages/web\n' +
      "repo sync: packages/web/.repo/rules/y.md: overrides has no meaning in a package rule; remove it\n" +
      "repo sync: .claude/rules/packages/web/x.md: planned by .repo/rules/packages/web/x.md and packages/web/.repo/rules/x.md; rename one\n" +
      "repo sync: nothing written\n",
    stdout: "",
  });
  expect(fs.existsSync(path.join(root, "packages/web/AGENTS.md"))).toBe(false);
});
