/** The fresh-repo case on the shipped tsconfig bases, the vitest preset and the check that keeps them. */
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import type { GetSandbox } from "./get-sandbox.types";
import { expectClean } from "./init-helpers";
import type { Sandbox } from "./sandbox";
import { BROKEN_RUNTIME } from "./sandbox.constants";
import { tail } from "./tail";

/** The consumer tsconfig that extends the shipped bun base. */
const TSCONFIG = { extends: "@workerstack/repo/tsconfig/bun", include: ["src"] };

/** The files the case writes, removed again when it ends. */
const WROTE = ["tsconfig.json", "tsconfig.src.json", "src/main.ts", "vitest.config.ts", "src/a.test.ts"];

/** tsc on the strict base with ts-reset fails one type error and finds every type root. */
async function expectResetTypes(sb: Sandbox) {
  const srcTsconfig = {
    exclude: ["node_modules", "**/*.test.ts"],
    extends: ["./tsconfig.json", "@workerstack/repo/tsconfig/strict"],
  };

  sb.write("tsconfig.json", `${JSON.stringify(TSCONFIG)}\n`);
  sb.write("tsconfig.src.json", `${JSON.stringify(srcTsconfig)}\n`);
  // Pure-marked, so repo(no-module-side-effects) passes and only the type error is left.
  sb.write("src/main.ts", 'export const main: number = /* @__PURE__ */ JSON.parse("1")\n');
  const tsc = await sb.run("bun", [path.join(sb.repo, "node_modules", "typescript", "bin", "tsc"), "-p", "."]);
  expect(tsc.status, tail(tsc.out)).toBe(2);
  expect(tsc.stdout).toContain("src/main.ts(1,14): error TS2322: Type 'unknown' is not assignable to type 'number'.");
  expect(tsc.stdout).not.toContain("TS2688");
}

/** Check refuses a tsconfig "files" that drops the base's reset.d.ts, and passes once it is gone. */
async function expectFilesRefused(sb: Sandbox) {
  sb.write("tsconfig.json", `${JSON.stringify({ ...TSCONFIG, files: [] })}\n`);
  const check = await sb.cli("check");
  expect(check.out, tail(check.out)).not.toMatch(BROKEN_RUNTIME);
  expect(check.status, tail(check.out)).toBe(1);
  expect(check.stderr).toContain(
    'tsconfig: tsconfig.json sets "files", which replaces the base\'s reset.d.ts. List sources under "include".',
  );
  sb.write("tsconfig.json", `${JSON.stringify(TSCONFIG)}\n`);
  expectClean(sb, await sb.cli("check"));
}

/** A project on the shipped vitest preset, run: it runs cleanly; its one test's result is the caller's to read. */
async function vitestPresetRun(sb: Sandbox) {
  expectClean(sb, await sb.run("bun", ["add", "-d", "vitest@^3.2.7"]));
  sb.write(
    "vitest.config.ts",
    'import { defineProject } from "@workerstack/repo/vitest"\n' +
      'export default defineProject({ test: { include: ["src/**/*.test.ts"] } })\n',
  );
  sb.write(
    "src/a.test.ts",
    'import { expect, it } from "vitest"\nimport { answer } from "./index"\n' +
      'it("answers", () => expect(answer).toBe(42))\n',
  );
  const vitest = await sb.run("bunx", ["vitest", "run"], { env: { NO_COLOR: "1" } });
  expectClean(sb, vitest);

  return vitest;
}

/** The tsconfig bases with ts-reset, the vitest preset and the check that keeps the reset. */
export function presetsCase(get: GetSandbox) {
  it("ships tsconfig bases with ts-reset, a vitest preset, and a check that keeps them", async () => {
    const sb = get();
    const pkgBefore = sb.read("package.json");
    const lockBefore = sb.read("bun.lock");

    try {
      await expectResetTypes(sb);
      await expectFilesRefused(sb);
      const vitest = await vitestPresetRun(sb);
      expect(vitest.stdout).toMatch(/Tests\s+1 passed \(1\)/);
    } finally {
      // Leave the tree as init left it, so re-init below still finds nothing to change.
      for (const rel of WROTE) fs.rmSync(path.join(sb.repo, rel), { force: true });
      sb.write("package.json", pkgBefore);
      sb.write("bun.lock", lockBefore);
    }
  });
}
