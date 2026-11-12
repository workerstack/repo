import { expect, it, vi } from "vitest";

import { OK, docsRun, fence, json, tempRoot } from "./__fixtures__/docs-fixture.ts";
import { main } from "./docs.ts";

function files(manifest: unknown, example: string): Record<string, string> {
  return {
    "package.json": json(manifest),
    "references/INDEX.md": "# Index\n- [A](a.md)\n",
    "references/a.md": ["# A", fence("ts", example)].join("\n"),
  };
}

it("builds a package before checking examples that import its name, when it has a build script", async () => {
  const manifest = { name: "@ws/app", private: true, scripts: { build: "bun build" } };
  const root = tempRoot(files(manifest, 'import "@ws/app/vitest";'));
  const bun = vi.fn<() => typeof OK>(() => OK);
  expect(await main(["--check"], docsRun(root, { bun }).io)).toBe(0);
  expect(bun).toHaveBeenCalledWith(["run", "build"], root);
});

/** Checks a package with `manifest` and `example`; the exit code and the build runner. */
async function checked(manifest: unknown, example: string) {
  const root = tempRoot(files(manifest, example));
  const bun = vi.fn<() => typeof OK>(() => OK);
  const code = await main(["--check"], docsRun(root, { bun }).io);

  return { bun, code };
}

it("never builds a nameless manifest", async () => {
  const { bun, code } = await checked({ private: true, scripts: { build: "bun build" } }, 'import "";');
  expect(code).toBe(0);
  expect(bun).not.toHaveBeenCalled();
});

it("never builds a manifest whose scripts field is not an object", async () => {
  const { bun, code } = await checked({ name: "@ws/app", private: true, scripts: null }, 'import "@ws/app";');
  expect(code).toBe(0);
  expect(bun).not.toHaveBeenCalled();
});
