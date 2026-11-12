/** Calls the ElevenLabs and OpenAI APIs: the account check, the voice list, and the raw request under both. */
import { isNumber, isRecord, isString, type Json } from "../json.ts";
import type { FetchResult } from "./listen.types.ts";
import { parsedFetch } from "./parsed-fetch.ts";
import { resolveProvider } from "./speak-config.ts";
import {
  ELEVEN_API,
  ELEVENLABS,
  FORBIDDEN,
  HTTP_BODY_CHARS,
  OPENAI,
  OPENAI_API,
  OPENAI_VOICES,
  SETUP,
  UNAUTHORIZED,
} from "./speak.constants.ts";
import type { ApiOpts, FetchFn, ProviderOpts, SpeakCfg } from "./speak.types.ts";

const MISSING_PERMISSIONS = /missing_permissions/i;
const MISSING_PERMISSION = /missing permission/i;
const REJECTED_KEY = /unauthorized|invalid.?api.?key|authentication/i;

/** A status or label as text; anything else is blank. */
function plain(value: Json | undefined): string {
  return isString(value) || isNumber(value) ? String(value) : "";
}

/** A label as text, or `fallback` when it is blank. */
function plainOr(value: Json | undefined, fallback: string): string {
  const text = plain(value);

  return text === "" ? fallback : text;
}

/** A one-line error for a failed reply: a missing permission, a rejected key, or the status and body head. */
export function formatHttpError(status: number | string, body: string | undefined, provider: string): string {
  const n = Number(status);
  const raw = body ?? "";
  const code = Number.isNaN(n) || n === 0 ? String(status) : String(n);

  if (MISSING_PERMISSIONS.test(raw)) return `${provider} key present but missing permission (${code}). setup: ${SETUP}`;

  const auth = n === UNAUTHORIZED || n === FORBIDDEN || REJECTED_KEY.test(raw);

  if (auth) return `${provider} key missing or rejected (${code}). setup: ${SETUP}`;

  return `${status} ${raw.slice(0, HTTP_BODY_CHARS)}`.trim();
}

/** True for a thrown value that carries a text message. */
function hasMessage(cause: unknown): cause is { message: string } {
  return typeof cause === "object" && cause !== null && "message" in cause && typeof cause.message === "string";
}

/** True for a thrown string or number, which prints as itself. */
function isPrintable(cause: unknown): cause is string | number {
  return typeof cause === "string" || typeof cause === "number";
}

/** True for a thrown object or null, which prints as its tag. */
function isTagged(cause: unknown): cause is object | null {
  return typeof cause === "object";
}

/** The message of a thrown value, or the value itself as text. */
export function errMessage(cause: unknown): string {
  if (hasMessage(cause) && cause.message !== "") return cause.message;

  if (isPrintable(cause)) return String(cause);

  return isTagged(cause) ? Object.prototype.toString.call(cause) : "";
}

/** True when the platform's fetch is there to call. */
function isCallable(value: unknown): value is (...args: never[]) => void {
  return typeof value === "function";
}

/** The platform's fetch, or undefined when it has none. */
export function globalFetch(): FetchFn | undefined {
  const found: unknown = globalThis.fetch;

  if (!isCallable(found)) return undefined;

  return (url, { method, headers, body }) => parsedFetch(url, { body: body ?? null, headers, method });
}

async function bodyText(res: FetchResult | null): Promise<string> {
  try {
    return (await res?.text()) ?? "";
  } catch {
    return "";
  }
}

async function failure(url: string, res: FetchResult | null): Promise<Error> {
  const status = res?.status ?? "err";
  const text = await bodyText(res);
  const provider = url.includes(ELEVENLABS) ? ELEVENLABS : OPENAI;

  return new Error(formatHttpError(status, text, provider));
}

/** The ok reply to one request, or the formatted error of a failed one. */
async function apiFetch(url: string, { method = "GET", headers, body, fetchFn }: ApiOpts): Promise<FetchResult> {
  const fn = fetchFn ?? globalFetch();

  if (fn === undefined) throw new Error("fetch is not available");
  const res = await fn(url, { body: body === undefined ? undefined : JSON.stringify(body), headers, method });

  if (res?.ok !== true) throw await failure(url, res);

  return res;
}

/** The parsed JSON body of the reply. */
async function apiJson(url: string, opts: ApiOpts): Promise<Json> {
  const res = await apiFetch(url, opts);

  return await res.json();
}

/** The audio bytes of the reply. */
export async function apiBytes(url: string, opts: ApiOpts): Promise<Buffer> {
  const res = await apiFetch(url, opts);

  return Buffer.from(new Uint8Array(await res.arrayBuffer()));
}

async function elevenWhoami(cfg: SpeakCfg, fetchFn: FetchFn | undefined): Promise<string> {
  try {
    const u = await apiJson(`${ELEVEN_API}/user`, { fetchFn, headers: { "xi-api-key": cfg.elevenlabs.apiKey } });
    const user = isRecord(u) ? u : {};
    const email = plainOr(user.email, "ok");
    const tier = plainOr(isRecord(user.subscription) ? user.subscription.tier : undefined, "-");

    return `elevenlabs  ${email}  tier=${tier}`;
  } catch (e) {
    if (MISSING_PERMISSION.test(errMessage(e)))
      return "elevenlabs  ok (scoped key; whoami needs user_read). voices/say still work";

    throw e;
  }
}

export async function whoami({ provider, cfg, fetchFn }: ProviderOpts): Promise<string> {
  if (resolveProvider(cfg, provider) === ELEVENLABS) return elevenWhoami(cfg, fetchFn);
  await apiJson(`${OPENAI_API}/models`, { fetchFn, headers: { Authorization: `Bearer ${cfg.openai.apiKey}` } });

  return "openai ok";
}

function voiceLine(v: Json): string {
  if (!isRecord(v)) return "undefined  undefined";

  return `${plainOr(v.voice_id, "undefined")}  ${plainOr(v.name, "undefined")}`;
}

export async function voices({ provider, cfg, fetchFn }: ProviderOpts): Promise<string> {
  if (resolveProvider(cfg, provider) === OPENAI) return OPENAI_VOICES.join("\n");
  const j = await apiJson(`${ELEVEN_API}/voices`, { fetchFn, headers: { "xi-api-key": cfg.elevenlabs.apiKey } });
  const list: Json[] = isRecord(j) && Array.isArray(j.voices) ? j.voices : [];

  return list.map(voiceLine).join("\n");
}
