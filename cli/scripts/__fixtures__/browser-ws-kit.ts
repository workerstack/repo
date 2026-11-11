import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import { expect, vi } from "vitest";
import { listen, onStop, portOf } from "./browser-kit.ts";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export const wait = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

export const acceptKey = (key: string): string =>
  crypto
    .createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");

function lengthField(len: number): [number, number] {
  if (len < 126) return [0, len];
  if (len < 65536) return [2, 126];
  return [8, 127];
}

/** A client frame as a browser sends it: masked unless told otherwise. */
export function clientFrame(
  opcode: number,
  payload: Buffer,
  mask = true,
): Buffer {
  const len = payload.length;
  const [ext, marker] = lengthField(len);
  const head = Buffer.alloc(2 + ext);
  head.writeUInt8(0x80 | opcode, 0);
  head.writeUInt8((mask ? 0x80 : 0) | marker, 1);
  if (ext === 2) head.writeUInt16BE(len, 2);
  if (ext === 8) head.writeBigUInt64BE(BigInt(len), 2);
  if (!mask) return Buffer.concat([head, payload]);
  const key = Buffer.from([1, 2, 3, 4]);
  return Buffer.concat([
    head,
    key,
    Buffer.from(payload.map((b, i) => b ^ key.readUInt8(i % 4))),
  ]);
}

export const request = (id: number, extra: object = {}): Buffer =>
  clientFrame(
    0x1,
    Buffer.from(JSON.stringify({ id, method: "Runtime.evaluate", ...extra })),
  );

/** The text of each (short or 16-bit length) unmasked server frame in buf, read frame by frame. */
function serverTexts(
  buf: Buffer,
  texts: string[] = [],
): { texts: string[]; rest: Buffer } {
  if (buf.length < 2) return { texts, rest: buf };
  const wide = (buf.readUInt8(1) & 0x7f) === 126;
  const len = wide ? buf.readUInt16BE(2) : buf.readUInt8(1);
  const start = wide ? 4 : 2;
  if (buf.length < start + len) return { texts, rest: buf };
  texts.push(buf.subarray(start, start + len).toString("utf8"));
  return serverTexts(buf.subarray(start + len), texts);
}

/** A raw websocket client: the handshake head and key, a writer, and the server texts as they arrive. */
export interface RawClient {
  head: string;
  key: string;
  write: (b: Buffer) => boolean;
  closed: () => boolean;
  texts: (n: number) => Promise<string[]>;
}

/** Opens a socket, upgrades it, and collects what the server frames back. */
export async function rawClient(port: number): Promise<RawClient> {
  const sock = net.connect(port, "127.0.0.1");
  onStop(() => sock.destroy());
  const state: { buf: Buffer; closed: boolean; got: string[] } = {
    buf: Buffer.alloc(0),
    closed: false,
    got: [],
  };
  sock.on("data", (d: Buffer) => (state.buf = Buffer.concat([state.buf, d])));
  sock.on("close", () => (state.closed = true));
  const key = crypto.randomBytes(16).toString("base64");
  const lines = [
    "GET /x HTTP/1.1",
    "Host: x",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
  ];
  sock.write(`${lines.join("\r\n")}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  await vi.waitFor(() => expect(state.buf.includes("\r\n\r\n")).toBe(true));
  const end = state.buf.indexOf("\r\n\r\n") + 4;
  const head = state.buf.subarray(0, end).toString();
  state.buf = state.buf.subarray(end);
  const texts = async (n: number) => {
    await vi.waitFor(() => {
      const { texts: t, rest } = serverTexts(state.buf);
      state.buf = rest;
      state.got.push(...t);
      expect(state.got.length).toBeGreaterThanOrEqual(n);
    });
    return state.got.splice(0);
  };
  return {
    head,
    key,
    write: (b: Buffer) => sock.write(b),
    closed: () => state.closed,
    texts,
  };
}

/** Writes one request in three pieces and expects its reply. */
export async function trickle(
  c: RawClient,
  id: number,
  size: number,
): Promise<void> {
  const frame = request(id, { params: { p: "z".repeat(size) } });
  c.write(frame.subarray(0, 3));
  await wait(60);
  c.write(frame.subarray(3, 12));
  await wait(60);
  c.write(frame.subarray(12));
  expect(await c.texts(1)).toEqual([expect.stringContaining(`"id":${id},`)]);
}

function serverFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

/** A cdp server that completes the handshake and answers each request id with the frames the script lists. */
export function scripted(reply: (id: number) => string[]): Promise<number> {
  const server = http.createServer((_req, res) => {
    res.end(
      JSON.stringify({
        webSocketDebuggerUrl: `ws://127.0.0.1:${portOf(server)}/x`,
      }),
    );
  });
  server.on("upgrade", (req, socket) => {
    const head =
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n";
    socket.write(
      `${head}Sec-WebSocket-Accept: ${acceptKey(String(req.headers["sec-websocket-key"]))}\r\n\r\n`,
    );
    socket.on("data", (chunk: Buffer) => {
      if ((chunk.readUInt8(0) & 0x0f) !== 0x1) return;
      const key = chunk.subarray(2, 6);
      const body = chunk
        .subarray(6, 6 + (chunk.readUInt8(1) & 0x7f))
        .map((b, i) => b ^ key.readUInt8(i % 4));
      const id = Number(/"id":(\d+)/.exec(Buffer.from(body).toString())?.[1]);
      for (const text of reply(id)) socket.write(serverFrame(text));
    });
  });
  return listen(server);
}
