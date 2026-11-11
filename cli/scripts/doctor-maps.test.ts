import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import {
  BOTH_MARKERS,
  linuxRun,
  toolsCwd,
  writeRequiredMaps,
  writeSelfPackage,
  writeSkillPair,
} from "./__fixtures__/doctor-kit.ts";

it("tools ok, not this package → skip maps; exit 0; no INDEX missing", () => {
  const { cwd, bin } = toolsCwd("doc-nomaps-");
  const r = linuxRun(cwd, bin);
  expect(r.code).toBe(0);
  expect(r.stdout).not.toMatch(/^maps /m);
  expect(r.stdout).not.toMatch(/maps missing/);
});

it("consumer with .agents/skills and no references/ gets no maps row", () => {
  const { cwd, bin } = toolsCwd("doc-consumer-");
  writeSelfPackage(cwd, "some-consumer");
  fs.mkdirSync(path.join(cwd, ".agents", "skills"), { recursive: true });
  const r = linuxRun(cwd, bin);
  expect(r.code).toBe(0);
  expect(r.stdout).not.toMatch(/^maps /m);
});

it("@workerstack/repo with both markers → maps ok row, exit 0", () => {
  const { cwd, bin } = toolsCwd("doc-maps-ok-");
  writeRequiredMaps(cwd);
  const r = linuxRun(cwd, bin);
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/^maps\s+ok\s+references\/INDEX\.md repo:skills, repo:refs$/m);
});

it("@workerstack/repo with the hashed markers sync writes → maps ok row, exit 0", () => {
  const { cwd, bin } = toolsCwd("doc-maps-hashed-");
  writeRequiredMaps(cwd, BOTH_MARKERS.replaceAll(/<!-- repo:(\w+) -->/g, "<!-- repo:$1 e3b0c442 -->"));
  const r = linuxRun(cwd, bin);
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/^maps\s+ok\s+references\/INDEX\.md repo:skills, repo:refs$/m);
});

it.each(["skills", "refs"])("@workerstack/repo missing repo:%s → exit 1 naming it", (name) => {
  const { cwd, bin } = toolsCwd("doc-map-one-");
  writeRequiredMaps(cwd, BOTH_MARKERS.replace(`<!-- repo:${name} -->\n<!-- /repo:${name} -->\n`, ""));
  const r = linuxRun(cwd, bin);
  expect(r.code).toBe(1);
  expect(r.stdout).toContain(`references/INDEX.md has no repo:${name} section; run bun repo sync`);
  expect(r.stdout).toMatch(/^maps\s+missing/m);
});

it("@workerstack/repo without references/INDEX.md → exit 1", () => {
  const { cwd, bin } = toolsCwd("doc-map-none-");
  writeSelfPackage(cwd);
  const r = linuxRun(cwd, bin);
  expect(r.code).toBe(1);
  expect(r.stdout).toMatch(/^maps\s+missing\s+references\/INDEX\.md is missing; run bun repo sync$/m);
});

it("skill content conflict vs packaged warns; exit still 0 when tools+maps ok", () => {
  const { cwd, bin } = toolsCwd("doc-sk-conflict-");
  writeRequiredMaps(cwd);
  writeSkillPair(cwd, "custom\n", "packaged\n");
  const r = linuxRun(cwd, bin);
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/skill conflicts \(warn/);
  expect(r.stdout).toMatch(/skill `parent` differs from packaged repo; re-init overwrites/);
});

it("identical packaged skill → no conflict lines", () => {
  const { cwd, bin } = toolsCwd("doc-sk-same-");
  writeRequiredMaps(cwd);
  writeSkillPair(cwd, "same\n", "same\n");
  const r = linuxRun(cwd, bin);
  expect(r.code).toBe(0);
  expect(r.stdout).not.toMatch(/skill conflicts/);
});
