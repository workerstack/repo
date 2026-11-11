import http from "node:http";

import { afterEach, expect, it } from "vitest";

import {
  cleanBrowser,
  exec,
  failure,
  holder,
  listen,
  live,
  NO_SESSION,
  plant,
  readStored,
  REFS,
  tmp,
} from "./fixtures/browser-kit.ts";

afterEach(cleanBrowser);

it("reports an engine that answers without a websocket as a failure, not a stack", async () => {
  const cwd = tmp("browser-nows-");
  const port = await listen(http.createServer((_req, res) => res.end("{}")));
  plant(cwd, { engine: "lightpanda", lastRefs: REFS, pid: holder(), port });
  expect(await exec(cwd, ["snap"])).toStrictEqual(failure("engine not ready\n"));
});

it("treats a missing, unreadable or malformed session as no session", async () => {
  const pid = holder();
  const bad = [
    "{",
    "[]",
    "null",
    '"text"',
    JSON.stringify({ engine: "firefox", pid, port: 1 }),
    JSON.stringify({ engine: "lightpanda", pid, port: "abc" }),
    JSON.stringify({ engine: "lightpanda", pid: String(pid), port: 1 }),
    JSON.stringify({ engine: "lightpanda", port: 1 }),
  ];
  const stderrs = await Promise.all(
    bad.map((raw) => {
      const cwd = tmp("browser-bad-");
      plant(cwd, raw);
      return exec(cwd, ["snap"]).then((r) => r.stderr);
    }),
  );
  expect(stderrs).toStrictEqual(bad.map(() => NO_SESSION));
  expect((await exec(tmp("browser-bad-none-"), ["snap"])).stderr).toBe(NO_SESSION);
});

it("fills in defaults for missing fields and drops junk refs when it rewrites the session", async () => {
  const t = await live();
  const lastRefs = {
    "1": { backendNodeId: 10 },
    "2": "junk",
    "3": null,
    "4": [1],
  };
  plant(t.cwd, { engine: "chromium", lastRefs, pid: holder(), port: t.port });
  expect((await exec(t.cwd, ["hover", "1"])).stdout).toBe("hover: 1\n");
  const s = readStored(t.cwd);
  expect(s).toMatchObject({
    engine: "chromium",
    escalated: false,
    lastURL: "",
    swapCount: 0,
  });
  expect(s.lastRefs).toStrictEqual({
    "1": { backendNodeId: 10, name: "", role: "" },
  });
});

it("keeps escalated and a numeric swapCount, and reads a numeric string as a number", async () => {
  const t = await live({ engine: "chromium", escalated: true, swapCount: "2" });
  await exec(t.cwd, ["hover", "1"]);
  expect(readStored(t.cwd)).toMatchObject({ escalated: true, swapCount: 2 });
  plant(t.cwd, {
    engine: "chromium",
    escalated: "yes",
    lastRefs: REFS,
    pid: holder(),
    port: t.port,
    swapCount: "many",
  });
  await exec(t.cwd, ["hover", "1"]);
  expect(readStored(t.cwd)).toMatchObject({ escalated: false, swapCount: 0 });
});
