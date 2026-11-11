import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { NAME, mod, put, scene, stateFile } from "./fixtures/link-world.ts";
import { main } from "./link.ts";

const PUBLIC = { name: "@acme/app", dependencies: { [NAME]: "^0.3.0" } };
const refusal = (pkg: string) =>
  `repo link: ${pkg} is public and depends on linked ${NAME}; \`bun repo unlink ${NAME}\` before pushing`;

it("refuses a public root package that depends on a linked package", async () => {
  const w = scene();
  put(w.main, { "package.json": JSON.stringify(PUBLIC) });
  await main([NAME], w.io());
  w.out.length = 0;
  expect(await main(["--pre-push"], w.io())).toBe(1);
  expect(w.err).toStrictEqual([refusal("@acme/app")]);
  expect(w.out).toStrictEqual([]);
});

it("refuses a public workspace package, and not a private one", async () => {
  const w = scene();
  put(w.main, {
    "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
    "packages/web/package.json": JSON.stringify({ name: "@acme/web", devDependencies: { [NAME]: "^0.3.0" } }),
    "packages/internal/package.json": JSON.stringify({
      name: "internal",
      private: true,
      dependencies: { [NAME]: "1" },
    }),
  });
  await main([NAME], w.io());
  expect(await main(["--pre-push"], w.io())).toBe(1);
  expect(w.err).toStrictEqual([refusal("@acme/web")]);
});

it("passes silently for a private dependent, a public one that uses other packages, and no links", async () => {
  const w = scene();
  expect(await main(["--pre-push"], w.io())).toBe(0);
  await main([NAME], w.io());
  expect(await main(["--pre-push"], w.io())).toBe(0);
  put(w.main, { "package.json": JSON.stringify({ name: "@acme/app", dependencies: { zod: "^3" } }) });
  expect(await main(["--pre-push"], w.io())).toBe(0);
  put(w.main, { "package.json": JSON.stringify({ dependencies: { [NAME]: "^0.3.0" } }) });
  expect(await main(["--pre-push"], w.io())).toBe(0);
  expect([w.err, fs.existsSync(mod(w.main))]).toStrictEqual([[], true]);
});

it("refuses from a worktree without an install while main is linked", async () => {
  const w = scene();
  await main([NAME], w.io());
  const tree = path.join(w.base, "repo-wt");
  put(tree, { "package.json": JSON.stringify(PUBLIC) });
  const git = (_cwd: string, args: readonly string[]) =>
    args.includes("--git-common-dir") ? path.join(w.main, ".git") : tree;
  expect(await main(["--pre-push"], w.io({ cwd: tree, git }))).toBe(1);
  expect(w.err).toStrictEqual([refusal("@acme/app")]);
});

it("counts a swapped copy whose state entry was lost", async () => {
  const w = scene();
  put(w.main, { "package.json": JSON.stringify(PUBLIC) });
  await main([NAME], w.io());
  fs.rmSync(stateFile(w.main));
  expect(await main(["--pre-push"], w.io())).toBe(1);
});

it("exits 1 with the reason when the state file is unreadable", async () => {
  const w = scene();
  put(w.main, { ".repo/tmp/links.json": "{" });
  expect(await main(["--pre-push"], w.io())).toBe(1);
  expect(w.err[0]).toMatch(/^repo link: .*links\.json is not a valid link state/);
});

it("exits 1 when this checkout's package.json cannot be read", async () => {
  const w = scene();
  await main([NAME], w.io());
  put(w.main, { "package.json": "{" });
  expect(await main(["--pre-push"], w.io())).toBe(1);
  expect(w.err[0]).toMatch(/^repo link: package\.json: not valid JSON/);
});
