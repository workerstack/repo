/** `repo setup speak`: saves an ElevenLabs and/or OpenAI key to `~/.workerstack/speak.json`, then checks it. */
import os from "node:os";

import { flagOn } from "./setup-argv.ts";
import { mergeSpeakJson } from "./setup-files.ts";
import { askKey, logLine } from "./setup-io.ts";
import { BOTH, ELEVENLABS, ELEVENLABS_KEY_URL, OPENAI, OPENAI_KEY_URL } from "./setup.constants.ts";
import type { SetupCtx, SetupFetch, SetupIo, SpeakPatch } from "./setup.types.ts";
import { str } from "./voice-args.ts";

type SpeakKeys = { elevenKey: string; openaiKey: string; provider: string };

async function pickProvider(io: SetupIo, provider: string): Promise<string> {
  return str(
    await io.select?.({
      initialValue: provider === OPENAI ? OPENAI : ELEVENLABS,
      message: "Speak provider",
      options: [
        { label: "ElevenLabs", value: ELEVENLABS },
        { label: "OpenAI", value: OPENAI },
        { label: "both", value: BOTH },
      ],
    }),
  );
}

/** Prompts for each key the provider needs and the flags left out. */
async function askKeys(io: SetupIo, ctx: SetupCtx, keys: SpeakKeys): Promise<SpeakKeys> {
  const { provider } = keys;
  const askEleven = provider === ELEVENLABS || provider === BOTH || (provider === "" && keys.openaiKey === "");
  const askOpenAi = provider === OPENAI || provider === BOTH;
  const elevenKey =
    askEleven && keys.elevenKey === ""
      ? await askKey(io, ctx, {
          line: `Open: ${ELEVENLABS_KEY_URL}`,
          message: "ElevenLabs API key",
          url: ELEVENLABS_KEY_URL,
        })
      : keys.elevenKey;
  const openaiKey =
    askOpenAi && keys.openaiKey === ""
      ? await askKey(io, ctx, { line: `Open: ${OPENAI_KEY_URL}`, message: "OpenAI API key", url: OPENAI_KEY_URL })
      : keys.openaiKey;
  return { elevenKey, openaiKey, provider };
}

/** The keys and provider from the flags, then from the terminal when interactive. */
async function speakKeys(ctx: SetupCtx): Promise<SpeakKeys> {
  const { flags = {}, io, interactive = false } = ctx;
  const keys: SpeakKeys = {
    elevenKey: str(flags["elevenlabs-key"], str(flags.elevenlabs)),
    openaiKey: str(flags["openai-key"], str(flags.openai)),
    provider: str(flags.provider).toLowerCase(),
  };
  if (!interactive || io === undefined || io === null) return keys;
  if (keys.elevenKey === "" && keys.openaiKey === "") keys.provider = await pickProvider(io, keys.provider);
  return askKeys(io, ctx, keys);
}

function speakPatch({ elevenKey, openaiKey, provider }: SpeakKeys): SpeakPatch {
  const patch: SpeakPatch = {};
  if (provider !== "" && provider !== BOTH) patch.provider = provider;
  if (elevenKey !== "") patch.elevenlabs = { apiKey: elevenKey };
  if (openaiKey !== "") patch.openai = { apiKey: openaiKey };
  return patch;
}

async function verifySpeak(home: string, fetchFn: SetupFetch | undefined, provider: string): Promise<string> {
  const { loadCfg } = await import("./speak-config.ts");
  const { whoami } = await import("./speak-api.ts");
  const cfg = loadCfg({ env: {}, home });
  return whoami({ cfg, fetchFn, provider: provider === BOTH || provider === "" ? undefined : provider });
}

export async function setupSpeak(
  ctx: SetupCtx = {},
): Promise<{ ok: true; dest: string; verified: boolean; who?: string }> {
  const { flags = {}, home = os.homedir(), io, interactive = false } = ctx;
  const keys = await speakKeys(ctx);
  const patch = speakPatch(keys);
  if (patch.elevenlabs === undefined && patch.openai === undefined) {
    throw new Error(
      interactive
        ? "need an ElevenLabs or OpenAI key"
        : "need --elevenlabs-key or --openai-key (or TTY: bun repo setup speak)",
    );
  }

  const dest = mergeSpeakJson(home, patch);
  logLine(io, `wrote ${dest}`);

  if (flagOn(flags, "skip-verify")) return { dest, ok: true, verified: false };

  const who = await verifySpeak(home, ctx.fetchFn, keys.provider);
  logLine(io, who);
  return { dest, ok: true, verified: true, who };
}
