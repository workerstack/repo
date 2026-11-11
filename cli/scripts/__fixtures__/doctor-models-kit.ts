import fs from "node:fs";
import path from "node:path";

import { agentModelsLines } from "../agent-models-lines.ts";
import type { ListResult, ListRunner } from "../doctor.types.ts";
import { tmp } from "./doctor-kit.ts";

export const LISTS = {
  cursor:
    "Available models\n\nauto - Auto (current, default)\nclaude-sonnet-5-5-medium - Sonnet 5.5\n\nTip: use --model <id> to switch.\n",
  grok: "You are logged in with grok.com.\n\nDefault model: grok-4.7\n\nAvailable models:\n  * grok-4.7 (default)\n",
};
export type Reply = { code?: number; stdout?: string; stderr?: string; delay?: number } | "not-installed" | "hang";
export const OK: Record<string, Reply> = {
  "cursor-agent": { stdout: LISTS.cursor },
  grok: { stdout: LISTS.grok },
};

export function fakeRun(replies: Record<string, Reply> = OK) {
  const calls: string[] = [];
  const run: ListRunner = (bin, args, { signal }) => {
    calls.push([bin, ...args].join(" "));
    const reply = replies[bin];
    return new Promise<ListResult>((resolve, reject) => {
      if (!reply || reply === "not-installed") {
        reject(Object.assign(new Error(`spawn ${bin} ENOENT`), { code: "ENOENT" }));
        return;
      }
      if (reply === "hang") {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
        return;
      }
      setTimeout(
        () => resolve({ code: reply.code ?? 0, stderr: reply.stderr ?? "", stdout: reply.stdout ?? "" }),
        reply.delay ?? 0,
      );
    });
  };
  return { calls, run };
}

function put(cwd: string, rel: string, body: string) {
  const file = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

export function md(model: string): string {
  return `---\nname: x\nmodel: ${model}\n---\nbody\n`;
}

export function toml(model: string): string {
  return `name = "x"\nmodel = "${model}"\nmodel_reasoning_effort = "low"\n`;
}

export function checkout(files: Record<string, string>): string {
  const cwd = fs.realpathSync(tmp("doc-models-"));
  for (const [rel, body] of Object.entries(files)) put(cwd, rel, body);
  return cwd;
}

export function codexHome(slugs: string[] | string): string {
  const home = fs.realpathSync(tmp("doc-models-home-"));
  put(
    home,
    ".codex/models_cache.json",
    typeof slugs === "string" ? slugs : JSON.stringify({ models: slugs.map((slug) => ({ slug })) }),
  );
  return home;
}

export const GOOD_HOME_SLUGS = ["gpt-6-luna", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-reserve"];
export const ALL_OFFERED = {
  ".agents/agents/scout.md": md("flash_lite"),
  ".codex/agents/scout.toml": toml("gpt-6-luna"),
  ".cursor/agents/scout.md": md("claude-sonnet-5-5-medium"),
  ".grok/agents/scout.md": md("grok-4.7"),
  ".grok/roles/scout.toml": toml("grok-4.7"),
};

export async function rowOf(
  files: Record<string, string>,
  {
    home = codexHome(GOOD_HOME_SLUGS),
    replies = OK,
    capMs,
  }: { home?: string; replies?: Record<string, Reply>; capMs?: number } = {},
) {
  const cwd = checkout(files);
  const { run, calls } = fakeRun(replies);
  const lines = await agentModelsLines({ capMs, cwd, env: {}, home, run, sourceRoot: cwd });
  return { calls, cwd, lines, text: lines.join("\n") };
}

/** A PATH dir holding only a fake grok that lists `ids`. */
export function fakeGrok(ids: string[]): string {
  const bin = tmp("doc-fake-grok-");
  const out = ["Available models:", ...ids.map((id) => `  ${id}`)];
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(bin, "grok.cmd"), `@echo off\r\n${out.map((l) => `echo ${l}`).join("\r\n")}\r\n`);
  } else {
    fs.writeFileSync(path.join(bin, "grok"), `#!/bin/sh\n${out.map((l) => `echo "${l}"`).join("\n")}\n`, {
      mode: 0o755,
    });
  }
  return bin;
}

/** The row text from the real list runner, for a checkout with these files. */
export async function realRow(files: Record<string, string>): Promise<string> {
  const cwd = checkout(files);
  return (await agentModelsLines({ cwd, env: {}, home: "/nonexistent", sourceRoot: cwd })).join("\n");
}
