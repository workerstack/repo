import { expect, it } from "vitest";

import { BASE_CONFIG } from "../fixtures/base-config.ts";
import { REPORT_FILE } from "../scripts/ci-skips.constants.ts";
import { release } from "./release.ts";

const output = release({
  config: { agents: { hosts: [], skills: [] }, packs: ["release"], ...BASE_CONFIG },
  read: () => null,
  root: "/repo",
  workspace: { manifest: {}, packages: [], root: "/repo" },
}).outputs[0];
const yaml = output?.kind === "file" ? output.content : "";
const value = (key: string) => new RegExp(`^\\s+(?:- )?${key}: (.+)$`, "m").exec(yaml)?.[1] ?? "";
const glob = (pattern: string) => new RegExp(`^${pattern.replaceAll("*", ".*")}$`);

const INDEX = "${{ strategy.job-index }}";
const RUNNER_OS: Record<string, string> = {
  "macos-latest": "macOS",
  "ubuntu-latest": "Linux",
  "windows-latest": "Windows",
};
/** Each test matrix row's OS in include order; a row's index is its `strategy.job-index`. */
const rows = [...yaml.slice(0, yaml.indexOf("  commits:")).matchAll(/- \{ os: ([^,]+),/g)].map(
  (match) => match[1] ?? "",
);
const expand = (template: string, os: string, index: number) =>
  template
    .replace("${{ runner.os }}", RUNNER_OS[os] ?? "")
    .replace("${{ matrix.os }}", os)
    .replace(INDEX, String(index));

it("each shard's report file name is its own, and one the skips check reads", () => {
  const files = rows.map((os, index) => expand(value("REPORT"), os, index));
  expect(rows).toHaveLength(10);
  expect(new Set(files).size).toBe(rows.length);
  for (const file of files) expect(file).toMatch(REPORT_FILE);
});

it("the uploaded path is the report the gates wrote, and each shard's artifact is its own and matches", () => {
  expect(yaml).toContain(`path: ${value("REPORT")}`);
  const artifact = /name: (ci-report-.*)$/m.exec(yaml)?.[1] ?? "";
  const names = rows.map((os, index) => expand(artifact, os, index));
  expect(new Set(names).size).toBe(rows.length);
  for (const name of names) expect(name).toMatch(glob(value("pattern")));
  expect(yaml).toContain("merge-multiple: true");
});
