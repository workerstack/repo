#!/usr/bin/env bun
/** Session browser rail: nav|snap|click|fill|scroll|wait|hover|select|shot|pdf|stop|doctor|ensure. Lightpanda default. */
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { resolveRoots } from "./workspace-root.ts";
import { writeStash } from "./job-stash.ts";
import { isRecord } from "./hook-input.ts";
import {
  CHROMIUM_BINS,
  LIGHTPANDA_REPO as DOCTOR_LP_REPO,
  globalsRow,
  installHints,
  runDoctor,
  whichBin,
} from "./doctor.ts";
import { childEnv } from "../env.ts";

export { CHROMIUM_BINS, whichBin };

type Rec = Record<string, unknown>;
export type Engine = "lightpanda" | "chromium";

export type Bins = {
  lightpanda: string;
  chromium: string;
};

/** One remembered snapshot ref. */
export interface RefEntry {
  role: string;
  name: string;
  backendNodeId: unknown;
  nodeId: unknown;
}

/** The live browser session stored in session.json. */
export interface Session {
  engine: Engine;
  pid?: number | undefined;
  port: number;
  lastURL: string;
  lastRefs: Record<string, RefEntry>;
  escalated: boolean;
  swapCount: number;
}

export interface BrowserResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Cdp {
  send(method: string, params?: Rec): Promise<Rec>;
  close(): void;
}

export interface FakeCdpState {
  url: string;
  markdown: string;
  failProbe: boolean;
  thinSnap: boolean;
  engine: string;
  axNodes?: unknown[];
  /** Per CDP method: a record is the reply, a string is the error message. */
  replies?: Record<string, Rec | string>;
  /** Every CDP request the fake receives, in order. */
  calls?: { method: string; params: Rec }[];
}

interface Ctx {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  bins: Bins;
  readyMs: number;
}

function asRec(v: unknown): Rec {
  return isRecord(v) ? v : {};
}

function errMessage(e: unknown): string {
  return String(asRec(e).message);
}

function toSession(v: unknown): Session | null {
  if (!isRecord(v)) return null;
  const engine = v.engine === "lightpanda" || v.engine === "chromium" ? v.engine : null;
  const port = Number(v.port);
  if (!engine || !Number.isFinite(port)) return null;
  const lastRefs: Record<string, RefEntry> = {};
  for (const [id, e] of Object.entries(asRec(v.lastRefs))) {
    if (!isRecord(e)) continue;
    lastRefs[id] = {
      role: String(e.role ?? ""),
      name: String(e.name ?? ""),
      backendNodeId: e.backendNodeId,
      nodeId: e.nodeId,
    };
  }
  return {
    engine,
    pid: typeof v.pid === "number" ? v.pid : undefined,
    port,
    lastURL: String(v.lastURL ?? ""),
    lastRefs,
    escalated: v.escalated === true,
    swapCount: Number(v.swapCount) || 0,
  };
}
export const SESSION_REL = ".tmp/repo/browser";
export const LIGHTPANDA_REPO: "https://github.com/lightpanda-io/browser" = DOCTOR_LP_REPO;
const INSTALL_HINT = `no browser engine; install lightpanda (${LIGHTPANDA_REPO}) or Chromium`;
const CHROMIUM_VERBS = new Set(["shot", "pdf", "trace"]);
const REF_ROLES = new Set([
  "link",
  "button",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "tab",
  "menuitem",
  "option",
]);
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PDF_B64 =
  "JVBERi0xLjAKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDMgM10vUGFyZW50IDIgMCBSL1Jlc291cmNlczw+Pj4KZW5kb2JqCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgoxOTAKJSVFT0Y=";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function sessionDir(cwd?: string): string {
  return path.join(resolveRoots({}, { cwd: cwd || process.cwd() }).root, SESSION_REL);
}

export function sessionFile(cwd?: string): string {
  return path.join(sessionDir(cwd), "session.json");
}

