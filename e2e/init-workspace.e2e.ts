/** Init into repos that already hold content: a two-package workspace, and user files init must keep. */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { linkText } from "../dev/test-paths.ts";
import { expectClean, ignoredFiles, isClaudeSettings, isPackageJson } from "./init-helpers";
import { PACKAGE_NAME } from "./registry";
import { Sandbox, tail } from "./sandbox";

describe("a two-package workspace", () => {
  it("gives each package an AGENTS.md holding its pathless rules, scoped rules, nested skills and a deps index, in sync", async () => {
    const sb = new Sandbox("packages");
    await sb.scaffold({ workspaces: ["packages/*"] });
    sb.write(
      "packages/api/package.json",
      `${JSON.stringify({ main: "src/main.ts", name: "@acme/api", private: true, sideEffects: false })}\n`,
    );
    sb.write("packages/api/src/main.ts", "export const main = 1;\n");
    sb.write("packages/api/references/INDEX.md", "# Api\n");
    sb.write(
      "packages/web/package.json",
      `${JSON.stringify({ dependencies: { "@acme/api": "workspace:*" }, name: "@acme/web", private: true, sideEffects: false })}\n`,
    );
    sb.write("packages/web/references/INDEX.md", "# Web\n");
    sb.write("packages/web/src/api/a.ts", "export const a = 1;\n");
    sb.write(
      "packages/web/src/main.ts",
      'import { main as api } from "@acme/api";\nimport { a } from "./api/a.ts";\n\nexport const main = api + a;\n',
    );
    sb.write(
      "packages/web/.repo/rules/components.md",
      "---\ndescription: Components\n---\nComponents live in src/components and use the ui kit.\n",
    );
    sb.write("packages/web/.repo/rules/api.md", "---\ndescription: Api\npaths:\n  - src/api/**\n---\nApi rule.\n");
    sb.write("packages/web/.repo/skills/deploy/SKILL.md", "---\nname: deploy\ndescription: Ships web.\n---\nDeploy.\n");
    await sb.commit("workspace");
    expectClean(sb, await sb.launch(PACKAGE_NAME, "init"));

    const unhashed = (rel: string) => sb.read(rel).replace(/^<!-- repo:rules [\da-f]{8} -->/, "<!-- repo:rules -->");
    const pointer = "<!-- repo:rules -->\nStart at references/INDEX.md in this package.\n";
    expect(unhashed("packages/web/AGENTS.md")).toBe(
      `${pointer}\n## Rules by path\n- \`packages/web/src/api/**\`: read \`packages/web/.repo/rules/api.md\`\n<!-- /repo:rules -->\n\nComponents live in src/components and use the ui kit.\n`,
    );
    expect(unhashed("packages/api/AGENTS.md")).toBe(`${pointer}<!-- /repo:rules -->\n`);
    for (const gone of [
      "packages/web/CLAUDE.md",
      "packages/web/.repo/rules/components.md",
      ".claude/rules/packages/web/components.md",
    ]) {
      expect(sb.exists(gone), gone).toBe(false);
    }
    expect(linkText(path.join(sb.repo, "packages/web/.claude/skills/deploy"))).toBe("../../.repo/skills/deploy");
    expect(sb.read("AGENTS.md")).not.toContain("Components live");
    const deps = /<!-- repo:deps [\da-f]{8} -->\n([\s\S]*?)<!-- \/repo:deps -->/.exec(
      sb.read("packages/web/references/INDEX.md"),
    )?.[1];
    expect(deps).toBe("- [@acme/api](../../api/references/INDEX.md)\n");

    await sb.commit("after init");
    expect(await ignoredFiles(sb)).toContain("packages/web/.claude/skills/deploy");
    const tracked = (await sb.git("ls-files")).stdout.split("\n");
    expect(tracked).toStrictEqual(expect.arrayContaining(["packages/web/AGENTS.md", "packages/api/AGENTS.md"]));
    expect((await sb.git("status", "--porcelain")).stdout).toBe("");
    expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"]));
    expectClean(sb, await sb.run("bun", ["repo", "check"]));
    const webManifest = sb.read("packages/web/package.json");
    sb.write("packages/web/package.json", webManifest.replace('"private":true,', ""));
    const missing = await sb.run("bun", ["repo", "check"]);
    expect(missing.status, tail(missing.out)).toBe(1);
    expect(missing.stderr).toContain(
      'repo check: packages/web/package.json: "private" is missing; set true, or false to publish it',
    );
    sb.write("packages/web/package.json", webManifest);

    // Scopes are the package names' last segments; a commit under any other is refused.
    sb.write("packages/web/src/api/a.test.ts", "export const a = 1;\n");
    await sb.git("add", "packages/web/src/api/a.test.ts");
    const scoped = await sb.run("git", ["commit", "-q", "-m", "feat(app): add a test"]);
    expect(scoped.status, tail(scoped.out)).toBe(1);
    expect(scoped.stderr).toContain(
      '  - unknown scope "app"; use a workspace package name or one of repo, deps, ci (api, web)\n',
    );
    expect(sb.expectOk(await sb.run("git", ["commit", "-q", "-m", "feat(web): add a test"])).status).toBe(0);
  });
});

describe("existing repo content survives init", () => {
  it("keeps user scripts, dependencies, AGENTS.md text and Claude settings keys", async () => {
    const sb = new Sandbox("existing");
    await sb.scaffold({ devDependencies: { typescript: "^5.9.3" }, scripts: { build: "tsc -p ." } });
    sb.write("AGENTS.md", "# Team rules\n\nAlways run the linter.\n");
    sb.write(".claude/settings.json", `${JSON.stringify({ permissions: { allow: ["Bash(make test)"] } }, null, 2)}\n`);
    await sb.commit("existing content");
    expectClean(sb, await sb.launch(PACKAGE_NAME, "init"));

    const pkg = sb.json("package.json", isPackageJson);
    expect(pkg.scripts.build).toBe("tsc -p .");
    expect(pkg.devDependencies.typescript).toBe("^5.9.3");
    expect(sb.read("AGENTS.md")).toContain("Always run the linter.");
    expect(sb.exists(".repo/rules/agents.md")).toBe(false);
    expect(sb.json(".claude/settings.json", isClaudeSettings).permissions.allow).toContain("Bash(make test)");
    expect((await sb.git("ls-files")).stdout.split("\n")).toContain("AGENTS.md");
  });
});
