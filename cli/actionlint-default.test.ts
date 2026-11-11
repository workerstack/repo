import path from "node:path";

import { expect, it } from "vitest";

import { fetchArchive, spawnCaptured } from "./actionlint.ts";
import { childEnv } from "./env.ts";

it("fetches the bytes of an archive over http and refuses a failing status", async () => {
  const server = Bun.serve({
    fetch: (request) =>
      new URL(request.url).pathname === "/ok" ? new Response("an archive") : new Response("gone", { status: 404 }),
    port: 0,
  });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    expect(new TextDecoder().decode(await fetchArchive(`${base}/ok`))).toBe("an archive");
    await expect(fetchArchive(`${base}/missing`)).rejects.toThrow(`${base}/missing answered 404`);
  } finally {
    await server.stop(true);
  }
});

it("captures the output and exit code of a command, and a spawn error as stderr", () => {
  const cwd = path.join(import.meta.dirname);
  const run = spawnCaptured(process.execPath, ["-e", 'console.log("out"); console.error("err"); process.exit(3)'], {
    cwd,
    env: childEnv(),
  });
  expect(run).toStrictEqual({ code: 3, stderr: "err\n", stdout: "out\n" });
  const missing = spawnCaptured(path.join(cwd, "no-such-binary"), [], { cwd, env: childEnv() });
  expect(missing.code).toBe(1);
  expect(missing.stdout).toBe("");
  expect(missing.stderr).toContain("no-such-binary");
});

it("reports a command killed by a signal as exit 1", () => {
  const cwd = import.meta.dirname;
  const killed = spawnCaptured(process.execPath, ["-e", "process.kill(process.pid, 9)"], { cwd, env: childEnv() });
  expect(killed.code).toBe(1);
});
