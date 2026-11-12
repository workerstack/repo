import http from "node:http";
import net from "node:net";

import { afterEach, expect, it, vi } from "vitest";

import { connectCdp } from "./browser-cdp.ts";
import { serveCdp } from "./browser-serve.ts";
import { main } from "./browser.ts";
import type { Cdp, Rec } from "./browser.types.ts";
import { jsonText } from "./json-text.ts";

const closers: (() => void)[] = [];

afterEach(() => {
  for (const c of closers.splice(0)) c();
  vi.restoreAllMocks();
});

function portOf(server: net.Server): number {
  const a = server.address();

  if (a === null || typeof a === "string") throw new Error("not listening");

  return a.port;
}

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => server.close());

  return portOf(server);
}

async function deadPort(): Promise<number> {
  const s = net.createServer();
  const port = await listen(s);
  await new Promise<void>((r) => s.close(() => r()));

  return port;
}

async function serve(state: Parameters<typeof serveCdp>[0] = {}) {
  const s = await serveCdp(state);
  closers.push(() => s.close());

  return s;
}

async function connect(port: number): Promise<Cdp> {
  const cdp = await connectCdp(port);
  closers.push(() => cdp.close());

  return cdp;
}

async function cdpOf(state: Parameters<typeof serveCdp>[0] = {}) {
  const s = await serve(state);

  return { cdp: await connect(s.port), s };
}

async function getJson(port: number, route = "/json/version") {
  const res = await fetch(`http://127.0.0.1:${port}${route}`);

  return res.json();
}

function target(url: string) {
  return { targetInfos: [{ attached: true, targetId: "t1", type: "page", url }] };
}

function evalOf(value: string) {
  return { result: { type: "string", value } };
}

it("serves a blank lightpanda page when called with no arguments at all", async () => {
  const s = await serveCdp();
  closers.push(() => s.close());
  expect(s.state).toMatchObject({ engine: "lightpanda", failProbe: false, thinSnap: false, url: "about:blank" });
  const cdp = await connect(s.port);
  expect(await cdp.send("Browser.getVersion")).toStrictEqual({ product: "lightpanda", protocolVersion: "1.3" });
  expect(await cdp.send("Target.getTargets")).toStrictEqual(target("about:blank"));
});

it("answers /json/version with the engine name and a ws url on its own port, and 404s other paths", async () => {
  const named = await serve({ engine: "chromium" });
  expect(await getJson(named.port)).toStrictEqual({
    Browser: "chromium",
    "Protocol-Version": "1.3",
    webSocketDebuggerUrl: `ws://127.0.0.1:${named.port}/devtools/browser/repo`,
  });
  const unnamed = await cdpOf({ engine: "" });
  expect(await getJson(unnamed.s.port)).toMatchObject({ Browser: "Lightpanda" });
  expect(await unnamed.cdp.send("Browser.getVersion")).toMatchObject({ product: "lightpanda" });
  const nope = await fetch(`http://127.0.0.1:${named.port}/nope`);
  expect(nope.status).toBe(404);
});

it("tracks navigation and ignores a blank or non-string url", async () => {
  const { s, cdp } = await cdpOf();
  expect(await cdp.send("Page.navigate", { url: "https://a.test/" })).toStrictEqual({ frameId: "f1" });
  expect(await cdp.send("LP.getMarkdown")).toStrictEqual({ markdown: "# https://a.test/\n\nhello" });
  expect(await cdp.send("Target.getTargets")).toStrictEqual(target("https://a.test/"));
  await cdp.send("Page.navigate", { url: "" });
  await cdp.send("Page.navigate", { url: 7 });
  await cdp.send("Page.navigate");
  expect(s.state.url).toBe("https://a.test/");
});

it("falls back to about:blank, a bare heading and a page-named tree when the url is blank", async () => {
  const { cdp } = await cdpOf({ url: "" });
  expect(await cdp.send("Target.getTargets")).toStrictEqual(target("about:blank"));
  expect(await cdp.send("LP.getMarkdown")).toStrictEqual({ markdown: "# \n\nhello" });
  expect(await cdp.send("Accessibility.getFullAXTree")).toMatchObject({ nodes: [{ name: { value: "page" } }, {}, {}] });
  const thin = await cdpOf({ thinSnap: true, url: "" });
  expect(await thin.cdp.send("LP.getMarkdown")).toStrictEqual({ markdown: "# \n" });
});

it("serves the set markdown, a two-ref default tree, or the given nodes; thin pages are empty", async () => {
  const { cdp } = await cdpOf({ markdown: "# set\n\nbody", url: "https://b.test/" });
  expect(await cdp.send("LP.getMarkdown")).toStrictEqual({ markdown: "# set\n\nbody" });
  const tree = await cdp.send("Accessibility.getFullAXTree");
  expect(tree).toMatchObject({ nodes: [{ name: { value: "https://b.test/" } }, { name: { value: "Home" } }, {}] });
  expect(tree).toMatchObject({ nodes: [{}, { backendDOMNodeId: 10 }, { backendDOMNodeId: 11 }] });
  const given = await cdpOf({ axNodes: [{ role: "button" }] });
  expect(await given.cdp.send("Accessibility.getFullAXTree")).toStrictEqual({ nodes: [{ role: "button" }] });
  const { cdp: thin } = await cdpOf({ thinSnap: true, url: "https://c.test/" });
  expect(await thin.send("LP.getMarkdown")).toStrictEqual({ markdown: "# https://c.test/\n" });
  expect(await thin.send("Accessibility.getFullAXTree")).toStrictEqual({ nodes: [] });
});

