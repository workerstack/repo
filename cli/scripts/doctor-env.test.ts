import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, it } from "vitest";

import { doctorCli, tmp } from "./fixtures/doctor-kit.ts";
import { loadOptionalConsumerEnv } from "./load-optional-consumer-env.ts";

function baseIn(dir: string): string {
  return pathToFileURL(path.join(dir, "cli", "scripts", "dummy.mjs")).href;
}

/** A consumer dir whose `scripts/lib/env.mjs` holds `body`. */
function consumer(prefix: string, body: string): string {
  const dir = tmp(prefix);
  fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "lib", "env.mjs"), body);
  return dir;
}

it("loadOptionalConsumerEnv no-ops when lib/env.mjs is missing", async () => {
  const dir = tmp("opt-env-miss-");
  expect(await loadOptionalConsumerEnv(baseIn(dir))).toBe(false);
});

it("loadOptionalConsumerEnv calls loadEnv when present", async () => {
  const marker = path.join(tmp("opt-env-mark-"), "marker.txt");
  const dir = consumer(
    "opt-env-hit-",
    `import fs from "node:fs";
export function loadEnv() { fs.writeFileSync(${JSON.stringify(marker)}, "ok"); }
`,
  );
  expect(await loadOptionalConsumerEnv(baseIn(dir))).toBe(true);
  expect(fs.readFileSync(marker, "utf8")).toBe("ok");
});

it("loadOptionalConsumerEnv imports a module that does not export loadEnv", async () => {
  const dir = consumer("opt-env-noload-", `export const x = 1;\n`);
  expect(await loadOptionalConsumerEnv(baseIn(dir))).toBe(true);
});

it("loadOptionalConsumerEnv propagates a thrown import", async () => {
  const dir = consumer("opt-env-boom-", `throw new Error("env-boom");\n`);
  await expect(loadOptionalConsumerEnv(baseIn(dir))).rejects.toThrow(/env-boom/);
});

it("doctor cli: main empty PATH exits 1", () => {
  const cwd = tmp("doc-cli-");
  const r = doctorCli(cwd, { PATH: "/nonexistent-repo-doctor" });
  expect(r.status).toBe(1);
  expect(`${r.stdout}${r.stderr}`).toMatch(/missing/);
  expect(`${r.stdout}${r.stderr}`).not.toMatch(/playwright install/);
});