export function isPaintHost(url: unknown): boolean {
  let u: URL;
  try {
    u = new URL(String(url || ""));
  } catch {
    return false;
  }
  const h = u.hostname.toLowerCase();
  if (h === "figma.com" || h.endsWith(".figma.com")) return true;
  if (h === "docs.google.com" || h.endsWith(".docs.google.com")) return true;
  if (h === "sheets.google.com" || h.endsWith(".sheets.google.com")) return true;
  if (h === "slides.google.com" || h.endsWith(".slides.google.com")) return true;
  if (h === "mail.google.com" || h.endsWith(".mail.google.com")) return true;
  if (h === "earth.google.com" || h.endsWith(".earth.google.com")) return true;
  if ((h === "google.com" || h.endsWith(".google.com")) && u.pathname.startsWith("/earth")) {
    return true;
  }
  if (/(^|\.)amazon\./.test(h)) return true;
  return false;
}

const BLOCKED_SNAP_RE =
  /enable javascript|javascript (is )?(required|disabled)|checking your browser|just a moment|captcha|access denied|sorry.*robot|continue shopping|attention required|cf-browser-verification|verify you are a human/i;

export function isBlockedSnap(markdown: unknown, lines: unknown): boolean {
  const refs = Array.isArray(lines) ? lines.length : 0;
  const md = String(markdown || "").trim();
  if (BLOCKED_SNAP_RE.test(md)) return true;
  const body = md.replace(/^#\s+\S+\s*$/m, "").trim();
  return refs === 0 && body.length < 80;
}

export function lookupBins(pathEnv: string | undefined, platform: NodeJS.Platform = process.platform): Bins {
  const lightpanda = whichBin("lightpanda", pathEnv, platform);
  let chromium = "";
  for (const n of CHROMIUM_BINS) {
    chromium = whichBin(n, pathEnv, platform);
    if (chromium) break;
  }
  return { lightpanda, chromium };
}

export function doctorHints(platform: NodeJS.Platform = process.platform): string[] {
  return [...installHints("lightpanda", platform), ...installHints("chromium", platform)];
}

export function installHint(platform: NodeJS.Platform = process.platform): string {
  return [INSTALL_HINT, ...doctorHints(platform)].join("\n");
}

export function pickEngine({
  platform = process.platform,
  verb = "nav",
  url = "",
  bins = {},
  forceChromium = false,
}: {
  platform?: NodeJS.Platform;
  verb?: string;
  url?: string;
  bins?: Partial<Bins> & Record<string, string | undefined>;
  forceChromium?: boolean;
} = {}): { engine: Engine; error?: undefined } | { engine: null; error: string } {
  const hasC = Boolean(bins.chromium);
  const hasL = Boolean(bins.lightpanda);
  const wantC = forceChromium || platform === "win32" || CHROMIUM_VERBS.has(String(verb)) || isPaintHost(url);
  if (wantC) {
    if (!hasC) return { engine: null, error: installHint(platform) };
    return { engine: "chromium" };
  }
  if (hasL) return { engine: "lightpanda" };
  if (hasC) return { engine: "chromium" };
  return { engine: null, error: installHint(platform) };
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Whether a spawn or kill here goes through Windows: the platform asked for, or the host, whose process model decides. */
const onWindows = (platform: NodeJS.Platform): boolean => platform === "win32" || process.platform === "win32";

function reap(pid: number | undefined, platform: NodeJS.Platform): void {
  if (!pid) return;
  if (onWindows(platform)) {
    // The tree first: a shell shim's child outlives the shell once that is killed, and holds the profile dir open.
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", timeout: 1500, windowsHide: true });
    try {
      process.kill(pid);
    } catch {
      // ignore
    }
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // ignore
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore
  }
}

function readSession(cwd?: string): Session | null {
  const f = sessionFile(cwd);
  if (!fs.existsSync(f)) return null;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(f, "utf8"));
    return toSession(raw);
  } catch {
    return null;
  }
}

function writeSession(cwd: string, session: Session): void {
  const dir = sessionDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionFile(cwd), JSON.stringify(session, null, 2) + "\n");
}

function clearSession(cwd: string): void {
  try {
    fs.unlinkSync(sessionFile(cwd));
  } catch {
    // ignore
  }
}

function ok(stdout: string): BrowserResult {
  return { code: 0, stdout: stdout.endsWith("\n") ? stdout : stdout + "\n", stderr: "" };
}

function fail(stderr: string): BrowserResult {
  const msg = stderr.replace(/^Error:\s*/, "");
  return { code: 1, stdout: "", stderr: msg.endsWith("\n") ? msg : msg + "\n" };
}