it("resolves only the two known backend nodes; any other is stale", async () => {
  const { cdp } = await cdpOf();
  expect(await cdp.send("DOM.resolveNode", { backendNodeId: 10 })).toStrictEqual({ object: { objectId: "oid-10" } });
  expect(await cdp.send("DOM.resolveNode", { backendNodeId: 11 })).toStrictEqual({ object: { objectId: "oid-11" } });
  await expect(cdp.send("DOM.resolveNode", { backendNodeId: 12 })).rejects.toThrow("stale");
  await expect(cdp.send("DOM.resolveNode", { backendNodeId: "10" })).rejects.toThrow("stale");
});

it("acks enables, input and unknown methods; paints a png and a pdf; evaluates to the markdown", async () => {
  const { cdp } = await cdpOf({ markdown: "from state" });
  const acked = ["Page.enable", "Accessibility.enable", "Runtime.enable", "DOM.enable", "Input.insertText", "X.y"];
  expect(await Promise.all(acked.map((m) => cdp.send(m)))).toStrictEqual(acked.map(() => ({})));
  expect(await cdp.send("Runtime.callFunctionOn")).toStrictEqual({ result: { type: "undefined" } });
  const shot = await cdp.send("Page.captureScreenshot");
  const png = Buffer.from(jsonText(shot.data), "base64");
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  const printed = await cdp.send("Page.printToPDF");
  const pdf = Buffer.from(jsonText(printed.data), "base64");
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(await cdp.send("Runtime.evaluate")).toStrictEqual(evalOf("from state"));
  const blank = await cdpOf();
  expect(await blank.cdp.send("Runtime.evaluate")).toStrictEqual(evalOf(""));
});

it("failProbe rejects only the probe methods", async () => {
  const { cdp } = await cdpOf({ failProbe: true });
  await expect(cdp.send("Browser.getVersion")).rejects.toThrow("probe failed");
  await expect(cdp.send("Target.getTargets")).rejects.toThrow("probe failed");
  expect(await cdp.send("Page.enable")).toStrictEqual({});
});

it("scripted replies win (a record is the reply, a string the error) and every call is logged", async () => {
  const calls: { method: string; params: Rec }[] = [];
  const replies = { "DOM.enable": { custom: true }, "Page.enable": "no page" };
  const { cdp } = await cdpOf({ calls, replies });
  await expect(cdp.send("Page.enable")).rejects.toThrow("no page");
  expect(await cdp.send("DOM.enable", { a: 1 })).toStrictEqual({ custom: true });
  expect(await cdp.send("Runtime.enable")).toStrictEqual({});
  expect(calls).toStrictEqual([
    { method: "Page.enable", params: {} },
    { method: "DOM.enable", params: { a: 1 } },
    { method: "Runtime.enable", params: {} },
  ]);
});

it("stops answering new connections after close()", async () => {
  const s = await serveCdp();
  s.close();
  await expect(connectCdp(s.port, 150)).rejects.toThrow("engine not ready");
  await expect(connectCdp(await deadPort(), 120)).rejects.toThrow("engine not ready");
});

it("retries a not-ok version reply, and a port nothing listens on yet, until the engine answers", async () => {
  let hits = 0;

  const flaky = http.createServer((_req, res) => {
    res.statusCode = ++hits < 3 ? 503 : 200;
    res.end(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:1/x" }));
  });

  await expect(connectCdp(await listen(flaky), 2000)).rejects.toThrow("engine not ready");
  expect(hits).toBe(3);
  const port = await deadPort();
  const pending = connectCdp(port, 3000);
  await new Promise((r) => setTimeout(r, 80));
  const s = await serveCdp({}, { port });
  closers.push(() => s.close());
  const cdp = await pending;
  closers.push(() => cdp.close());
  expect(await cdp.send("Page.enable")).toStrictEqual({});
});

/** A server that answers every request with `body` as JSON. */
function replyServer(body: unknown) {
  return http.createServer((_req, res) => res.end(JSON.stringify(body)));
}

it("rejects a version reply without a usable websocket url, or one that cannot open", async () => {
  const dead = `ws://127.0.0.1:${await deadPort()}/x`;
  const bodies = [{}, { webSocketDebuggerUrl: "" }, { webSocketDebuggerUrl: 5 }, { webSocketDebuggerUrl: dead }];
  const ports = await Promise.all(bodies.map((b) => listen(replyServer(b))));
  const results = await Promise.allSettled(ports.map((p) => connectCdp(p)));
  expect(results.map((r) => r.status)).toStrictEqual(bodies.map(() => "rejected"));
});

it("rejects when the upgrade never completes within the time given", async () => {
  const sockets: { destroy(): void }[] = [];

  const server = http.createServer((_req, res) =>
    res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${portOf(server)}/x` })),
  );

  server.on("upgrade", (_req, socket) => sockets.push(socket));
  closers.push(() => {
    for (const s of sockets) s.destroy();
  });
  await expect(connectCdp(await listen(server), 150)).rejects.toThrow("engine not ready");
});

it("main prints the verb list on stdout, and a failure on stderr with its code", async () => {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  expect(await main(["help"])).toBe(0);
  expect(out).toHaveBeenCalledWith("nav|snap|click|fill|scroll|wait|hover|select|shot|pdf|stop|doctor|ensure\n");
  expect(err).not.toHaveBeenCalled();
  expect(await main(["frobnicate"])).toBe(1);
  expect(err).toHaveBeenCalledWith("unknown verb\n");
  expect(out).toHaveBeenCalledTimes(1);
});
