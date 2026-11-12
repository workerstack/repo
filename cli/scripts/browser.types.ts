import type { Json, JsonObject } from "../json.ts";

/** A parsed JSON object, or a CDP request's params and reply. */
export type Rec = JsonObject;

/** The engines a session runs on. */
export type Engine = "lightpanda" | "chromium";

/** The engine binaries found on PATH; an empty string is one not found. */
export type Bins = {
  lightpanda: string;
  chromium: string;
};

/** One remembered snapshot ref. */
export type RefEntry = {
  role: string;
  name: string;
  backendNodeId: Json | undefined;
  nodeId: Json | undefined;
};

/** The live browser session stored in session.json. */
export type Session = {
  engine: Engine;
  pid?: number | undefined;
  port: number;
  lastURL: string;
  lastRefs: Record<string, RefEntry>;
  escalated: boolean;
  swapCount: number;
};

/** What one `repo browser` call prints and exits with. */
export type BrowserResult = {
  code: number;
  stdout: string;
  stderr: string;
};

/** A CDP client on one websocket. */
export type Cdp = {
  send(method: string, params?: Rec): Promise<Rec>;
  close(): void;
};

/** What the fake CDP engine serves and records. */
export type FakeCdpState = {
  url: string;
  markdown: string;
  failProbe: boolean;
  thinSnap: boolean;
  engine: string;
  axNodes?: Json[];
  /** Per CDP method: a record is the reply, a string is the error message. */
  replies?: Record<string, Rec | string>;
  /** Every CDP request the fake receives, in order. */
  calls?: { method: string; params: Rec }[];
};

/** A running fake CDP engine. */
export type FakeCdp = {
  port: number;
  close(): void;
  state: FakeCdpState;
};

/** What every verb runs in: the root to find the session under, the env and platform, and the engines. */
export type Ctx = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  bins: Bins;
  readyMs: number;
};

/** What `runBrowser` takes; each field falls back to the process's own. */
export type RunOpts = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Engine binaries; found on `env.PATH` when absent. */
  bins?: Bins;
  /** How long a launched engine gets to answer /json/version. */
  readyMs?: number;
};

/** What `pickEngine` weighs. */
export type PickOpts = {
  platform?: NodeJS.Platform;
  verb?: string;
  url?: string;
  bins?: Partial<Bins> & Record<string, string | undefined>;
  forceChromium?: boolean;
};

/** The engine `pickEngine` chose, or why none fits. */
export type Picked = { engine: Engine; error?: undefined } | { engine: null; error: string };

/** One decoded websocket message. */
export type WsMessage = { type: "close" } | { type: "msg"; data: string };

/** The messages a buffer held and the bytes left of a partial frame. */
export type WsDecoded = {
  messages: WsMessage[];
  rest: Buffer;
};

/** A snapshot: the page markdown and one line per ref. */
export type Snap = {
  markdown: string;
  lines: string[];
};

/** A verb's handler. */
export type Verb = (argv: string[], ctx: Ctx) => Promise<BrowserResult>;

/** What a ref verb does to the node it resolved: the CDP reply, or nothing when the act sends several. */
export type Act = (cdp: Cdp, objectId: string, text: string) => Promise<Rec | void>;

/** A capture verb: the file it writes and the CDP call that renders it. */
export type Capture = {
  verb: string;
  file: string;
  method: string;
  params: Rec;
};
