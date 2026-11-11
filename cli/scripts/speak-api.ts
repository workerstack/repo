/** Calls the ElevenLabs and OpenAI APIs: the account check, the voice list, and the raw request under both. */
import { isRecord } from "./hook-input.ts";
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

/** A one-line error for a failed reply: a missing permission, a rejected key, or the status and body head. */
export function formatHttpError(status: unknown, body: unknown, provider: string): string {
  const n = Number(status);
  const raw = String(body || "");
  if (/missing_permissions/i.test(raw)) {
    return `${provider} key present but missing permission (${n || status}). setup: ${SETUP}`;
  }
  const auth = n === UNAUTHORIZED || n === FORBIDDEN || /unauthorized|invalid.?api.?key|authentication/i.test(raw);
  if (auth) {
    return `${provider} key missing or rejected (${n || status}). setup: ${SETUP}`;
  }
  return `${status} ${raw.slice(0, HTTP_BODY_CHARS)}`.trim();
}

/** The message of a thrown value, or the value itself as text. */
export function errMessage(e: unknown): string {
  const m = isRecord(e) ? e.message : undefined;
  return String(m || e);
}

/** The platform's fetch, or undefined when it has none. */
export function globalFetch(): FetchFn | undefined {
  const found: unknown = globalThis.fetch;
  if (typeof found !== "function") return undefined;
  return (url, { method, headers, body }) => fetch(url, { body: body ?? null, headers, method });
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
  if (!fn) throw new Error("fetch is not available");
  const res = await fn(url, { body: body ? JSON.stringify(body) : undefined, headers, method });
  if (!res?.ok) throw await failure(url, res);
  return res;
}

/** The parsed JSON body of the reply, or an empty object when it has no reader. */
async function apiJson(url: string, opts: ApiOpts): Promise<unknown> {
  const res = await apiFetch(url, opts);
  return typeof res.json === "function" ? res.json() : {};
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
    const email = user.email ? String(user.email) : "ok";
    const tier = isRecord(user.subscription) && user.subscription.tier ? String(user.subscription.tier) : "-";
    return `elevenlabs  ${email}  tier=${tier}`;
  } catch (e) {
    if (/missing permission/i.test(errMessage(e))) {
      return "elevenlabs  ok (scoped key; whoami needs user_read). voices/say still work";
    }
    throw e;
  }
}

export async function whoami({ provider, cfg, fetchFn }: ProviderOpts): Promise<string> {
  if (resolveProvider(cfg, provider) === ELEVENLABS) return elevenWhoami(cfg, fetchFn);
  await apiJson(`${OPENAI_API}/models`, { fetchFn, headers: { Authorization: `Bearer ${cfg.openai.apiKey}` } });
  return "openai ok";
}

export async function voices({ provider, cfg, fetchFn }: ProviderOpts): Promise<string> {
  if (resolveProvider(cfg, provider) === OPENAI) return OPENAI_VOICES.join("\n");
  const j = await apiJson(`${ELEVEN_API}/voices`, { fetchFn, headers: { "xi-api-key": cfg.elevenlabs.apiKey } });
  const list: unknown[] = isRecord(j) && Array.isArray(j.voices) ? j.voices : [];
  return list.map((v) => (isRecord(v) ? `${v.voice_id}  ${v.name}` : "undefined  undefined")).join("\n");
}
