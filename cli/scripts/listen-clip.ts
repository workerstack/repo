/** Hands a transcript on: to latest.txt, to the log, and on `--clip` to the clipboard. */
import fs from "node:fs";
import path from "node:path";

import { latestPath } from "./listen-session.ts";
import { transcribe } from "./listen-whisper.ts";
import { CLIP_SINKS } from "./listen.constants.ts";
import type { ListenCtx, SpawnSyncFn, Stt } from "./listen.types.ts";

type ClipOpts = { platform: NodeJS.Platform; spawnSyncFn: SpawnSyncFn };

/** Pipes `body` to pbcopy, clip, or the first linux clipboard tool that takes it. */
export function copyClip(body: string, { platform, spawnSyncFn }: ClipOpts): void {
  if (platform === "darwin") {
    const r = spawnSyncFn("pbcopy", [], { encoding: "utf8", input: body });

    if (r.status !== 0) throw new Error("pbcopy failed");

    return;
  }

  if (platform === "win32") {
    const r = spawnSyncFn("clip", [], { encoding: "utf8", input: body, shell: true });

    if (r.status !== 0) throw new Error("clip failed");

    return;
  }

  const copied = CLIP_SINKS.some(
    ([bin, args]) => spawnSyncFn(bin, [...args], { encoding: "utf8", input: body }).status === 0,
  );

  if (!copied) throw new Error("no wl-copy, xclip, or xsel on PATH");
}

function saveLatest(cwd: string, text: string): string {
  const p = latestPath(cwd);
  fs.writeFileSync(p, `${text}\n`); // a transcript is trimmed, so it never ends in a newline

  return p;
}

/** Transcribes `wav`, saves and prints the text, copies it on `--clip`, and prints where it was saved. */
export async function finishTranscript(ctx: ListenCtx, wav: string, stt: Stt): Promise<string> {
  const { cfg, cwd, fetchFn, platform, spawnSyncFn, log } = ctx;
  const text = await transcribe({ cfg, fetchFn, file: wav, spawnSyncFn, stt });
  const latest = saveLatest(cwd, text);

  if (ctx.clip) copyClip(text, { platform, spawnSyncFn });
  log.log(text);
  const rel = path.relative(cwd, latest).replaceAll("\\", "/");
  log.log(`transcript=${rel.startsWith("..") ? latest : rel}`);

  return text;
}
