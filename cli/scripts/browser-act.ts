import { withCdp } from "./browser-cdp.ts";
import { canSwap, swapToChromium } from "./browser-engine.ts";
import { asRec, errMessage, fail, liveSession, ok, writeSession } from "./browser-session.ts";
/** The verbs that act on the page: scroll, and the ref verbs with their one Chromium retry. */
import {
  CLICK_FN,
  FOCUS_FN,
  HOVER_FN,
  INPUT_FN,
  NO_REFS,
  NO_SESSION,
  SCROLL_BY_RE,
  SCROLL_DOWN,
  SCROLL_INTO_FN,
  SCROLL_STEP,
  SCROLL_UP,
  SELECT_FN,
  STALE,
  STALE_RE,
  TEXT_ARG,
  TEXT_USAGE,
} from "./browser.constants.ts";
import type { Act, BrowserResult, Cdp, Ctx, RefEntry, Session, Verb } from "./browser.types.ts";

const callOn = (cdp: Cdp, objectId: unknown, functionDeclaration: string) =>
  cdp.send("Runtime.callFunctionOn", { functionDeclaration, objectId });

export async function fillAct(cdp: Cdp, objectId: unknown, text: string): Promise<void> {
  await callOn(cdp, objectId, FOCUS_FN);
  await cdp.send("Input.insertText", { text });
  await callOn(cdp, objectId, INPUT_FN);
}

export const selectAct: Act = (cdp, objectId, text) =>
  cdp.send("Runtime.callFunctionOn", {
    arguments: [{ value: text }],
    functionDeclaration: SELECT_FN,
    objectId,
  });

/** The object id of a ref's node; a node the page no longer has is stale. */
async function resolveRef(cdp: Cdp, rec: RefEntry): Promise<unknown> {
  const resolved = await cdp.send("DOM.resolveNode", {
    backendNodeId: rec.backendNodeId,
  });
  const objectId = asRec(resolved.object).objectId;
  if (!objectId) throw new Error(STALE);
  return objectId;
}

/** Runs `fn` on `session`; the message of what it threw, or null. */
async function attempt(session: Session, fn: (cdp: Cdp) => Promise<unknown>): Promise<string | null> {
  try {
    await withCdp(session, fn);
    return null;
  } catch (err) {
    return errMessage(err);
  }
}

const refFail = (msg: string, ref: string): BrowserResult => fail(STALE_RE.test(msg) ? `stale ref: ${ref}` : msg);

export const clickAct: Act = (cdp, objectId) => callOn(cdp, objectId, CLICK_FN);
export const hoverAct: Act = (cdp, objectId) => callOn(cdp, objectId, HOVER_FN);

function scrollDelta(arg: string): number {
  if (arg === SCROLL_UP) return -SCROLL_STEP;
  return SCROLL_BY_RE.test(arg) ? Number(arg) : SCROLL_STEP;
}

export async function scroll(argv: string[], ctx: Ctx): Promise<BrowserResult> {
  const session = liveSession(ctx.cwd);
  if (!session) return fail(NO_SESSION);
  const arg = String(argv[1] || SCROLL_DOWN);
  const rec = session.lastRefs[arg];
  const error = await attempt(session, async (cdp) => {
    if (rec) return callOn(cdp, await resolveRef(cdp, rec), SCROLL_INTO_FN);
    return cdp.send("Runtime.evaluate", {
      expression: `window.scrollBy(0, ${scrollDelta(arg)})`,
    });
  });
  if (error !== null) return refFail(error, arg);
  writeSession(ctx.cwd, session);
  return ok(`scroll: ${arg}`);
}

/** The ref argv[1] names and the text after it; the usage error when there is none. */
function targetOf(
  verb: string,
  argv: string[],
  session: Session,
): { refId: string; rec: RefEntry; text: string } | string {
  if (!Object.keys(session.lastRefs).length) return NO_REFS;
  const refId = String(argv[1] || "");
  const rec = session.lastRefs[refId];
  if (!rec) return `missing ref: ${refId}`;
  const text = argv.slice(TEXT_ARG).join(" ");
  const usage = TEXT_USAGE[verb];
  if (usage && !text) return usage;
  return { rec, refId, text };
}

/** A ref verb: `act` on the node of ref argv[1], retried once on Chromium when Lightpanda fails it. */
export function refVerb(verb: string, act: Act): Verb {
  return async (argv, ctx) => {
    let session = liveSession(ctx.cwd);
    if (!session) return fail(NO_SESSION);
    const target = targetOf(verb, argv, session);
    if (typeof target === "string") return fail(target);
    const { refId, rec, text } = target;
    const run = async (cdp: Cdp) => act(cdp, await resolveRef(cdp, rec), text);
    let error = await attempt(session, run);
    if (error !== null && !STALE_RE.test(error) && canSwap(session, ctx.bins)) {
      session = await swapToChromium(session, ctx);
      writeSession(ctx.cwd, session);
      error = await attempt(session, run);
    }
    if (error !== null) return refFail(error, refId);
    writeSession(ctx.cwd, session);
    return ok(`${verb}: ${refId}`);
  };
}
