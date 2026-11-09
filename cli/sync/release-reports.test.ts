import { BASE_CONFIG } from "../fixtures/base-config.ts";
import { expect, it } from "vitest";
import { REPORT_FILE } from "../scripts/ci-skips.constants.ts";
import { release } from "./release.ts";

const output = release({
  root: "/repo",
  config: { packs: ["release"], agents: { hosts: [], skills: [] }, ...BASE_CONFIG },
  workspace: { root: "/repo", manifest: {}, packages: [] },
  read: () => null,
}).outputs[0];
const yaml = output?.kind === "file" ? output.content : "";
const value = (key: string) => new RegExp(`^\\s+(?:- )?${key}: (.+)$`, "m").exec(yaml)?.[1] ?? "";
const glob = (pattern: string) => new RegExp(`^${pattern.replaceAll("*", ".*")}$`);

it("each OS's report file name is one the skips check reads", () => {
  const file = value("REPORT");
  for (const os of ["Linux", "Windows", "macOS"]) {
    expect(file.replace("${{ runner.os }}", os)).toMatch(REPORT_FILE);
  }
});

it("the uploaded path is the report the gates wrote, and each matrix artifact matches the download pattern", () => {
  expect(yaml).toContain(`path: ${value("REPORT")}`);
  const pattern = value("pattern");
  for (const os of ["ubuntu-latest", "windows-latest", "macos-latest"]) {
    expect(`ci-report-${os}`).toMatch(glob(pattern));
  }
  expect(yaml).toContain("name: ci-report-${{ matrix.os }}");
  expect(yaml).toContain("merge-multiple: true");
});
