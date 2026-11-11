import path from "node:path";
import { expect, it, vi } from "vitest";
import { docsRun, fence, json, packed, publicManifest, tempRoot } from "./fixtures/docs-fixture.ts";
import { main } from "./docs.ts";

const DEMO = publicManifest("@workerstack/demo", { ".": "./i.ts", "./lint": "./l.ts" }).replace(
  ',"./references/*":"./references/*"',
  "",
);
const AUTH = [
  "# Auth",
  "[dep](../node_modules/@workerstack/backend/references/INDEX.md)",
  fence("ts", "const a = 1;"),
  fence("ts run", "const s = { tokn: 1 };"),
  fence("json", "{}"),
].join("\n");
const BROKEN = {
  "package.json": DEMO,
  "references/INDEX.md": '# Index\n- [Auth](auth.md)\n- [Gone](missing.md)\nUse "@workerstack/demo".\n',
  "references/extra.md": "# Extra\n",
  "references/auth.md": AUTH,
};
const TSC_ERROR = "references\\auth.md-2.ts(1,7): error TS2339: Property 'tokn' does not exist on type 'Session'.\n";

it("prints the ok line when the references hold up", async () => {
  const root = tempRoot({
    "package.json": publicManifest("@workerstack/demo", { ".": "./i.ts" }),
    "references/INDEX.md": "# Index\n- [Auth](auth.md)\n",
    "references/auth.md": ["# Auth", 'Use "@workerstack/demo".', fence("ts", "const a = 1;")].join("\n"),
  });
  const run = docsRun(root, { pack: () => packed("references/INDEX.md", "references/auth.md") });
  expect(await main(["--check"], run.io)).toBe(0);
  expect(run.out).toStrictEqual(["docs ok: 2 references, 1 examples, 1 exports, tarball holds references/\n"]);
  expect(run.err).toStrictEqual([]);
  expect(run.synced).toStrictEqual([]);
});

it("prints every finding with its line and exits 1", async () => {
  const run = docsRun(tempRoot(BROKEN), {
    pack: () => packed("references/INDEX.md"),
    tsc: () => ({ code: 2, stdout: TSC_ERROR, stderr: "" }),
    bun: () => ({ code: 1, stdout: "", stderr: "Error: boom\n" }),
  });
  expect(await main(["--check"], run.io)).toBe(1);
  expect(run.err).toStrictEqual([
    "references/extra.md is not listed in references/INDEX.md; add a line that links it\n",
    "references/INDEX.md:3: links missing.md, which does not exist\n",
    "references/auth.md:2: links ../node_modules/@workerstack/backend/references/INDEX.md, but @workerstack/backend is not installed; add it or drop the link\n",
    "references/auth.md:7: example 2 fails to type-check: Property 'tokn' does not exist on type 'Session'.\n",
    "references/auth.md:6: example 2 fails to run (exit 1): Error: boom\n",
    "@workerstack/demo/lint is exported but no reference names it; document it in references/\n",
    'package.json has no "./references/*" export; add "./references/*": "./references/*"\n',
    'references/auth.md is listed in references/INDEX.md but not in the packed tarball; add "references" to files in package.json\n',
  ]);
  expect(run.out).toStrictEqual([]);
});

it("skips the export and tarball checks of a private manifest", async () => {
  const root = tempRoot({
    "package.json": json({ name: "app", private: true, exports: { ".": "./i.ts" } }),
    "references/INDEX.md": "# Index\n- [A](a.md)\n",
    "references/a.md": "# A\n",
  });
  const pack = vi.fn(() => packed());
  const run = docsRun(root, { pack });
  expect(await main(["--check"], run.io)).toBe(0);
  expect(run.out).toStrictEqual(["docs ok: 2 references, 0 examples, 0 exports\n"]);
  expect(pack).not.toHaveBeenCalled();
});

it("prefixes each package's paths with its folder, and checks only the roots with an INDEX", async () => {
  const root = tempRoot({
    "package.json": json({ name: "mono", private: true, workspaces: ["packages/*"] }),
    "packages/a/package.json": publicManifest("@ws/a", { ".": "./a.ts" }),
    "packages/a/references/INDEX.md": "# A\n- [x](x.md)\n",
    "packages/a/references/x.md": '# X\n"@ws/a"\n[b](nope.md)\n',
    "packages/b/package.json": publicManifest("@ws/b", { ".": "./b.ts", "./extra": "./e.ts" }),
    "packages/b/references/INDEX.md": "# B\n",
    "packages/b/references/y.md": "# Y\n",
    "packages/c/package.json": json({ name: "@ws/c", private: false }),
  });
  const run = docsRun(root, {
    pack: (cwd) => packed("references/INDEX.md", path.basename(cwd) === "a" ? "references/x.md" : ""),
  });
  expect(await main(["--check"], run.io)).toBe(1);
  expect(run.err).toStrictEqual([
    "packages/a/references/x.md:3: links nope.md, which does not exist\n",
    "packages/b/references/y.md is not listed in packages/b/references/INDEX.md; add a line that links it\n",
    "@ws/b is exported but no reference names it; document it in packages/b/references/\n",
    "@ws/b/extra is exported but no reference names it; document it in packages/b/references/\n",
  ]);
});

it("finds the doc roots from the nearest workerstack.config.ts", async () => {
  const root = tempRoot({
    "workerstack.config.ts": "",
    "package.json": json({ name: "app", private: true }),
    "references/INDEX.md": "# Index\n",
    "sub/.keep": "",
  });
  const run = docsRun(`${root}/sub`);
  expect(await main(["--check"], run.io)).toBe(0);
  expect(run.out).toStrictEqual(["docs ok: 1 references, 0 examples, 0 exports\n"]);
});

it("is ok in a folder without references, and reports a manifest it cannot read", async () => {
  const none = docsRun(tempRoot({ "package.json": "{}" }));
  expect(await main(["--check"], none.io)).toBe(0);
  expect(none.out).toStrictEqual(["docs ok: 0 references, 0 examples, 0 exports\n"]);
  const bad = docsRun(tempRoot({ "package.json": "{" }));
  expect(await main(["--check"], bad.io)).toBe(1);
  expect(bad.err.join("")).toMatch(/package\.json/);
});
