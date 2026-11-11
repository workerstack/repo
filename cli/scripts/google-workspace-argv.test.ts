import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { bunPath } from "../../dev/test-paths";
import { accountContext } from "./google-workspace-account.ts";
import { loginArgs } from "./google-workspace-auth.ts";
import { parseCsv } from "./google-workspace-files.ts";
import { EXTRA_SCOPES } from "./google-workspace.constants.ts";
import { parseArgv } from "./google-workspace.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoCli = path.join(here, "..", "..", "bin", "repo.ts");

it("parseArgv: reads verb noun and flags", () => {
  expect(parseArgv(["sheet", "create", "--title", "Q3", "--csv", "a,b"])).toStrictEqual({
    _: ["sheet", "create"],
    flags: { csv: "a,b", title: "Q3" },
  });
});

it("parseArgv: parses --account", () => {
  expect(parseArgv(["--account", "work", "whoami"])).toStrictEqual({
    _: ["whoami"],
    flags: { account: "work" },
  });
});

it("parseArgv: treats bare --flag as set and stops at --", () => {
  expect(parseArgv(["drive", "list", "--n", "3", "--"])).toStrictEqual({
    _: ["drive", "list"],
    flags: { n: "3" },
  });
  expect(parseArgv(["mail", "list", "--q", "from:a", "--"])).toStrictEqual({
    _: ["mail", "list"],
    flags: { q: "from:a" },
  });
  expect(parseArgv(["whoami", "--clip"])).toStrictEqual({
    _: ["whoami"],
    flags: { clip: "1" },
  });
});

it("parseArgv: parseCsv splits rows", () => {
  expect(parseCsv("a,b\n1,2\n")).toStrictEqual([
    ["a", "b"],
    ["1", "2"],
  ]);
  expect(parseCsv("")).toStrictEqual([]);
});

it("parseArgv: rejects a bad account id", () => {
  expect(() => accountContext("../x")).toThrow(/bad --account/);
  expect(accountContext("work").id).toBe("work");
});

it("loginArgs: passes extra Workspace scopes to clasp login", () => {
  const args = loginArgs();
  expect(args[0]).toBe("login");
  expect(args[1]).toBe("--extra-scopes");
  expect(args[2]).toContain("https://www.googleapis.com/auth/spreadsheets");
  expect(args[2]).toContain("https://www.googleapis.com/auth/gmail.send");
  expect(EXTRA_SCOPES.length).toBeGreaterThan(5);
});

it("google-workspace cli: no args prints usage and exits 1", () => {
  const r = spawnSync(bunPath(), [repoCli, "google-workspace"], {
    encoding: "utf8",
    timeout: 15_000,
  });
  expect(r.status).toBe(1);
  expect(String(r.stderr)).toContain("usage: google-workspace");
});
