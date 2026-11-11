import net from "node:net";

import { afterEach, expect, it, vi } from "vitest";

import type { Calls } from "./__fixtures__/browser-kit.ts";
import { cleanBrowser, engine, onStop } from "./__fixtures__/browser-kit.ts";
import { acceptKey, clientFrame, rawClient, request, scripted, trickle } from "./__fixtures__/browser-ws-kit.ts";
import { connectCdp } from "./browser-cdp.ts";
import { handleCdp } from "./browser-serve.ts";

afterEach(cleanBrowser);

it("the fake handshakes with the accept key for the client's key", async () => {
  const { port } = await engine();
  const c = await rawClient(port);
  expect(c.head).toContain("101 Switching Protocols");
  expect(c.head).toContain(`Sec-WebSocket-Accept: ${acceptKey(c.key)}`);
});

it("the fake drops an upgrade that carries no key", async () => {
  const { port } = await engine();
  const sock = net.connect(port, "127.0.0.1");
  onStop(() => sock.destroy());
  let isClosed = false;
  sock.on("close", () => (isClosed = true));
  sock.on("error", () => {});
  sock.write("GET /x HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
  await vi.waitFor(() => expect(isClosed).toBe(true));
});

it("the fake carries short, mid-size and 70000 byte payloads in both directions", async () => {
  const e = await engine({ markdown: "s".repeat(10) });
  const cdp = await connectCdp(e.port);
  onStop(() => cdp.close());
  async function value(expression: string) {
    const reply = await cdp.send("Runtime.evaluate", { expression });
    return reply.result;
  }
  expect(await value("x".repeat(200))).toStrictEqual({
    type: "string",
    value: "s".repeat(10),
  });
  e.state.markdown = "m".repeat(300);
  expect(await value("y".repeat(70_000))).toStrictEqual({
    type: "string",
    value: "m".repeat(300),
  });
  e.state.markdown = "b".repeat(70_000);
  expect(await value("")).toStrictEqual({
    type: "string",
    value: "b".repeat(70_000),
  });
});

it("the fake reads unmasked frames, and frames whose header or body arrives in pieces", async () => {
  const { port } = await engine({ markdown: "ok" });
  const c = await rawClient(port);
  c.write(clientFrame(0x1, Buffer.from(JSON.stringify({ id: 1, method: "Runtime.evaluate" })), false));
  expect(await c.texts(1)).toStrictEqual([
    JSON.stringify({
      id: 1,
      result: { result: { type: "string", value: "ok" } },
    }),
  ]);
  await trickle(c, 2, 200);
  await trickle(c, 3, 70_000);
});

it("the fake answers two frames that arrive in one chunk", async () => {
  const { port } = await engine();
  const c = await rawClient(port);
  c.write(Buffer.concat([request(1), request(2)]));
  const texts = await c.texts(2);
  expect(texts.map((t) => t.slice(0, 8)).toSorted()).toStrictEqual(['{"id":1,', '{"id":2,']);
});

it("the fake takes binary frames, skips pings and bad json, and ends the socket on close", async () => {
  const { port } = await engine();
  const c = await rawClient(port);
  c.write(clientFrame(0x9, Buffer.from("ping")));
  c.write(clientFrame(0x1, Buffer.from("not json")));
  c.write(clientFrame(0x2, Buffer.from(JSON.stringify({ id: 5, method: "Page.enable" }))));
  expect(await c.texts(1)).toStrictEqual([JSON.stringify({ id: 5, result: {} })]);
  c.write(clientFrame(0x8, Buffer.alloc(0)));
  await vi.waitFor(() => expect(c.closed()).toBe(true));
});

it("the fake answers a request with no params and no method name", async () => {
  const { port } = await engine();
  const c = await rawClient(port);
  c.write(clientFrame(0x1, Buffer.from(JSON.stringify({ id: 9 }))));
  expect(await c.texts(1)).toStrictEqual([JSON.stringify({ id: 9, result: {} })]);
});

it("connectCdp matches replies to requests by id and ignores everything else", async () => {
  const port = await scripted((id) => {
    if (id === 2) return [JSON.stringify({ error: { message: "bad" }, id: 2 })];
    if (id === 3) return [JSON.stringify({ id: 3 })];
    return [
      "not json",
      JSON.stringify({ method: "Page.loadEventFired" }),
      '{"id":999,"result":{}}',
      '{"id":1,"error":{}}',
    ];
  });
  const cdp = await connectCdp(port);
  onStop(() => cdp.close());
  await expect(cdp.send("A")).rejects.toThrow("cdp");
  await expect(cdp.send("B")).rejects.toThrow("bad");
  expect(await cdp.send("C")).toStrictEqual({});
});

it("connectCdp close() twice is harmless", async () => {
  const { port } = await engine();
  const cdp = await connectCdp(port);
  expect(() => {
    cdp.close();
    cdp.close();
  }).not.toThrow();
});

it("handleCdp logs each call, answers an unknown method with {} and throws a scripted error", () => {
  const calls: Calls = [];
  const state = {
    calls,
    engine: "",
    failProbe: false,
    markdown: "",
    replies: { "X.no": "nope" },
    thinSnap: false,
    url: "",
  };
  expect(handleCdp(state, "X.unknown", {})).toStrictEqual({});
  expect(() => handleCdp(state, "X.no", { a: 1 })).toThrow("nope");
  expect(calls).toStrictEqual([
    { method: "X.unknown", params: {} },
    { method: "X.no", params: { a: 1 } },
  ]);
});
