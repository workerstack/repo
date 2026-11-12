/** Waiting on an engine: a free port to start it on, and its `/json/version` once it answers. */
import net from "node:net";

import { asRec } from "./browser-session.ts";
import { ENGINE_NOT_READY, HOST, POLL_MS, VERSION_PATH } from "./browser.constants.ts";
import type { Rec } from "./browser.types.ts";

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** A local port nothing listens on. */
export function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, HOST, () => {
      const p = Number(asRec(s.address()).port);
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

/** The engine's version record; null while it does not answer. */
async function version(port: number): Promise<Rec | null> {
  try {
    const r = await fetch(`http://${HOST}:${port}${VERSION_PATH}`);

    if (!r.ok) return null;
    const v: unknown = await r.json();

    return asRec(v);
  } catch {
    return null;
  }
}

async function poll(port: number, until: number, failed?: () => Error | undefined): Promise<Rec> {
  if (Date.now() >= until) throw new Error(ENGINE_NOT_READY);
  const dead = failed?.();

  if (dead !== undefined) throw dead;
  const v = await version(port);

  if (v !== null) return v;
  await sleep(POLL_MS);

  return poll(port, until, failed);
}

/** The version record of the engine on `port`, polled until `timeoutMs`; `failed` ends the wait early. */
export function waitVersion(port: number, timeoutMs: number, failed?: () => Error | undefined): Promise<Rec> {
  return poll(port, Date.now() + timeoutMs, failed);
}
