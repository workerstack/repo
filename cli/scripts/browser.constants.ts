import { REPO, STATE } from "../repo-dirs.ts";
import type { Capture, Engine, FakeCdpState } from "./browser.types.ts";

/** Where the session, its profile and its captures live, relative to the root. */
export const SESSION_REL: string = `${REPO}/${STATE}/browser`;
export const SESSION_FILE = "session.json";
export const PROFILE_DIR = "profile";
export const JSON_INDENT = 2;
export const ENGINES: readonly Engine[] = ["lightpanda", "chromium"];

/** The verbs `repo browser` takes. */
export const USAGE = "nav|snap|click|fill|scroll|wait|hover|select|shot|pdf|stop|doctor|ensure";
export const HELP_VERBS: ReadonlySet<string> = /* @__PURE__ */ new Set(["", "help"]);

/** How to call `repo browser`. */
export const BROWSER_USAGE: string = `usage: repo browser ${USAGE} [<args>…]`;
export const NAV = "nav";

/** Verbs only Chromium can serve. */
export const CHROMIUM_VERBS: ReadonlySet<string> = /* @__PURE__ */ new Set(["shot", "pdf", "trace"]);

/** What a verb prints when it cannot run. */
export const NO_SESSION = "no browser session; run nav";
export const NO_REFS = "no snap refs; run snap";
export const NAV_USAGE = "nav <url>";
export const UNKNOWN_VERB = "unknown verb";
export const STOPPED = "stopped";
export const ENGINE_NOT_READY = "engine not ready";
export const STALE = "stale";
export const STALE_RE: RegExp = /stale|missing/i;
export const ERROR_PREFIX: RegExp = /^Error:\s*/;

/** The usage a ref verb that takes text prints without it. */
const TEXT_USAGE = {
  fill: "fill <ref> <text>",
  select: "select <ref> <value>",
} as const satisfies Readonly<Record<string, string>>;

function takesText(verb: string): verb is keyof typeof TEXT_USAGE {
  return Object.hasOwn(TEXT_USAGE, verb);
}

/** The usage the ref verb `verb` prints without its text, or undefined when it takes none. */
export function textUsageOf(verb: string): string | undefined {
  return takesText(verb) ? TEXT_USAGE[verb] : undefined;
}

/** Where a ref verb's text starts in argv. */
export const TEXT_ARG = 2;

/** Timing: engine startup, its poll, the settle after a stop, a Windows tree kill, and the `wait` verb. */
export const READY_MS = 4000;
export const POLL_MS = 40;
export const STOP_SETTLE_MS = 30;
export const TASKKILL_MS = 1500;
export const WAIT_DEFAULT = "1000";
export const WAIT_MAX_MS = 15_000;

export const HOST = "127.0.0.1";
export const VERSION_PATH = "/json/version";

/** `scroll`: the step of a bare or `up` scroll. */
export const SCROLL_DOWN = "down";
export const SCROLL_UP = "up";
export const SCROLL_STEP = 600;
export const SCROLL_BY_RE: RegExp = /^-?\d+$/;

/** `snap`: what goes to a stash, and how much of it the reply shows. */
export const SNAP_STASH_BYTES: number = 32 * 1024;
export const MAX_INLINE_REFS = 6;
export const MAX_HEADINGS = 6;
export const MAX_REFS = 24;
export const HEADING_RE: RegExp = /^#{1,6}\s/;
export const TITLE_LINE_RE: RegExp = /^#\s+\S+\s*$/m;

/** A snapshot body shorter than this, with no refs, is a page that did not render. */
export const THIN_BODY = 80;

/** What a block or bot-check page shows instead of its content, as regex alternatives. */
const BLOCK_PHRASES =
  "enable javascript|javascript (is )?(required|disabled)|checking your browser|just a moment|captcha|" +
  "access denied|sorry.*robot|continue shopping|attention required|cf-browser-verification|verify you are a human";

export const BLOCKED_SNAP_RE: Readonly<RegExp> = /* @__PURE__ */ new RegExp(BLOCK_PHRASES, "i");

/** The accessibility roles a snapshot numbers as refs. */
export const REF_ROLES: ReadonlySet<string> = /* @__PURE__ */ new Set([
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

/** Hosts that paint on a canvas, so only Chromium reads them. */
export const PAINT_HOSTS: readonly string[] = [
  "figma.com",
  "docs.google.com",
  "sheets.google.com",
  "slides.google.com",
  "mail.google.com",
  "earth.google.com",
];

export const GOOGLE = "google.com";
export const EARTH_PATH = "/earth";
export const AMAZON_RE: RegExp = /(^|\.)amazon\./;

/** The page functions the ref verbs call on a node. */
export const CLICK_FN = "function() { this.click(); }";
export const HOVER_FN = "function() { this.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); }";
export const SELECT_FN = "function(v) { this.value = v; this.dispatchEvent(new Event('change', { bubbles: true })); }";
export const FOCUS_FN = "function() { this.focus(); this.value = ''; }";
export const INPUT_FN = "function() { this.dispatchEvent(new Event('input', { bubbles: true })); }";
export const SCROLL_INTO_FN = "function() { this.scrollIntoView({ block: 'center' }); }";

/** The capture verbs. */
export const SHOT: Readonly<Capture> = {
  file: "shot.png",
  method: "Page.captureScreenshot",
  params: { format: "png" },
  verb: "shot",
};

export const PDF: Readonly<Capture> = {
  file: "page.pdf",
  method: "Page.printToPDF",
  params: {},
  verb: "pdf",
};

/** Websocket framing (RFC 6455): first byte, length marks, masks, opcodes and header sizes. */
export const FIN_TEXT = 0x81;
export const LEN16 = 126;
export const LEN64 = 127;
export const MAX_LEN16 = 65_536;
export const MASK_BIT = 0x80;
export const LEN_MASK = 0x7f;
export const OPCODE_MASK = 0x0f;
export const OP_TEXT = 0x1;
export const OP_BINARY = 0x2;
export const OP_CLOSE = 0x8;
export const HEADER = 2;
export const HEADER16 = 4;
export const HEADER64 = 10;
export const MASK_LEN = 4;
export const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** The fake engine: its start state, its error code, its one-pixel captures and the nodes it knows. */
export const FAKE_STATE: Readonly<FakeCdpState> = {
  engine: "lightpanda",
  failProbe: false,
  markdown: "",
  thinSnap: false,
  url: "about:blank",
};

export const CDP_ERROR = -32_000;
export const NOT_FOUND_STATUS = 404;
export const PROBE_METHODS: ReadonlySet<string> = /* @__PURE__ */ new Set(["Browser.getVersion", "Target.getTargets"]);
export const HOME_NODE = 10;
export const SEARCH_NODE = 11;
export const KNOWN_NODES: ReadonlySet<number> = /* @__PURE__ */ new Set([HOME_NODE, SEARCH_NODE]);

export const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const PDF_B64: string =
  "JVBERi0xLjAKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMy" +
  "AwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3hbMCAwIDMgM10vUGFyZW50IDIgMCBSL1Jlc291cmNl" +
  "czw+Pj4KZW5kb2JqCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCj" +
  "AwMDAwMDAxMTUgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgoxOTAKJSVFT0Y=";
