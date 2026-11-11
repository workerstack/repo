import type { Rule } from "./sync-pstack-rules.constants.ts";
import { FENCE, QUOTE_END } from "./sync-pstack-skills.constants.ts";

const QUOTE_MIN = 2;

function unquoteYaml(raw: string): string {
  const s = raw.trim();
  if (s.length >= QUOTE_MIN && s.startsWith('"') && s.endsWith('"')) {
    try {
      const v: unknown = JSON.parse(s);
      return typeof v === "string" ? v : s;
    } catch {
      return s.slice(1, QUOTE_END);
    }
  }
  if (s.length >= QUOTE_MIN && s.startsWith("'") && s.endsWith("'")) return s.slice(1, QUOTE_END).replaceAll("''", "'");

  return s;
}

/** The frontmatter and body of `src`, or why it has none. */
export function splitFrontmatter(src: string): { ok: true; fm: string; body: string } | { ok: false; error: string } {
  if (!src.startsWith(FENCE)) return { error: "missing frontmatter", ok: false };
  const rest = src.slice(FENCE.length).replace(/^\r?\n/, "");
  const m = rest.match(/\r?\n---\s*(?:\r?\n|$)/);
  if (!m || m.index == null) return { error: "missing frontmatter close", ok: false };
  return { body: rest.slice(m.index + m[0].length), fm: rest.slice(0, m.index), ok: true };
}

export function parseFm(fm: string): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const line of fm.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const km = line.match(/^([^:#\s][^:]*):\s*(.*?)\s*$/);
    if (!km) continue;
    const [, key = "", value = ""] = km;
    obj[key.trim()] = unquoteYaml(value);
  }
  return obj;
}

export function quoteDesc(s: string): string {
  return JSON.stringify(s.replaceAll(/\s+/g, " ").trim());
}

export function ensureUseFor(desc: string, name: string): string {
  const d = desc.trim();
  if (d.includes(`/${name}`)) return d;
  if (/\bUse for /.test(d)) return d.replace(/\bUse for /, `Use for /${name}, `);
  return `${d.replace(/\.$/, "")}. Use for /${name}.`;
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
  const m = src.match(/^(# .+\n(?:\n)?)([\s\S]*?)\n\n/);
  if (!m) return `${src.replace(/\s+$/, "")}\n\n${block}`;
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
    .replaceAll(/\[([^\]]+)\]\(\.\.\/(principle-[a-z0-9-]+)\/SKILL\.md\)/g, "`/$2`")
    .replaceAll(/(?:[Tt]he )?\*\*([a-z0-9-]+)\*\* principle skill/g, "`/principle-$1`")
    .replaceAll("the `typescript-best-practices` skill", "`/typescript-best-practices`");
}

export function adaptPatterns(body: string): string {
  return body
    .replace(
      / The underlying principles are language-agnostic\. See the \*\*type-system-discipline\*\* and \*\*boundary-discipline\*\* principle skills\./,
      " The underlying principles are language-agnostic.",
    )
    .replaceAll(" See the **boundary-discipline** principle skill.", "");
}
