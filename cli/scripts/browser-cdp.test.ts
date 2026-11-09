import http from "node:http";
import net from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import { connectCdp, main, serveCdp, type Cdp } from "./browser.ts";

const closers: (() => void)[] = [];

afterEach(() => {
  for (const c of closers.splice(0)) c();
  vi.restoreAllMocks();
});

function portOf(server: net.Server): number {
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("not listening");
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
  return { s, cdp: await connect(s.port) };
}

async function getJson(port: number, route = "/json/version") {
  return (await fetch(`http://127.0.0.1:${port}${route}`)).json();
}

const target = (url: string) => ({ targetInfos: [{ targetId: "t1", type: "page", url, attached: true }] });
const evalOf = (value: string) => ({ result: { type: "string", value } });

it("serves a blank lightpanda page when called with no arguments at all", async () => {
  const s = await serveCdp();
  closers.push(() => s.close());
  expect(s.state).toMatchObject({ url: "about:blank", engine: "lightpanda", failProbe: false, thinSnap: false });
  const cdp = await connect(s.port);
  expect(await cdp.send("Browser.getVersion")).toEqual({ protocolVersion: "1.3", product: "lightpanda" });
  expect(await cdp.send("Target.getTargets")).toEqual(target("about:blank"));
});

it("answers /json/version with the engine name and a ws url on its own port, and 404s other paths", async () => {
  const named = await serve({ engine: "chromium" });
  expect(await getJson(named.port)).toEqual({
    Browser: "chromium",
    "Protocol-Version": "1.3",
    webSocketDebuggerUrl: `ws://127.0.0.1:${named.port}/devtools/browser/repo`,
  });
  const unnamed = await cdpOf({ engine: "" });
  expect(await getJson(unnamed.s.port)).toMatchObject({ Browser: "Lightpanda" });
  expect(await unnamed.cdp.send("Browser.getVersion")).toMatchObject({ product: "lightpanda" });
  expect((await fetch(`http://127.0.0.1:${named.port}/nope`)).status).toBe(404);
});

it("tracks navigation and ignores a blank or non-string url", async () => {
  const { s, cdp } = await cdpOf();
  expect(await cdp.send("Page.navigate", { url: "https://a.test/" })).toEqual({ frameId: "f1" });
  expect(await cdp.send("LP.getMarkdown")).toEqual({ markdown: "# https://a.test/\n\nhello" });
  expect(await cdp.send("Target.getTargets")).toEqual(target("https://a.test/"));
  await cdp.send("Page.navigate", { url: "" });
  await cdp.send("Page.navigate", { url: 7 });
  await cdp.send("Page.navigate");
  expect(s.state.url).toBe("https://a.test/");
});

it("falls back to about:blank, a bare heading and a page-named tree when the url is blank", async () => {
  const { cdp } = await cdpOf({ url: "" });
  expect(await cdp.send("Target.getTargets")).toEqual(target("about:blank"));
  expect(await cdp.send("LP.getMarkdown")).toEqual({ markdown: "# \n\nhello" });
  expect(await cdp.send("Accessibility.getFullAXTree")).toMatchObject({ nodes: [{ name: { value: "page" } }, {}, {}] });
  expect(await (await cdpOf({ url: "", thinSnap: true })).cdp.send("LP.getMarkdown")).toEqual({ markdown: "# \n" });
});

it("serves the set markdown, a two-ref default tree, or the given nodes; thin pages are empty", async () => {
  const { cdp } = await cdpOf({ url: "https://b.test/", markdown: "# set\n\nbody" });
  expect(await cdp.send("LP.getMarkdown")).toEqual({ markdown: "# set\n\nbody" });
  const tree = await cdp.send("Accessibility.getFullAXTree");
  expect(tree).toMatchObject({ nodes: [{ name: { value: "https://b.test/" } }, { name: { value: "Home" } }, {}] });
  expect(tree).toMatchObject({ nodes: [{}, { backendDOMNodeId: 10 }, { backendDOMNodeId: 11 }] });
  expect(await (await cdpOf({ axNodes: [{ role: "button" }] })).cdp.send("Accessibility.getFullAXTree")).toEqual({
    nodes: [{ role: "button" }],
  });
  const thin = (await cdpOf({ url: "https://c.test/", thinSnap: true })).cdp;
  expect(await thin.send("LP.getMarkdown")).toEqual({ markdown: "# https://c.test/\n" });
  expect(await thin.send("Accessibility.getFullAXTree")).toEqual({ nodes: [] });
});

