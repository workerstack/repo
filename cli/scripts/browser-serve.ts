/** The fake Lightpanda/Chromium engine tests and the probe run: `/json/version` over http, CDP over a websocket. */
import crypto from "node:crypto";
import http from "node:http";
import type { Duplex } from "node:stream";

import { asRec, errMessage, filled } from "./browser-session.ts";
import { decodeWsFrames, encodeWsFrame } from "./browser-ws.ts";
import {
  CDP_ERROR,
  FAKE_STATE,
  HOME_NODE,
  HOST,
  KNOWN_NODES,
  NOT_FOUND_STATUS,
  PDF_B64,
  PNG_B64,
  PROBE_METHODS,
  SEARCH_NODE,
  STALE,
  VERSION_PATH,
  WS_GUID,
} from "./browser.constants.ts";
import type { FakeCdp, FakeCdpState, Rec, WsMessage } from "./browser.types.ts";

type Handler = (state: FakeCdpState, params: Rec) => Rec;

function empty(): Rec {
  return {};
}

function defaultAx(url: string): Rec[] {
  return [
    {
      childIds: ["2", "3"],
      name: { value: filled(url) ?? "page" },
      nodeId: "1",
      role: { value: "WebArea" },
    },
    {
      backendDOMNodeId: HOME_NODE,
      childIds: [],
      name: { value: "Home" },
      nodeId: "2",
      role: { value: "link" },
    },
    {
      backendDOMNodeId: SEARCH_NODE,
      childIds: [],
      name: { value: "Search" },
      nodeId: "3",
      role: { value: "textbox" },
    },
  ];
}

function navigate(state: FakeCdpState, params: Rec): Rec {
  state.url = typeof params.url === "string" && params.url !== "" ? params.url : state.url;
  state.markdown = `# ${state.url}\n\nhello`;
  return { frameId: "f1" };
}

function resolveNode(_state: FakeCdpState, params: Rec): Rec {
  const id = params.backendNodeId;
  if (typeof id !== "number" || !KNOWN_NODES.has(id)) throw new Error(STALE);
  return { object: { objectId: `oid-${id}` } };
}

/** What the fake answers per CDP method; any other method gets `{}`. */
const HANDLERS: ReadonlyMap<string, Handler> = /* @__PURE__ */ new Map<string, Handler>([
  ["Browser.getVersion", (st) => ({ product: filled(st.engine) ?? "lightpanda", protocolVersion: "1.3" })],
  [
    "Target.getTargets",
    (st) => ({
      targetInfos: [
        {
          attached: true,
          targetId: "t1",
          type: "page",
          url: filled(st.url) ?? "about:blank",
        },
      ],
    }),
  ],
  ["Page.enable", empty],
  ["Accessibility.enable", empty],
  ["Runtime.enable", empty],
  ["DOM.enable", empty],
  ["Page.navigate", navigate],
  [
    "LP.getMarkdown",
    (st) => ({
      markdown: st.thinSnap ? `# ${st.url}\n` : (filled(st.markdown) ?? `# ${st.url}\n\nhello`),
    }),
  ],
  ["Accessibility.getFullAXTree", (st) => ({ nodes: st.thinSnap ? [] : (st.axNodes ?? defaultAx(st.url)) })],
  ["DOM.resolveNode", resolveNode],
  ["Runtime.callFunctionOn", () => ({ result: { type: "undefined" } })],
  ["Input.insertText", empty],
  ["Page.captureScreenshot", () => ({ data: PNG_B64 })],
  ["Page.printToPDF", () => ({ data: PDF_B64 })],
  ["Runtime.evaluate", (st) => ({ result: { type: "string", value: st.markdown } })],
]);

/** The fake's reply to one CDP request, which `state.calls` records; a scripted or probe failure throws. */
export function handleCdp(state: FakeCdpState, method: string, params: Rec): Rec {
  state.calls?.push({ method, params });
  const scripted = state.replies?.[method];
  if (typeof scripted === "string") throw new Error(scripted);
  if (scripted !== undefined) return scripted;
  if (state.failProbe && PROBE_METHODS.has(method)) throw new Error("probe failed");
  return (HANDLERS.get(method) ?? empty)(state, params);
}

function reply(socket: Duplex, state: FakeCdpState, data: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }
  const msg = asRec(parsed);
  function send(body: Rec) {
    return socket.write(encodeWsFrame(JSON.stringify(body)));
  }
  Promise.resolve()
    .then(() => handleCdp(state, String(msg.method), asRec(msg.params)))
    .then((result) => send({ id: msg.id, result }))
    .catch((err: unknown) => send({ error: { code: CDP_ERROR, message: errMessage(err) }, id: msg.id }));
}

function serveFrames(socket: Duplex, state: FakeCdpState, messages: WsMessage[]): void {
  for (const m of messages) {
    if (m.type === "close") {
      socket.end();
      return;
    }
    reply(socket, state, m.data);
  }
}

function upgrade(req: http.IncomingMessage, socket: Duplex, state: FakeCdpState): void {
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || key === "") {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  let buf = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    const decoded = decodeWsFrames(Buffer.concat([buf, chunk]));
    buf = Buffer.from(decoded.rest);
    serveFrames(socket, state, decoded.messages);
  });
}

function answer(req: http.IncomingMessage, res: http.ServerResponse, body: () => string): void {
  if (req.url?.startsWith(VERSION_PATH) === true) {
    res.setHeader("content-type", "application/json");
    res.end(body());
    return;
  }
  res.statusCode = NOT_FOUND_STATUS;
  res.end();
}

/** Undocumented test helper: fake Lightpanda/Chromium CDP. */
export async function serveCdp(
  state: Partial<FakeCdpState> = {},
  { port = 0 }: { port?: number } = {},
): Promise<FakeCdp> {
  const st: FakeCdpState = { ...FAKE_STATE, ...state };
  let bound = 0;
  function version() {
    return JSON.stringify({
      Browser: filled(st.engine) ?? "Lightpanda",
      "Protocol-Version": "1.3",
      webSocketDebuggerUrl: `ws://${HOST}:${bound}/devtools/browser/repo`,
    });
  }
  const server = http.createServer((req, res) => answer(req, res, version));
  server.on("upgrade", (req: http.IncomingMessage, socket: Duplex) => upgrade(req, socket, st));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, resolve);
  });
  bound = Number(asRec(server.address()).port);
  return { close: () => server.close(), port: bound, state: st };
}
