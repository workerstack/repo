import { expect, it } from "vitest";

import { AVAILABLE_INDEX_PATH } from "./available.constants.ts";
import { context, contentOf, API, PACKAGE_INDEXES, section, EMPTY_DEPS, repairsOf } from "./fixtures/context-kit.ts";
import { index } from "./outputs.ts";
import type { PackageJson, WorkspacePackage } from "./workspace.ts";

const entry = (name: string, text: string) => `- [${name}](https://www.npmjs.com/package/${name}): ${text}`;
const INDEX_TEXT = [
  entry("@workerstack/repo", "Workflows"),
  entry("@workerstack/system", "OS"),
  entry("@workerstack/testing", "Tests"),
  entry("@acme/api", "Own"),
  entry("@workerstack/root", "Root"),
  entry("@workerstack/database", "DB"),
].join("\n");
const availableFiles = { [AVAILABLE_INDEX_PATH]: `${INDEX_TEXT}\n` };

it("lists the uninstalled packages after repo:stack, minus every installed, root and workspace name", () => {
  const ctx = context({
    files: { ...availableFiles, ...PACKAGE_INDEXES },
    manifest: { devDependencies: { "@workerstack/repo": "^1.0.0" }, name: "@workerstack/root" },
    packages: [{ ...API, manifest: { ...API.manifest, dependencies: { "@workerstack/testing": "^1.0.0" } } }],
  });
  expect(contentOf(index(ctx).outputs[0])).toContain(
    `<!-- /repo:stack -->\n\n${section("available", `${entry("@workerstack/system", "OS")}\n${entry("@workerstack/database", "DB")}`)}\n`,
  );
});

it("writes no section when no index is installed", () => {
  expect(contentOf(index(context()).outputs[0])).not.toContain("repo:available");
});

it("writes nothing with the docs pack off", () => {
  expect(index(context({ files: availableFiles, packs: ["agents"] }))).toStrictEqual({ errors: [], outputs: [] });
});

const pkg = (dir: string, name: string, deps: Partial<PackageJson> = {}): WorkspacePackage => ({
  dir,
  manifest: { name, ...deps },
});
const WEB_PKG = pkg("packages/web", "@acme/web", {
  dependencies: { "@acme/api": "1.0.0", "@workerstack/ui": "1.0.0", react: "19.0.0" },
  devDependencies: { "@acme/core": "1.0.0", "@workerstack/lint": "1.0.0", "@workerstack/shared": "1.0.0" },
  optionalDependencies: { "@workerstack/ai": "1.0.0" },
  peerDependencies: { "@acme/api": "1.0.0" },
});
const files = {
  "packages/api/references/INDEX.md": "# Api\n",
  "packages/core/references/INDEX.md": "# Core\n",
  "packages/shared/references/INDEX.md": "# Shared\n",
  "packages/web/references/INDEX.md": "# Web\n",
};
const packages = [
  WEB_PKG,
  pkg("packages/api", "@acme/api"),
  pkg("packages/core", "@acme/core"),
  pkg("packages/shared", "@workerstack/shared"),
];
const depsOf = (rel: string, ctx = context({ files, packages })) => {
  const content = contentOf(index(ctx).outputs.find((o) => o.path === rel));
  return /<!-- repo:deps [\da-f]+ -->\n([\s\S]*?)<!-- \/repo:deps -->/.exec(content ?? "")?.[1];
};

it("links the INDEX of each workspace dependency first, then each other @workerstack/* one, both sorted and deduped", () => {
  expect(depsOf("packages/web/references/INDEX.md")).toBe(
    "- [@acme/api](../../api/references/INDEX.md)\n" +
      "- [@acme/core](../../core/references/INDEX.md)\n" +
      "- [@workerstack/shared](../../shared/references/INDEX.md)\n" +
      "- [@workerstack/ai](../../../node_modules/@workerstack/ai/references/INDEX.md)\n" +
      "- [@workerstack/lint](../../../node_modules/@workerstack/lint/references/INDEX.md)\n" +
      "- [@workerstack/ui](../../../node_modules/@workerstack/ui/references/INDEX.md)\n",
  );
});

it("gives a package with no such dependency an empty section, and replaces a stale one in place", () => {
  expect(depsOf("packages/api/references/INDEX.md")).toBe("");
  const stale = {
    ...files,
    "packages/web/references/INDEX.md": "# Web\n\n<!-- repo:deps -->\n- stale\n<!-- /repo:deps -->\n\nTail.\n",
  };
  const content = contentOf(
    index(context({ files: stale, packages })).outputs.find((o) => o.path === "packages/web/references/INDEX.md"),
  );
  expect(content).toMatch(/^# Web\n\n<!-- repo:deps [\da-f]{8} -->\n- \[@acme\/api\]/);
  expect(content).toMatch(/<!-- \/repo:deps -->\n\nTail\.\n$/);
  expect(content).not.toContain("stale");
});

it("closes an unclosed deps section in a package INDEX and names that INDEX", () => {
  const broken = { ...files, "packages/api/references/INDEX.md": "# Api\n<!-- repo:deps -->\n" };
  const ctx = context({ files: broken, packages });
  expect(index(ctx).errors).toStrictEqual([]);
  expect(contentOf(index(ctx).outputs.find((o) => o.path === "packages/api/references/INDEX.md"))).toBe(
    `# Api\n${EMPTY_DEPS}\n`,
  );
  expect(repairsOf(ctx, "packages/api/references/INDEX.md")).toStrictEqual(["closed repo:deps"]);
  expect(repairsOf(ctx, "packages/web/references/INDEX.md")).toBeUndefined();
});
