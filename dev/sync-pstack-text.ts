import { z } from "zod";

import { tryJson } from "../cli/json.ts";
import type { Rule } from "./sync-pstack-rules.constants.ts";
import { QUOTE_END } from "./sync-pstack-skills.constants.ts";
import {
  FM_FIELD_RE,
  LANGUAGE_AGNOSTIC_NOTE,
  LINE_SPLIT_RE,
  PRINCIPLE_LINK_RE,
  PRINCIPLE_SKILL_RE,
  SPACE_RUN_RE,
  TITLE_AND_FIRST_PARAGRAPH_RE,
  TRAILING_DOT_RE,
  TRAILING_SPACE_RE,
  USE_FOR_RE,
} from "./sync-pstack-text.constants.ts";

const QUOTE_MIN = 2;

function unquoteYaml(raw: string): string {
  const s = raw.trim();

  if (s.length >= QUOTE_MIN && s.startsWith('"') && s.endsWith('"'))
    return tryJson(z.string(), s) ?? s.slice(1, QUOTE_END);

  if (s.length >= QUOTE_MIN && s.startsWith("'") && s.endsWith("'")) return s.slice(1, QUOTE_END).replaceAll("''", "'");

  return s;
}

export function parseFm(fm: string): Record<string, string> {
  const obj: Record<string, string> = {};

  for (const line of fm.split(LINE_SPLIT_RE)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const km = FM_FIELD_RE.exec(line);

    if (km === null) continue;
    const [, key = "", value = ""] = km;
    obj[key.trim()] = unquoteYaml(value);
  }

  return obj;
}

export function quoteDesc(s: string): string {
  return JSON.stringify(s.replaceAll(SPACE_RUN_RE, " ").trim());
}

export function ensureUseFor(desc: string, name: string): string {
  const d = desc.trim();

  if (d.includes(`/${name}`)) return d;

  if (USE_FOR_RE.test(d)) return d.replace(USE_FOR_RE, `Use for /${name}, `);

  return `${d.replace(TRAILING_DOT_RE, "")}. Use for /${name}.`;
}

/** Apply each rule once, in order; a rule that no longer matches records its id in `misses`. */
export function applyRules(src: string, rules: readonly Rule[], misses: string[]): string {
  let out = src;

  for (const { re, to, id } of rules) {
    if (re.test(out)) out = out.replace(re, to);
    else if (id !== undefined) misses.push(id);
  }

  return out;
}

export function insertAfterFirstParagraph(src: string, block: string): string {
  if (src.includes(block.trim())) return src;
  const m = TITLE_AND_FIRST_PARAGRAPH_RE.exec(src);

  if (m === null) return `${src.replace(TRAILING_SPACE_RE, "")}\n\n${block}`;
  const [whole, head = "", first = ""] = m;

  return `${head}${first}\n\n${block}\n${src.slice(whole.length)}`;
}

export function slashBlock(name: string, extra = ""): string {
  return `Slash \`/${name}\` only. Not a session flag.${extra}\n`;
}

export function rewriteUnslopRefs(body: string): string {
  return body
    .replaceAll("the **unslop** skill", "`/unslop`")
    .replaceAll("through `unslop`", "through `/unslop`")
    .replaceAll("through **unslop**", "through `/unslop`");
}

export function rewritePrincipleRefs(body: string): string {
  return body
    .replaceAll(PRINCIPLE_LINK_RE, "`/$2`")
    .replaceAll(PRINCIPLE_SKILL_RE, "`/principle-$1`")
    .replaceAll("the `typescript-best-practices` skill", "`/typescript-best-practices`");
}

export function adaptPatterns(body: string): string {
  return body
    .replace(LANGUAGE_AGNOSTIC_NOTE, " The underlying principles are language-agnostic.")
    .replaceAll(" See the **boundary-discipline** principle skill.", "");
}