async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = Number(asRec(s.address()).port);
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

async function waitVersion(port: number, timeoutMs: number, failed?: () => Error | undefined): Promise<Rec> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const dead = failed?.();
    if (dead) throw dead;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) {
        const v: unknown = await r.json();
        return asRec(v);
      }
    } catch {
      // retry
    }
    await sleep(40);
  }
  throw new Error("engine not ready");
}

export async function connectCdp(port: number, timeoutMs = 4000): Promise<Cdp> {
  const version = await waitVersion(port, timeoutMs);
  const wsUrl = version.webSocketDebuggerUrl;
  if (typeof wsUrl !== "string" || !wsUrl) throw new Error("engine not ready");
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("engine not ready")), timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(t);
      reject(new Error("engine not ready"));
    });
  });
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: Rec) => void; reject: (e: Error) => void }>();
  ws.addEventListener("message", (ev) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    const msg = asRec(parsed);
    if (typeof msg.id !== "number") return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(String(asRec(msg.error).message || "cdp")));
    else p.resolve(asRec(msg.result));
  });
  return {
    send(method: string, params: Rec = {}): Promise<Rec> {
      const id = nextId++;
      return new Promise<Rec>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

function defaultAx(url: string): Rec[] {
  return [
    {
      nodeId: "1",
      role: { value: "WebArea" },
      name: { value: url || "page" },
      childIds: ["2", "3"],
    },
    {
      nodeId: "2",
      role: { value: "link" },
      name: { value: "Home" },
      backendDOMNodeId: 10,
      childIds: [],
    },
    {
      nodeId: "3",
      role: { value: "textbox" },
      name: { value: "Search" },
      backendDOMNodeId: 11,
      childIds: [],
    },
  ];
}

function encodeWsFrame(data: string): Buffer {
  const payload = Buffer.from(data);
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeWsFrames(buf: Buffer): {
  messages: ({ type: "close" } | { type: "msg"; data: string })[];
  rest: Buffer;
} {
  const messages: ({ type: "close" } | { type: "msg"; data: string })[] = [];
  let offset = 0;
  while (buf.length - offset >= 2) {
    const b1 = buf[offset + 1]!; // the loop guard keeps offset + 1 in range
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let start = offset + 2;
    if (len === 126) {
      if (buf.length - offset < 4) break;
      len = buf.readUInt16BE(offset + 2);
      start = offset + 4;
    } else if (len === 127) {
      if (buf.length - offset < 10) break;
      len = Number(buf.readBigUInt64BE(offset + 2));
      start = offset + 10;
    }
    const maskStart = start;
    if (masked) start += 4;
    if (buf.length < start + len) break;
    let payload = buf.subarray(start, start + len);
    if (masked) {
      const mask = buf.subarray(maskStart, maskStart + 4);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!; // both indexes are in range
    }
    const opcode = buf[offset]! & 0x0f; // offset < buf.length
    offset = start + len;
    if (opcode === 0x8) messages.push({ type: "close" });
    else if (opcode === 0x1 || opcode === 0x2) {
      messages.push({ type: "msg", data: payload.toString("utf8") });
    }
  }
  return { messages, rest: buf.subarray(offset) };
}

async function handleCdp(state: FakeCdpState, method: string, params: Rec): Promise<Rec> {
  state.calls?.push({ method, params });
  const scripted = state.replies?.[method];
  if (typeof scripted === "string") throw new Error(scripted);
  if (scripted) return scripted;
  if (state.failProbe && (method === "Browser.getVersion" || method === "Target.getTargets")) {
    throw new Error("probe failed");
  }
  switch (method) {
    case "Browser.getVersion":
      return { protocolVersion: "1.3", product: state.engine || "lightpanda" };
    case "Target.getTargets":
      return {
        targetInfos: [{ targetId: "t1", type: "page", url: state.url || "about:blank", attached: true }],
      };
    case "Page.enable":
    case "Accessibility.enable":
    case "Runtime.enable":
    case "DOM.enable":
      return {};
    case "Page.navigate":
      state.url = typeof params.url === "string" && params.url ? params.url : state.url;
      state.markdown = `# ${state.url}\n\nhello`;
      return { frameId: "f1" };
    case "LP.getMarkdown":
      if (state.thinSnap) return { markdown: `# ${state.url || ""}\n` };
      return { markdown: state.markdown || `# ${state.url || ""}\n\nhello` };
    case "Accessibility.getFullAXTree":
      if (state.thinSnap) return { nodes: [] };
      return { nodes: state.axNodes ?? defaultAx(state.url) };
    case "DOM.resolveNode": {
      const id = params.backendNodeId;
      const known = new Set([10, 11]);
      if (typeof id !== "number" || !known.has(id)) throw new Error("stale");
      return { object: { objectId: "oid-" + id } };
    }
    case "Runtime.callFunctionOn":
      return { result: { type: "undefined" } };
    case "Input.insertText":
      return {};
    case "Page.captureScreenshot":
      return { data: PNG_B64 };
    case "Page.printToPDF":
      return { data: PDF_B64 };
    case "Runtime.evaluate":
      return { result: { type: "string", value: state.markdown || "" } };
    default:
      return {};
  }
}

/** Undocumented test helper: fake Lightpanda/Chromium CDP. */
export async function serveCdp(
  state: Partial<FakeCdpState> = {},
  { port = 0 }: { port?: number } = {},
): Promise<{ port: number; close(): void; state: FakeCdpState }> {
  const st: FakeCdpState = {
    url: "about:blank",
    markdown: "",
    failProbe: false,
    thinSnap: false,
    engine: "lightpanda",
    ...state,
  };
  let bound = 0;
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/json/version")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          Browser: st.engine || "Lightpanda",
          "Protocol-Version": "1.3",
          webSocketDebuggerUrl: `ws://127.0.0.1:${bound}/devtools/browser/repo`,
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || !key) {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash("sha1")
      .update(key + WS_GUID)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
        accept +
        "\r\n\r\n",
    );
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const decoded = decodeWsFrames(buf);
      buf = Buffer.from(decoded.rest);
      for (const m of decoded.messages) {
        if (m.type === "close") {
          socket.end();
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(m.data);
        } catch {
          continue;
        }
        const msg = asRec(parsed);
        Promise.resolve()
          .then(() => handleCdp(st, String(msg.method), asRec(msg.params)))
          .then((result) => {
            socket.write(encodeWsFrame(JSON.stringify({ id: msg.id, result })));
          })
          .catch((err) => {
            socket.write(
              encodeWsFrame(
                JSON.stringify({
                  id: msg.id,
                  error: { code: -32000, message: errMessage(err) },
                }),
              ),
            );
          });
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  bound = Number(asRec(server.address()).port);
  return {
    port: bound,
    close() {
      server.close();
    },
    state: st,
  };
}

function engineBin(engine: Engine, bins: Bins): string {
  if (engine === "lightpanda") return bins.lightpanda;
  return bins.chromium;
}

function spawnEngine(bin: string, args: string[], ctx: Ctx): ChildProcess {
  const opts: SpawnOptions = { detached: true, stdio: ["ignore", "pipe", "pipe"], env: ctx.env, cwd: ctx.cwd };
  if (onWindows(ctx.platform) && /\.(cmd|bat)$/i.test(bin)) {
    const mjs = `${String(bin).replace(/\.(cmd|bat)$/i, "")}.mjs`;
    try {
      fs.accessSync(mjs, fs.constants.F_OK);
      return spawn(process.execPath, [mjs, ...args], opts);
    } catch {
      return spawn(bin, args, { ...opts, shell: true });
    }
  }
  return spawn(bin, args, opts);
}

function spawnArgs(engine: Engine, port: number, profile: string): string[] {
  if (engine === "lightpanda") return ["serve", "--host", "127.0.0.1", "--port", String(port)];
  return [
    "--headless=new",
    "--disable-gpu",
    "--remote-debugging-port",
    String(port),
    "--user-data-dir",
    profile,
    "about:blank",
  ];
}

async function launchEngine(engine: Engine, ctx: Ctx): Promise<Session> {
  const bin = engineBin(engine, ctx.bins);
  const dir = sessionDir(ctx.cwd);
  fs.mkdirSync(dir, { recursive: true });
  const profile = path.join(dir, "profile");
  fs.mkdirSync(profile, { recursive: true });
  const port = await freePort();
  const child = spawnEngine(bin, spawnArgs(engine, port, profile), ctx);
  child.unref();
  // An engine that cannot start (missing, not executable) reports through 'error'; unhandled it would crash the process.
  let spawnError: Error | undefined;
  child.once("error", (err) => {
    spawnError = new Error(`engine failed to start: ${err.message}`);
  });
  try {
    await waitVersion(port, ctx.readyMs, () => spawnError);
  } catch (err) {
    reap(child.pid, ctx.platform);
    throw err;
  }
  return {
    engine,
    pid: child.pid,
    port,
    lastURL: "",
    lastRefs: {},
    escalated: false,
    swapCount: 0,
  };
}

async function probe(session: Session): Promise<void> {
  const cdp = await connectCdp(session.port);
  try {
    await cdp.send("Browser.getVersion");
  } finally {
    cdp.close();
  }
}

async function navigate(session: Session, url: string): Promise<void> {
  const cdp = await connectCdp(session.port);
  try {
    await cdp.send("Page.enable").catch(() => {});
    await cdp.send("Page.navigate", { url });
    session.lastURL = url;
  } finally {
    cdp.close();
  }
}

function axText(v: unknown): string {
  return String(isRecord(v) ? (v.value ?? "") : (v ?? ""));
}

function formatRefs(nodes: unknown[]): { lastRefs: Record<string, RefEntry>; lines: string[] } {
  const lastRefs: Record<string, RefEntry> = {};
  const lines: string[] = [];
  let n = 1;
  for (const raw of nodes) {
    const node = asRec(raw);
    const role = axText(node.role).toLowerCase();
    if (!REF_ROLES.has(role)) continue;
    const name = axText(node.name);
    const id = String(n++);
    lastRefs[id] = {
      role,
      name,
      backendNodeId: node.backendDOMNodeId ?? node.backendNodeId,
      nodeId: node.nodeId,
    };
    lines.push(`[${id}] ${role} ${name}`.trim());
  }
  return { lastRefs, lines };
}

async function snapshot(session: Session): Promise<{ markdown: string; lines: string[] }> {
  const cdp = await connectCdp(session.port);
  try {
    let markdown = "";
    if (session.engine === "lightpanda") {
      try {
        const r = await cdp.send("LP.getMarkdown");
        const v = r.markdown || r.result || "";
        markdown = typeof v === "string" ? v : "";
      } catch {
        markdown = "";
      }
    }
    if (!markdown) {
      markdown = `# ${session.lastURL || ""}\n`;
    }
    await cdp.send("Accessibility.enable").catch(() => {});
    const ax = await cdp.send("Accessibility.getFullAXTree");
    const { lastRefs, lines } = formatRefs(Array.isArray(ax.nodes) ? ax.nodes : []);
    session.lastRefs = lastRefs;
    return { markdown, lines };
  } finally {
    cdp.close();
  }
}

async function swapToChromium(session: Session, ctx: Ctx): Promise<Session> {
  const url = session.lastURL;
  reap(session.pid, ctx.platform);
  const next = await launchEngine("chromium", ctx);
  next.lastURL = url;
  next.lastRefs = session.lastRefs;
  next.escalated = true;
  next.swapCount = session.swapCount + 1;
  if (url) await navigate(next, url);
  return next;
}

async function withCdp<T>(session: Session, fn: (cdp: Cdp) => Promise<T>): Promise<T> {
  const cdp = await connectCdp(session.port);
  try {
    return await fn(cdp);
  } finally {
    cdp.close();
  }
}

export async function runBrowser(
  argv: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    /** Engine binaries; found on `env.PATH` when absent. */
    bins?: Bins;
    /** How long a launched engine gets to answer /json/version. */
    readyMs?: number;
  } = {},
): Promise<BrowserResult> {
  const cwd = opts.cwd || process.cwd();
  const env = opts.env ?? childEnv();
  const platform = opts.platform || process.platform;
  const bins = opts.bins ?? lookupBins(env.PATH, platform);
  const ctx: Ctx = { cwd, env, platform, bins, readyMs: opts.readyMs ?? 4000 };
  const verb = String(argv[0] || "").toLowerCase();
  try {
    if (!verb || verb === "help" || verb === "-h" || verb === "--help") {
      return ok("nav|snap|click|fill|scroll|wait|hover|select|shot|pdf|stop|doctor|ensure");
    }
    if (verb === "doctor" || verb === "ensure") {
      return runDoctor({ pathEnv: env.PATH, platform, cwd, globals: await globalsRow(cwd, env.HOME) });
    }
    if (verb === "stop") {
      const s = readSession(cwd);
      if (s && s.pid) reap(s.pid, platform);
      clearSession(cwd);
      await sleep(30);
      return ok("stopped");
    }
    if (verb === "nav") {
      const url = String(argv[1] || "").trim();
      if (!url) return fail("nav <url>");
      const picked = pickEngine({ platform, verb: "nav", url, bins });
      if (!picked.engine) return fail(picked.error);
      const prev = readSession(cwd);
      if (prev && prev.pid) reap(prev.pid, platform);
      let session: Session;
      try {
        session = await launchEngine(picked.engine, ctx);
      } catch {
        return fail(INSTALL_HINT);
      }
      if (picked.engine === "lightpanda") {
        try {
          await probe(session);
        } catch {
          reap(session.pid, platform);
          if (!bins.chromium) return fail(INSTALL_HINT);
          session = await launchEngine("chromium", ctx);
          session.escalated = true;
          session.swapCount = 1;
        }
      }
      try {
        await navigate(session, url);
      } catch (err) {
        reap(session.pid, platform); // no session is written, so nothing else would ever stop this engine
        throw err;
      }
      writeSession(cwd, session);
      return ok(`engine: ${session.engine}\nurl: ${session.lastURL}`);
    }
    if (verb === "snap") {
      let session = readSession(cwd);
      if (!session || !alive(session.pid)) return fail("no browser session; run nav");
      let { markdown, lines } = await snapshot(session);
      if (session.engine === "lightpanda" && session.swapCount < 1 && bins.chromium && isBlockedSnap(markdown, lines)) {
        session = await swapToChromium(session, ctx);
        ({ markdown, lines } = await snapshot(session));
      }
      writeSession(cwd, session);
      const raw = [markdown.trim(), "", ...lines].join("\n");
      const headings = markdown.split(/\n/).filter((l) => /^#{1,6}\s/.test(l));
      const shown = [...headings.slice(0, 6), ...lines.slice(0, 24)];
      if (raw.length > 32 * 1024 || lines.length > 6) {
        const stash = writeStash({ cwd }, "snap", raw);
        return ok(
          `engine: ${session.engine}\nurl: ${session.lastURL}\n${shown.length} shown. stash=${stash}\n${shown.join("\n")}`,
        );
      }
      const body = [markdown.trim(), "", ...lines].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
      return ok(`engine: ${session.engine}\nurl: ${session.lastURL}\n\n${body}`);
    }
    if (verb === "wait") {
      const session = readSession(cwd);
      if (!session || !alive(session.pid)) return fail("no browser session; run nav");
      const raw = String(argv[1] || "1000");
      const ms = Math.min(15000, Math.max(0, Number(raw) || 0));
      await sleep(ms);
      return ok(`wait: ${ms}`);
    }
    if (verb === "scroll") {
      const session = readSession(cwd);
      if (!session || !alive(session.pid)) return fail("no browser session; run nav");
      const arg = String(argv[1] || "down");
      const rec = session.lastRefs[arg];
      const act = async (sess: Session) =>
        withCdp(sess, async (cdp) => {
          if (rec) {
            const resolved = await cdp.send("DOM.resolveNode", { backendNodeId: rec.backendNodeId });
            const objectId = asRec(resolved.object).objectId;
            if (!objectId) throw new Error("stale");
            await cdp.send("Runtime.callFunctionOn", {
              objectId,
              functionDeclaration: "function() { this.scrollIntoView({ block: 'center' }); }",
            });
            return;
          }
          let dy = 600;
          if (arg === "up") dy = -600;
          else if (/^-?\d+$/.test(arg)) dy = Number(arg);
          await cdp.send("Runtime.evaluate", {
            expression: `window.scrollBy(0, ${dy})`,
          });
        });
      try {
        await act(session);
      } catch (err) {
        const msg = errMessage(err);
        if (/stale|missing/i.test(msg)) return fail(`stale ref: ${arg}`);
        return fail(msg);
      }
      writeSession(cwd, session);
      return ok(`scroll: ${arg}`);
    }
    if (verb === "click" || verb === "fill" || verb === "hover" || verb === "select") {
      let session = readSession(cwd);
      if (!session || !alive(session.pid)) return fail("no browser session; run nav");
      const refs = session.lastRefs;
      if (!Object.keys(refs).length) return fail("no snap refs; run snap");
      const refId = String(argv[1] || "");
      const rec = refs[refId];
      if (!rec) return fail(`missing ref: ${refId}`);
      const text = argv.slice(2).join(" ");
      if (verb === "fill" && !text) return fail("fill <ref> <text>");
      if (verb === "select" && !text) return fail("select <ref> <value>");
      const act = async (sess: Session) =>
        withCdp(sess, async (cdp) => {
          const resolved = await cdp.send("DOM.resolveNode", { backendNodeId: rec.backendNodeId });
          const objectId = asRec(resolved.object).objectId;
          if (!objectId) throw new Error("stale");
          if (verb === "click") {
            await cdp.send("Runtime.callFunctionOn", {
              objectId,
              functionDeclaration: "function() { this.click(); }",
            });
          } else if (verb === "hover") {
            await cdp.send("Runtime.callFunctionOn", {
              objectId,
              functionDeclaration: "function() { this.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); }",
            });
          } else if (verb === "select") {
            await cdp.send("Runtime.callFunctionOn", {
              objectId,
              arguments: [{ value: text }],
              functionDeclaration:
                "function(v) { this.value = v; this.dispatchEvent(new Event('change', { bubbles: true })); }",
            });
          } else {
            await cdp.send("Runtime.callFunctionOn", {
              objectId,
              functionDeclaration: "function() { this.focus(); this.value = ''; }",
            });
            await cdp.send("Input.insertText", { text });
            await cdp.send("Runtime.callFunctionOn", {
              objectId,
              functionDeclaration: "function() { this.dispatchEvent(new Event('input', { bubbles: true })); }",
            });
          }
        });
      try {
        await act(session);
      } catch (err) {
        const msg = errMessage(err);
        if (/stale|missing/i.test(msg)) return fail(`stale ref: ${refId}`);
        if (session.engine !== "chromium" && session.swapCount < 1 && bins.chromium) {
          session = await swapToChromium(session, ctx);
          writeSession(cwd, session);
          try {
            await act(session);
          } catch (err2) {
            const msg2 = errMessage(err2);
            if (/stale|missing/i.test(msg2)) return fail(`stale ref: ${refId}`);
            return fail(msg2);
          }
        } else {
          return fail(msg);
        }
      }
      writeSession(cwd, session);
      return ok(`${verb}: ${refId}`);
    }
    if (verb === "shot" || verb === "pdf") {
      let session = readSession(cwd);
      if (!session || !session.lastURL) return fail("no browser session; run nav");
      const picked = pickEngine({ platform, verb, url: session.lastURL, bins, forceChromium: true });
      if (!picked.engine) return fail(picked.error);
      if (session.engine !== "chromium") {
        session = await swapToChromium(session, ctx);
      } else if (!alive(session.pid)) {
        return fail("no browser session; run nav");
      }
      const dir = sessionDir(cwd);
      fs.mkdirSync(dir, { recursive: true });
      const destName = verb === "shot" ? "shot.png" : "page.pdf";
      const dest = path.join(dir, destName);
      await withCdp(session, async (cdp) => {
        if (verb === "shot") {
          const r = await cdp.send("Page.captureScreenshot", { format: "png" });
          fs.writeFileSync(dest, Buffer.from(String(r.data), "base64"));
        } else {
          const r = await cdp.send("Page.printToPDF", {});
          fs.writeFileSync(dest, Buffer.from(String(r.data), "base64"));
        }
      });
      writeSession(cwd, session);
      return ok(`engine: ${session.engine}\nfile: ${path.join(SESSION_REL, destName)}`);
    }
    return fail("unknown verb");
  } catch (err) {
    const msg = errMessage(err).replace(/^Error:\s*/, "");
    return fail(msg);
  }
}

export async function main(argv: string[]): Promise<number> {
  const r = await runBrowser(argv, {
    cwd: process.cwd(),
    env: childEnv(),
    platform: process.platform,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.code;
}
