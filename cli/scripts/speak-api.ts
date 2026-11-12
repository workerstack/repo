/** Calls the ElevenLabs and OpenAI APIs: the account check, the voice list, and the raw request under both. */
import { isRecord, type Json } from "../json.ts";
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
import type { ApiOpts, FetchFn, FetchResult, ProviderOpts, SpeakCfg } from "./speak.types.ts";

const MISSING_PERMISSIONS = /missing_permissions/i;
const MISSING_PERMISSION = /missing permission/i;
const REJECTED_KEY = /unauthorized|invalid.?api.?key|authentication/i;

/** A status or label as text; anything else is blank. */
function plain(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** A label as text, or `fallback` when it is blank. */
function plainOr(value: unknown, fallback: string): string {
  const text = plain(value);

  return text === "" ? fallback : text;
}

/** A one-line error for a failed reply: a missing permission, a rejected key, or the status and body head. */
export function formatHttpError(status: unknown, body: unknown, provider: string): string {
  const n = Number(status);
  const raw = plain(body);
  const code = Number.isNaN(n) || n === 0 ? plain(status) : String(n);

  if (MISSING_PERMISSIONS.test(raw)) return `${provider} key present but missing permission (${code}). setup: ${SETUP}`;

  const auth = n === UNAUTHORIZED || n === FORBIDDEN || REJECTED_KEY.test(raw);

  if (auth) return `${provider} key missing or rejected (${code}). setup: ${SETUP}`;

  return `${plain(status)} ${raw.slice(0, HTTP_BODY_CHARS)}`.trim();
}

/** The message of a thrown value, or the value itself as text. */
export function errMessage(e: unknown): string {
  const m = typeof e === "object" && e !== null && "message" in e ? e.message : undefined;

  if (typeof m === "string" && m !== "") return m;

  return typeof e === "object" ? Object.prototype.toString.call(e) : plain(e);
}

/** The platform's fetch, or undefined when it has none. */
export function globalFetch(): FetchFn | undefined {
  const found: unknown = globalThis.fetch;

  if (typeof found !== "function") return undefined;

  return (url, { method, headers, body }) => parsedFetch(url, { body: body ?? null, headers, method });
}

async function bodyText(res: FetchResult | null): Promise<string> {
  try {
    return typeof res?.text === "function" ? await res.text() : "";
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

/** The parsed JSON body of the reply, or an empty object when it has no reader. */
async function apiJson(url: string, opts: ApiOpts): Promise<Json> {
  const res = await apiFetch(url, opts);

  return typeof res.json === "function" ? await res.json() : {};
}

/** The audio bytes of the reply, from its reader or its body. */
export async function apiBytes(url: string, opts: ApiOpts): Promise<Buffer> {
  const res = await apiFetch(url, opts);

  if (typeof res.arrayBuffer === "function") return Buffer.from(new Uint8Array(await res.arrayBuffer()));

  if (Buffer.isBuffer(res.body)) return res.body;

  return Buffer.from(Array.isArray(res.body) ? res.body.map(Number) : []);
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
