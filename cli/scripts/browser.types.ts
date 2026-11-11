/** A parsed JSON object, or a CDP request's params and reply. */
export type Rec = Record<string, unknown>;

/** The engines a session runs on. */
export type Engine = "lightpanda" | "chromium";

/** The engine binaries found on PATH; an empty string is one not found. */
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

/** What one `repo browser` call prints and exits with. */
export interface BrowserResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** A CDP client on one websocket. */
export interface Cdp {
  send(method: string, params?: Rec): Promise<Rec>;
  close(): void;
}

/** What the fake CDP engine serves and records. */
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

/** A running fake CDP engine. */
export interface FakeCdp {
  port: number;
  close(): void;
  state: FakeCdpState;
}

/** What every verb runs in: the root to find the session under, the env and platform, and the engines. */
export interface Ctx {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  bins: Bins;
  readyMs: number;
}

/** What `runBrowser` takes; each field falls back to the process's own. */
export interface RunOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Engine binaries; found on `env.PATH` when absent. */
  bins?: Bins;
  /** How long a launched engine gets to answer /json/version. */
  readyMs?: number;
}

/** What `pickEngine` weighs. */
export interface PickOpts {
  platform?: NodeJS.Platform;
  verb?: string;
  url?: string;
  bins?: Partial<Bins> & Record<string, string | undefined>;
  forceChromium?: boolean;
}

/** The engine `pickEngine` chose, or why none fits. */
export type Picked = { engine: Engine; error?: undefined } | { engine: null; error: string };

/** One decoded websocket message. */
export type WsMessage = { type: "close" } | { type: "msg"; data: string };

/** The messages a buffer held and the bytes left of a partial frame. */
export interface WsDecoded {
  messages: WsMessage[];
  rest: Buffer;
}

/** A snapshot: the page markdown and one line per ref. */
export interface Snap {
  markdown: string;
  lines: string[];
}

/** A verb's handler. */
export type Verb = (argv: string[], ctx: Ctx) => Promise<BrowserResult>;

/** What a ref verb does to the node it resolved. */
export type Act = (cdp: Cdp, objectId: unknown, text: string) => Promise<unknown>;

/** A capture verb: the file it writes and the CDP call that renders it. */
export interface Capture {
  verb: string;
  file: string;
  method: string;
  params: Rec;
}
