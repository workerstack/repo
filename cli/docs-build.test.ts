import { expect, it, vi } from "vitest";

import { main } from "./docs.ts";
import { OK, docsRun, fence, json, tempRoot } from "./fixtures/docs-fixture.ts";

const files = (manifest: unknown, example: string): Record<string, string> => ({
  "package.json": json(manifest),
  "references/INDEX.md": "# Index\n- [A](a.md)\n",
  "references/a.md": ["# A", fence("ts", example)].join("\n"),
});

it("builds a package before checking examples that import its name, when it has a build script", async () => {
  const manifest = { name: "@ws/app", private: true, scripts: { build: "bun build" } };
  const root = tempRoot(files(manifest, 'import "@ws/app/vitest";'));
  const bun = vi.fn(() => OK);
  expect(await main(["--check"], docsRun(root, { bun }).io)).toBe(0);
  expect(bun).toHaveBeenCalledWith(["run", "build"], root);
});

it("never builds a nameless manifest", async () => {
  const root = tempRoot(files({ private: true, scripts: { build: "bun build" } }, 'import "";'));
  const bun = vi.fn(() => OK);
  expect(await main(["--check"], docsRun(root, { bun }).io)).toBe(0);
  expect(bun).not.toHaveBeenCalled();
});

it("never builds a manifest whose scripts field is not an object", async () => {
  const root = tempRoot(files({ name: "@ws/app", private: true, scripts: null }, 'import "@ws/app";'));
  const bun = vi.fn(() => OK);
  expect(await main(["--check"], docsRun(root, { bun }).io)).toBe(0);
  expect(bun).not.toHaveBeenCalled();
});
