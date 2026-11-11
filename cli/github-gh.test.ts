import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { removePlanted, tempDir } from "./__fixtures__/planted-repo.ts";
import { applyFailure, ghRunner, skipReason, type GhFailure } from "./github-gh.ts";

afterEach(removePlanted);

/** A stand-in for `gh` that bun runs: it answers by the API path it is asked for. */
const FAKE_GH = `
const args = process.argv.slice(2);
const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
if (path.endsWith("/slow")) await new Promise((resolve) => setTimeout(resolve, 60000));
if (path.endsWith("/auth")) {
  console.error("To get started with GitHub CLI, please run:  gh auth login");
  process.exit(4);
}
if (path.endsWith("/denied")) { console.error("gh: Forbidden (HTTP 403)\\nmore"); process.exit(1); }
if (path.endsWith("/boom")) process.exit(2);
const stdin = args.includes("--input") ? await Bun.stdin.text() : null;
console.log(JSON.stringify({ args, stdin }));
`;

function runner(timeoutMs?: number) {
  const dir = tempDir();
  const script = path.join(dir, "fake-gh.ts");
  fs.writeFileSync(script, FAKE_GH);
  return ghRunner({ command: [process.execPath, script], ...(timeoutMs === undefined ? {} : { timeoutMs }) });
}

it("runs `gh api` with the path, and sends no body for a GET", async () => {
  const result = await runner()({ method: "GET", path: "repos/o/r" });
  expect(result.ok && JSON.parse(result.stdout)).toStrictEqual({ args: ["api", "repos/o/r"], stdin: null });
});

it("sends the method and the JSON body on stdin", async () => {
  const result = await runner()({ body: { names: ["a"] }, method: "PUT", path: "repos/o/r/topics" });
  expect(result.ok && JSON.parse(result.stdout)).toStrictEqual({
    args: ["api", "-X", "PUT", "repos/o/r/topics", "--input", "-"],
    stdin: '{"names":["a"]}',
  });
});

it("sends no body for a PUT that has none", async () => {
  const result = await runner()({ method: "PUT", path: "repos/o/r/vulnerability-alerts" });
  const args = ["api", "-X", "PUT", "repos/o/r/vulnerability-alerts"];
  expect(result.ok && JSON.parse(result.stdout)).toStrictEqual({ args, stdin: null });
});

it("reads gh's exit 4 as not logged in", async () => {
  expect(await runner()({ method: "GET", path: "repos/o/auth" })).toStrictEqual({
    kind: "auth",
    message: "gh is not logged in (gh auth status)",
    ok: false,
  });
});

it("reads the HTTP status of a refusal, with the first line of gh's message", async () => {
  expect(await runner()({ method: "GET", path: "repos/o/denied" })).toStrictEqual({
    kind: "http",
    message: "gh: Forbidden (HTTP 403)",
    ok: false,
    status: 403,
  });
});

it("names any other failure by its exit code", async () => {
  expect(await runner()({ method: "GET", path: "repos/o/boom" })).toStrictEqual({
    kind: "other",
    message: "gh exited with 2",
    ok: false,
  });
});

it("gives up on a gh that never answers once its own timeout has passed", async () => {
  const started = Date.now();
  expect(await runner(200)({ method: "GET", path: "repos/o/slow" })).toStrictEqual({
    kind: "timeout",
    message: "gh did not answer within 0.2s",
    ok: false,
  });
  expect(Date.now() - started).toBeLessThan(5000);
});

it("says gh is not installed when it cannot be started", async () => {
  const result = await ghRunner({ command: ["/no/such/gh"] })({ method: "GET", path: "repos/o/r" });
  expect(result).toMatchObject({ kind: "missing", ok: false });
  expect(!result.ok && result.message).toMatch(/^gh is not installed/);
});

function failure(kind: GhFailure["kind"], message: string, status?: number): GhFailure {
  return {
    kind,
    message,
    ok: false,
    ...(status === undefined ? {} : { status }),
  };
}

it("blames the token for a refusal and otherwise says what gh said", () => {
  for (const status of [401, 403, 404])
    expect(skipReason(failure("http", "x", status))).toBe("CI's token cannot read admin settings");

  expect(skipReason(failure("http", "gh: Server Error (HTTP 500)", 500))).toBe("gh: Server Error (HTTP 500)");
  expect(skipReason(failure("timeout", "gh did not answer within 5s"))).toBe("gh did not answer within 5s");
});

it("names what failed on the repo and what to do about it", () => {
  expect(applyFailure("o/r", failure("http", "x", 403), "change")).toBe(
    "gh cannot change o/r's settings (HTTP 403): log in as an admin with `gh auth login`",
  );
  expect(applyFailure("o/r", failure("auth", "x"), "read")).toBe(
    "gh cannot read o/r's settings (not logged in): log in as an admin with `gh auth login`",
  );
  expect(applyFailure("o/r", failure("other", "boom"), "change")).toBe(
    "gh cannot change o/r's settings (boom): try again",
  );
});