it("resolves only the two known backend nodes; any other is stale", async () => {
  const { cdp } = await cdpOf();
  expect(await cdp.send("DOM.resolveNode", { backendNodeId: 10 })).toEqual({ object: { objectId: "oid-10" } });
  expect(await cdp.send("DOM.resolveNode", { backendNodeId: 11 })).toEqual({ object: { objectId: "oid-11" } });
  await expect(cdp.send("DOM.resolveNode", { backendNodeId: 12 })).rejects.toThrow("stale");
  await expect(cdp.send("DOM.resolveNode", { backendNodeId: "10" })).rejects.toThrow("stale");
});

it("acks enables, input and unknown methods; paints a png and a pdf; evaluates to the markdown", async () => {
  const { cdp } = await cdpOf({ markdown: "from state" });
  const acked = ["Page.enable", "Accessibility.enable", "Runtime.enable", "DOM.enable", "Input.insertText", "X.y"];
  expect(await Promise.all(acked.map((m) => cdp.send(m)))).toEqual(acked.map(() => ({})));
  expect(await cdp.send("Runtime.callFunctionOn")).toEqual({ result: { type: "undefined" } });
  const png = Buffer.from(String((await cdp.send("Page.captureScreenshot")).data), "base64");
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  const pdf = Buffer.from(String((await cdp.send("Page.printToPDF")).data), "base64");
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(await cdp.send("Runtime.evaluate")).toEqual(evalOf("from state"));
  expect(await (await cdpOf()).cdp.send("Runtime.evaluate")).toEqual(evalOf(""));
});

it("failProbe rejects only the probe methods", async () => {
  const { cdp } = await cdpOf({ failProbe: true });
  await expect(cdp.send("Browser.getVersion")).rejects.toThrow("probe failed");
  await expect(cdp.send("Target.getTargets")).rejects.toThrow("probe failed");
  expect(await cdp.send("Page.enable")).toEqual({});
});

it("scripted replies win (a record is the reply, a string the error) and every call is logged", async () => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const replies = { "Page.enable": "no page", "DOM.enable": { custom: true } };
  const { cdp } = await cdpOf({ calls, replies });
  await expect(cdp.send("Page.enable")).rejects.toThrow("no page");
  expect(await cdp.send("DOM.enable", { a: 1 })).toEqual({ custom: true });
  expect(await cdp.send("Runtime.enable")).toEqual({});
  expect(calls).toEqual([
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
  expect(await cdp.send("Page.enable")).toEqual({});
});

it("rejects a version reply without a usable websocket url, or one that cannot open", async () => {
  const reply = (body: unknown) => http.createServer((_req, res) => res.end(JSON.stringify(body)));
  const dead = `ws://127.0.0.1:${await deadPort()}/x`;
  const bodies = [{}, { webSocketDebuggerUrl: "" }, { webSocketDebuggerUrl: 5 }, { webSocketDebuggerUrl: dead }];
  const ports = await Promise.all(bodies.map((b) => listen(reply(b))));
  const results = await Promise.allSettled(ports.map((p) => connectCdp(p)));
  expect(results.map((r) => r.status)).toEqual(bodies.map(() => "rejected"));
});

it("rejects when the upgrade never completes within the time given", async () => {
  const sockets: { destroy(): void }[] = [];
  const server = http.createServer((_req, res) =>
    res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${portOf(server)}/x` })),
  );
  server.on("upgrade", (_req, socket) => sockets.push(socket));
  closers.push(() => sockets.forEach((s) => s.destroy()));
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
