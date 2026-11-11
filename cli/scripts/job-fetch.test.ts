import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { bunPath } from "../../dev/test-paths";
import { plant, useJobEnv } from "./fixtures/job-kit.ts";
import { runFetch, stripHtml } from "./job-fetch.ts";
import { runJob } from "./job.ts";

useJobEnv();

const serverScript = fileURLToPath(new URL("./fixtures/job-http-server.ts", import.meta.url));
let server: ChildProcess;
let base = "";

// runFetch blocks its caller while it waits, so the server it fetches from runs in its own process.
beforeAll(async () => {
  server = spawn(bunPath(), [serverScript], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise<string>((resolve) => {
    server.stdout?.once("data", (chunk) => resolve(String(chunk).trim()));
  });
  base = `http://127.0.0.1:${port}`;
});
afterAll(() => {
  server.kill();
});

const fetchIn = (dir: string, url: string, timeoutMs?: number) =>
  runFetch(url, { cwd: dir, root: dir, ...(timeoutMs ? { timeoutMs } : {}) });

/** A 127.0.0.1 port nothing listens on. */
async function closedPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return typeof address === "object" && address ? address.port : 0;
}

it("runFetch lists the title and the sentences of a page without its markup", () => {
  const r = fetchIn(plant(), `${base}/page`);
  expect(r).toStrictEqual({
    fallback: false,
    text: "4 lines.\n- Demo page\n- Demo page First & second.\n- Third <ok>.\n- Fourth sentence.\n",
    code: 0,
  });
});

it("runFetch says (empty) for a page with no text", () => {
  expect(fetchIn(plant(), `${base}/empty`).text).toBe("1 line.\n- (empty)\n");
});

it("runFetch stashes a page and marks it cut off when it passes the stash cap", () => {
  const dir = plant();
  const text = fetchIn(dir, `${base}/big`).text;
  const ref = /stash=(\S+)/.exec(text)?.[1] ?? "";
  expect(text.split("\n")[0]).toMatch(/^\d+\+ lines, 6 shown\. stash=/);
  expect(fs.statSync(path.join(dir, ref)).size).toBeGreaterThan(2 * 1024 * 1024 - 1);
});

it("runFetch reports a refused connection as a failure", async () => {
  const port = await closedPort();
  const r = fetchIn(plant(), `http://127.0.0.1:${port}/`);
  expect(r.fallback).toBe(false);
  expect(r.text).toMatch(/^Command failed\.\n- \S/);
});

it("runFetch says the fetch failed when the server never answers", () => {
  const r = fetchIn(plant(), `${base}/hang`, 400);
  expect(r).toStrictEqual({ fallback: false, text: "Command failed.\n- fetch failed\n", code: 0 });
});

it("runFetch falls back for anything but an http url", () => {
  const fallback = { fallback: true, text: "FALLBACK\n", code: 2 };
  expect(runFetch("ftp://example.com")).toStrictEqual(fallback);
  expect(runFetch("")).toStrictEqual(fallback);
});

it("runFetch fetches from the process cwd when it is given no places", () => {
  expect(runFetch(`${base}/empty`).text).toBe("1 line.\n- (empty)\n");
});

it("runJob fetch runs the same fetch for a url query", () => {
  const dir = plant();
  expect(runJob({ job: "fetch", query: `${base}/empty`, cwd: dir, root: dir }).text).toBe("1 line.\n- (empty)\n");
});

it("stripHtml keeps the title and the visible text, without scripts, styles and tags", () => {
  const page = "<title> A\n page </title><style>p{}</style><script>x()</script><p>a&nbsp;&amp;&lt;b&gt;</p>";
  expect(stripHtml(page)).toStrictEqual({ title: "A page", text: "A page a &<b>" });
  expect(stripHtml(undefined)).toStrictEqual({ title: "", text: "" });
});
