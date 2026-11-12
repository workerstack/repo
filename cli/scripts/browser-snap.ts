/** Reading a page: its markdown and numbered refs, what that read shows, and which pages Lightpanda cannot read. */
import { isRecord, type Json } from "../json.ts";
import { withCdp } from "./browser-cdp.ts";
import { asRec, textOf } from "./browser-session.ts";
import {
  AMAZON_RE,
  BLOCKED_SNAP_RE,
  EARTH_PATH,
  GOOGLE,
  HEADING_RE,
  MAX_HEADINGS,
  MAX_INLINE_REFS,
  MAX_REFS,
  PAINT_HOSTS,
  REF_ROLES,
  SNAP_STASH_BYTES,
  THIN_BODY,
  TITLE_LINE_RE,
} from "./browser.constants.ts";
import type { Cdp, RefEntry, Session, Snap } from "./browser.types.ts";
import { writeStash } from "./job-stash.ts";

function parseUrl(url: unknown): URL | null {
  try {
    return new URL(textOf(url));
  } catch {
    return null;
  }
}

/** Whether host `h` is `base` or under it. */
function onHost(h: string, base: string): boolean {
  return h === base || h.endsWith(`.${base}`);
}

/** Whether `url` is a page that paints on a canvas, which only Chromium reads. */
export function isPaintHost(url: unknown): boolean {
  const u = parseUrl(url);

  if (u === null) return false;
  const h = u.hostname.toLowerCase();

  if (PAINT_HOSTS.some((base) => onHost(h, base))) return true;

  if (onHost(h, GOOGLE) && u.pathname.startsWith(EARTH_PATH)) return true;

  return AMAZON_RE.test(h);
}

/** Whether a snapshot is a block page, or so thin the page did not render. */
export function isBlockedSnap(markdown: unknown, lines: unknown): boolean {
  const refs = Array.isArray(lines) ? lines.length : 0;
  const md = textOf(markdown).trim();

  if (BLOCKED_SNAP_RE.test(md)) return true;
  const body = md.replace(TITLE_LINE_RE, "").trim();

  return refs === 0 && body.length < THIN_BODY;
}

function axText(v: Json | undefined): string {
  return textOf(isRecord(v) ? v.value : v);
}

function formatRefs(nodes: Json[]): {
  lastRefs: Record<string, RefEntry>;
  lines: string[];
} {
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
      backendNodeId: node.backendDOMNodeId ?? node.backendNodeId,
      name,
      nodeId: node.nodeId,
      role,
    };
    lines.push(`[${id}] ${role} ${name}`.trim());
  }

  return { lastRefs, lines };
}

async function lpMarkdown(cdp: Cdp): Promise<string> {
  try {
    const r = await cdp.send("LP.getMarkdown");
    const v = [r.markdown, r.result].find(Boolean);

    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

/** The page of `session`: Lightpanda's markdown or a title line, and its refs, which `session` now remembers. */
export function snapshot(session: Session): Promise<Snap> {
  return withCdp(session, async (cdp) => {
    const md = session.engine === "lightpanda" ? await lpMarkdown(cdp) : "";
    const markdown = md === "" ? `# ${session.lastURL}\n` : md;
    await cdp.send("Accessibility.enable").catch(() => {});
    const ax = await cdp.send("Accessibility.getFullAXTree");
    const { lastRefs, lines } = formatRefs(Array.isArray(ax.nodes) ? ax.nodes : []);
    session.lastRefs = lastRefs;

    return { lines, markdown };
  });
}

/** What `snap` prints: the whole page, or past the inline limits its headings and first refs beside a stash. */
export function snapText(session: Session, snap: Snap, cwd: string): string {
  const { markdown, lines } = snap;
  const head = `engine: ${session.engine}\nurl: ${session.lastURL}\n`;
  const raw = [markdown.trim(), "", ...lines].join("\n");

  if (raw.length > SNAP_STASH_BYTES || lines.length > MAX_INLINE_REFS) {
    const headings = markdown.split("\n").filter((l) => HEADING_RE.test(l));
    const shown = [...headings.slice(0, MAX_HEADINGS), ...lines.slice(0, MAX_REFS)];
    const stash = writeStash({ cwd }, "snap", raw);

    return `${head}${shown.length} shown. stash=${stash}\n${shown.join("\n")}`;
  }

  const body = [markdown.trim(), "", ...lines].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");

  return `${head}\n${body}`;
}
