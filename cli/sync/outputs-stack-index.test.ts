import { expect, it } from "vitest";

import { context, contentOf, API, PACKAGE_INDEXES, section, installedIndexes } from "./__fixtures__/context-kit.ts";
import { index } from "./outputs.ts";

it("links a stack package only when its installed references index exists, in repo:stack and repo:deps", () => {
  const ctx = context({
    files: { ...PACKAGE_INDEXES, ...installedIndexes("@workerstack/repo") },
    manifest: { dependencies: { "@workerstack/database": "0.24.0", "@workerstack/repo": "^1.0.0" } },
    packages: [
      {
        ...API,
        manifest: {
          ...API.manifest,
          dependencies: { "@workerstack/repo": "^1.0.0" },
          peerDependencies: { "@workerstack/database": "0.24.0" },
        },
      },
    ],
  });

  const [root, api] = index(ctx).outputs;
  expect(contentOf(root)).toContain(
    section("stack", "- [@workerstack/repo](../node_modules/@workerstack/repo/references/INDEX.md)"),
  );
  expect(contentOf(api)).toContain(
    section("deps", `- [@workerstack/repo](../../../node_modules/@workerstack/repo/references/INDEX.md)`),
  );
  expect(`${contentOf(root)}${contentOf(api)}`).not.toContain("@workerstack/database");
});
