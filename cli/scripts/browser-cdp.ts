import { z } from "zod";

import { tryJson } from "../json.ts";
import { asRec, filled, textOf } from "./browser-session.ts";
import { waitVersion } from "./browser-wait.ts";
/** The CDP client: one websocket to a running engine, one pending promise per request id. */
import { ENGINE_NOT_READY, READY_MS } from "./browser.constants.ts";
import type { Cdp, Rec, Session } from "./browser.types.ts";

type Pending = Map<number, { resolve: (v: Rec) => void; reject: (e: Error) => void }>;

function opened(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(ENGINE_NOT_READY)), timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(t);
      reject(new Error(ENGINE_NOT_READY));
    });
  });
}

function parse(data: unknown): Rec | null {
  return tryJson(z.record(z.string(), z.json()), String(data)) ?? null;
}

/** Settles the request a reply answers; a reply that is no JSON or names no pending id is dropped. */
function settle(pending: Pending, data: unknown): void {
  const msg = parse(data);

  if (msg === null || typeof msg.id !== "number") return;
  const p = pending.get(msg.id);

  if (p === undefined) return;
  pending.delete(msg.id);

  if (msg.error !== undefined && msg.error !== null)
    p.reject(new Error(filled(textOf(asRec(msg.error).message)) ?? "cdp"));
  else p.resolve(asRec(msg.result));
}

function client(ws: WebSocket): Cdp {
  let nextId = 1;
  const pending: Pending = new Map();
  ws.addEventListener("message", (ev) => settle(pending, ev.data));

  return {
    close() {
      ws.close();
    },
    send(method: string, params: Rec = {}): Promise<Rec> {
      const id = nextId++;

      return new Promise<Rec>((resolve, reject) => {
        pending.set(id, { reject, resolve });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

/** A CDP client on the engine at `port`, once it answers within `timeoutMs`. */
export async function connectCdp(port: number, timeoutMs: number = READY_MS): Promise<Cdp> {
  const version = await waitVersion(port, timeoutMs);
  const wsUrl = version.webSocketDebuggerUrl;

  if (typeof wsUrl !== "string" || wsUrl === "") throw new Error(ENGINE_NOT_READY);
  const ws = new WebSocket(wsUrl);
  await opened(ws, timeoutMs);

  return client(ws);
}

/** Runs `fn` on a client of `session`'s engine and closes it after. */
export async function withCdp<T>(session: Session, fn: (cdp: Cdp) => Promise<T>): Promise<T> {
  const cdp = await connectCdp(session.port);

  try {
    return await fn(cdp);
  } finally {
    cdp.close();
  }
}
