import { expect, it } from "vitest";

import {
  context,
  contentOf,
  API,
  WEB,
  PACKAGE_INDEXES,
  section,
  PACKAGES_SECTION,
  REPO_STACK,
  EMPTY_STACK,
  EMPTY_DEPS,
  repairsOf,
} from "./__fixtures__/context-kit.ts";
import { index, type Output } from "./outputs.ts";
import type { PackageJson } from "./workspace.ts";

const STACK_ROOT: PackageJson = { dependencies: { "@workerstack/repo": "^1.0.0" } };

function block(rel: string, content: string): Output {
  return { content, kind: "file", managed: "block", path: rel, tracked: true };
}

function link(name: string) {
  return `- [${name}](../node_modules/${name}/references/INDEX.md)`;
}

it("does nothing when the docs pack is off", () => {
  expect(index(context({ files: {}, packages: [API], packs: ["agents"] }))).toStrictEqual({
    errors: [],
    outputs: [],
  });
});

it("creates the file with both sections when it is missing, then each package INDEX with an empty deps one", () => {
  const ctx = context({ files: PACKAGE_INDEXES, manifest: STACK_ROOT, packages: [WEB, API] });
  expect(index(ctx)).toStrictEqual({
    errors: [],
    outputs: [
      block("references/INDEX.md", `# References\n\n${PACKAGES_SECTION}\n\n${REPO_STACK}\n`),
      block("apps/web/references/INDEX.md", `Web app\n\n${EMPTY_DEPS}\n`),
      block("packages/api/references/INDEX.md", `\n\n# API worker\n\nMore.\n\n${EMPTY_DEPS}\n`),
    ],
  });
});

it("writes no packages section in a single-package repo, and keeps empty stack markers", () => {
  expect(index(context()).outputs).toStrictEqual([
    {
      content: `# References\n\n${EMPTY_STACK}\n`,
      kind: "file",
      managed: "block",
      path: "references/INDEX.md",
      tracked: true,
    },
  ]);
});

it("hashes unhashed sections in place in one pass, one line each, and keeps the hand-written text around them", () => {
  const text =
    "# Docs\n\nIntro.\n\n<!-- repo:packages -->\n- stale\n<!-- /repo:packages -->\n\nMiddle.\n\n" +
    "<!-- repo:stack -->\n- stale\n<!-- /repo:stack -->\n\nFooter.\n";

  const files = { ...PACKAGE_INDEXES, "references/INDEX.md": text };
  const ctx = context({ files, manifest: STACK_ROOT, packages: [WEB, API] });
  const content = `# Docs\n\nIntro.\n\n${PACKAGES_SECTION}\n\nMiddle.\n\n${REPO_STACK}\n\nFooter.\n`;
  expect(index(ctx).outputs.slice(0, 1)).toStrictEqual([
    {
      content,
      kind: "file",
      managed: "block",
      path: "references/INDEX.md",
      repairs: ["added the hash to repo:packages", "added the hash to repo:stack"],
      tracked: true,
    },
  ]);

  const again = context({
    files: { ...files, "references/INDEX.md": content },
    manifest: STACK_ROOT,
    packages: [WEB, API],
  });

  expect([contentOf(index(again).outputs[0]), repairsOf(again, "references/INDEX.md")]).toStrictEqual([
    content,
    undefined,
  ]);
});

it("appends absent sections at the end after a blank line", () => {
  const ctx = context({
    files: { ...PACKAGE_INDEXES, "references/INDEX.md": "# Docs\n\nHand-written." },
    manifest: STACK_ROOT,
    packages: [WEB, API],
  });

  expect(index(ctx).outputs.slice(0, 1)).toStrictEqual([
    {
      content: `# Docs\n\nHand-written.\n\n${PACKAGES_SECTION}\n\n${REPO_STACK}\n`,
      kind: "file",
      managed: "block",
      path: "references/INDEX.md",
      tracked: true,
    },
  ]);
});

it("describes a package by its first non-empty INDEX line and links it by name, else by dir", () => {
  const ctx = context({
    files: { "libs/blank/references/INDEX.md": "\n  \n", "libs/heading/references/INDEX.md": "  ## Sub  \n# Top\n" },
    packages: [
      { dir: "libs/blank", manifest: { name: "" } },
      { dir: "libs/heading", manifest: { name: "heading" } },
    ],
  });

  expect(contentOf(index(ctx).outputs[0])).toContain(
    section(
      "packages",
      "- [libs/blank](../libs/blank/references/INDEX.md)\n- [heading](../libs/heading/references/INDEX.md): ## Sub",
    ),
  );
});

it("fails naming each workspace package that has no references/INDEX.md", () => {
  const ctx = context({ files: {}, packages: [WEB, API] });
  expect(index(ctx)).toStrictEqual({
    errors: [
      "apps/web has no references/INDEX.md; every workspace package needs one",
      "packages/api has no references/INDEX.md; every workspace package needs one",
    ],
    outputs: [],
  });
});

it("lists every @workerstack/* dependency of the root and packages once, sorted", () => {
  const ctx = context({
    files: { "packages/api/references/INDEX.md": "API\n" },
    manifest: {
      dependencies: { "@workerstack/repo": "^1.0.0", zod: "^4.0.0" },
      devDependencies: { "@workerstack/lint": "^1.0.0" },
    },
    packages: [
      {
        dir: "packages/api",
        manifest: {
          optionalDependencies: { "@workerstack/ai": "^1.0.0", "@workerstackx/no": "1.0.0" },
          peerDependencies: { "@workerstack/repo": "^1.0.0", "@workerstack/worker": "^1.0.0" },
        },
      },
    ],
  });

  const names = ["@workerstack/ai", "@workerstack/lint", "@workerstack/repo", "@workerstack/worker"];
  expect(contentOf(index(ctx).outputs[0])).toContain(section("stack", names.map(link).join("\n")));
});

it("closes a section opener with no closer, keeping the user's line below it, instead of failing", () => {
  const ctx = context({ files: { "references/INDEX.md": "# Docs\n\n<!-- repo:stack -->\n- mine\n" } });
  expect(index(ctx)).toStrictEqual({
    errors: [],
    outputs: [
      {
        content: `# Docs\n\n${EMPTY_STACK}\n- mine\n`,
        kind: "file",
        managed: "block",
        path: "references/INDEX.md",
        repairs: ["closed repo:stack"],
        tracked: true,
      },
    ],
  });
});

it("repairs a stray closer and a duplicate section, one line each", () => {
  const text = `# Docs\n\n<!-- /repo:stack -->\n\n${EMPTY_STACK}\n\n${EMPTY_STACK}\n`;
  const ctx = context({ files: { "references/INDEX.md": text } });
  expect(contentOf(index(ctx).outputs[0])).toBe(`# Docs\n\n${EMPTY_STACK}\n`);
  expect(repairsOf(ctx, "references/INDEX.md")).toStrictEqual([
    "dropped 1 extra repo:stack",
    "dropped 1 stray marker of repo:stack",
  ]);
});

it("still fails on a missing package INDEX while it repairs an unclosed section", () => {
  const ctx = context({ files: { "references/INDEX.md": "<!-- repo:packages -->\n" }, packages: [API] });
  expect(index(ctx)).toStrictEqual({
    errors: ["packages/api has no references/INDEX.md; every workspace package needs one"],
    outputs: [],
  });
});
