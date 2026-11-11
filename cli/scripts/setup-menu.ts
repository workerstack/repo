/** The status lines and the terminal menu `repo setup` shows over the targets. */
import { TARGETS } from "./setup.constants.ts";
import type { Status, Statuses } from "./setup.types.ts";

const MISSING: Status = { extra: "", ok: false };

export function formatStatus(statuses: Statuses | null | undefined, targets: string[] = TARGETS): string {
  return targets
    .map((t) => {
      const st = (statuses && statuses[t]) ?? MISSING;
      const b = st.ok ? "ok" : "missing";
      return st.extra ? `${t}  ${b}  ${st.extra}` : `${t}  ${b}`;
    })
    .join("\n");
}

/** "ok" or "missing", then the status's extra when it has one. */
function tagOf(st: Status): string {
  const word = st.ok ? "ok" : "missing";
  return st.extra ? `${word} ${st.extra}` : word;
}

export function menuOptions(
  statuses: Statuses | null | undefined,
  targets: string[] = TARGETS,
): { value: string; label: string }[] {
  const base = [
    { label: "speak (ElevenLabs / OpenAI TTS)", value: "speak" },
    { label: "listen (STT)", value: "listen" },
    { label: "google-workspace", value: "google-workspace" },
    { label: "browser (PATH engines)", value: "browser" },
    { label: "jev (TypeSafe research decision)", value: "jev" },
  ].filter((o) => targets.includes(o.value));
  return base.map((o) => {
    const st = (statuses && statuses[o.value]) ?? MISSING;
    return { label: `${o.label}  ${tagOf(st)}`, value: o.value };
  });
}

export function firstMissing(statuses: Statuses | null | undefined, targets: string[] = TARGETS): string {
  for (const t of targets) if (!statuses || !statuses[t] || !statuses[t].ok) return t;

  return targets[0] || "browser";
}
