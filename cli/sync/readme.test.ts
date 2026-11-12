import { expect, it } from "vitest";

import { context, PUBLIC, textOf } from "./__fixtures__/readme-kit.ts";
import { GENERATORS } from "./outputs.ts";
import { readme } from "./readme.ts";
import type { PackageJson } from "./workspace.ts";

/** The README text a single public root generates; fails when the generator reports an error. */
function render(files: Record<string, string>, manifest: PackageJson = PUBLIC): string {
  const result = readme(context({ files, manifest }));
  expect(result.errors).toStrictEqual([]);

  return textOf(result);
}

const INDEX = "# References\n\n- [Auth](auth.md)\n- [Hooks](hooks.md)\n";

it("is registered right after index", () => {
  expect(GENERATORS.indexOf(readme)).toBe(2);
});

it(
  "writes a whole, tracked README.md with line 1 left for the header, " +
    "then name, description and contents in INDEX order",
  () => {
    const files = {
      "package.json": JSON.stringify({ description: "A library.", name: "@acme/lib" }),
      "references/INDEX.md": INDEX,
      "references/auth.md": "# Authentication\n\nLog in.\n",
      "references/hooks.md": "# Hooks\n\nRun them.\n",
    };

    expect(readme(context({ files }))).toStrictEqual({
      errors: [],
      outputs: [
        {
          content:
            "\n# @acme/lib\n\nA library.\n\n## Contents\n\n- [Authentication](#authentication)\n- [Hooks](#hooks)\n" +
            "\n## Authentication\n\nLog in.\n\n## Hooks\n\nRun them.\n",
          kind: "file",
          managed: "whole",
          path: "README.md",
          tracked: true,
        },
      ],
    });
  },
);

it("leaves out the description when package.json has none, is unreadable or is missing", () => {
  const base = { "references/INDEX.md": "- [A](a.md)\n", "references/a.md": "# A\n" };
  const expected = `\n# @acme/lib\n\n## Contents\n\n- [A](#a)\n\n## A\n`;
  expect(render({ ...base, "package.json": '{"name":"@acme/lib"}' })).toBe(expected);
  expect(render({ ...base, "package.json": "{" })).toBe(expected);
  expect(render({ ...base, "package.json": '{"description":3}' })).toBe(expected);

  for (const json of ["[]", "3", "null"]) expect(render({ ...base, "package.json": json })).toBe(expected);
  expect(render(base)).toBe(expected);
});

it("is byte for byte stable and ends with one newline", () => {
  const files = {
    "references/INDEX.md": INDEX,
    "references/auth.md": "# A\n\n\ntext\n\n\n",
    "references/hooks.md": "# H",
  };

  const first = render(files);
  expect(render(files)).toBe(first);
  expect(first.endsWith("text\n\n## H\n")).toBe(true);
});

it("demotes every heading one level except inside fenced blocks, capped at six", () => {
  const files = {
    "references/INDEX.md": "- [A](a.md)\n",
    "references/a.md":
      "# A\n\n## Sub\n\n###### Deep\n\n# Second h1\n\n```md\n# not a heading\n## nor this\n```\n" +
      "\n    # indented is no heading\n",
  };

  expect(render(files)).toContain(
    "## A\n\n### Sub\n\n###### Deep\n\n## Second h1\n\n```md\n# not a heading\n## nor this\n```\n" +
      "\n    # indented is no heading\n",
  );
});

it("labels a file without an H1 by its file name and keeps its text", () => {
  const files = { "references/INDEX.md": "- [x](notes.md)\n", "references/notes.md": "Just text.\n\n## Part\n" };
  expect(render(files)).toContain("- [notes](#notes)\n\n## notes\n\nJust text.\n\n### Part\n");
  expect(render({ ...files, "references/notes.md": "# E\n" }).endsWith("## E\n")).toBe(true);
});

it("gives duplicate headings -1 and -2 anchors, with the title and Contents taking theirs first", () => {
  const files = {
    "references/INDEX.md": "- [a](a.md)\n- [b](b.md)\n- [c](c.md)\n",
    "references/a.md": "# Setup\n\n## Contents\n",
    "references/b.md": "# Setup\n",
    "references/c.md": "# Setup\n",
  };

  expect(render(files)).toContain("- [Setup](#setup)\n- [Setup](#setup-1)\n- [Setup](#setup-2)\n");
  expect(render(files, { name: "Setup", private: false })).toContain(
    "- [Setup](#setup-1)\n- [Setup](#setup-2)\n- [Setup](#setup-3)\n",
  );
  const mine = { ...files, "references/a.md": "# Setup\n\n[c](#contents)\n\n## Contents\n" };
  expect(render(mine)).toContain("[c](#contents-1)");
});

it("makes GitHub-style anchors: lowercase, punctuation dropped but - and _, spaces to -", () => {
  const files = {
    "references/INDEX.md": "- [a](a.md)\n- [b](b.md)\n",
    "references/a.md": "# The `repo` CLI: what's [new](x.md)? v2_x-y\n",
    "references/b.md": "# Über  Größe\n",
  };

  const text = render(files);
  expect(text).toContain("](#the-repo-cli-whats-new-v2_x-y)");
  expect(text).toContain("](#über--größe)");
});

it("turns a link to a glued file into its anchor, mapping a fragment when it can", () => {
  const files = {
    "references/INDEX.md": "- [a](a.md)\n- [b](b.md)\n",
    "references/a.md":
      "# A\n\nSee [b](b.md), [its part](b.md#part), [gone](b.md#nope), " +
      "[self](#mine) and [lost](#nowhere).\n\n## Mine\n",
    "references/b.md": "# B\n\n## Part\n\n## Part\n\n[again](b.md#part-1)\n",
  };

  const text = render(files);
  expect(text).toContain("See [b](#b), [its part](#part), [gone](#b), [self](#mine) and [lost](#nowhere).");
  expect(text).toContain("[again](#part-1)");
});

it("maps a fragment to the global anchor when another file took the heading first", () => {
  const files = {
    "references/INDEX.md": "- [a](a.md)\n- [b](b.md)\n",
    "references/a.md": "# A\n\n## Usage\n",
    "references/b.md": "# B\n\n## Usage\n\n[a](a.md#usage) [me](#usage)\n",
  };

  expect(render(files)).toContain("[a](#usage) [me](#usage-1)");
});

it("rewrites another relative link to the README's folder and leaves external ones alone", () => {
  const files = {
    "references/INDEX.md": "- [a](a.md)\n",
    "references/a.md":
      "# A\n\n[src](../src/a.ts#L3) [idx](INDEX.md) [web](https://x.dev/a.md) [abs](/x) [mail](mailto:a@b.c) " +
      '[q](?x=1) [home](../) ![img](img/p.png "t")\n\n```md\n[no](b.md)\n```\n',
  };

  expect(render(files)).toContain(
    "[src](src/a.ts#L3) [idx](references/INDEX.md) [web](https://x.dev/a.md) [abs](/x) [mail](mailto:a@b.c) " +
      '[q](?x=1) [home](.) ![img](references/img/p.png "t")\n\n```md\n[no](b.md)\n```\n',
  );
});
