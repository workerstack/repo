import { splitFrontmatter } from "../cli/scripts/emit-agent-shell-tools.ts";
import { bodyRulesOf, descriptionRulesOf } from "./sync-pstack-rules.constants.ts";
import {
  BRO_SKILL,
  DROP_FM,
  PATTERNS_REL,
  PRINCIPLE_PREFIX,
  SKILL_REL,
  TEACH_NOT_EXPLAIN,
  TYPESCRIPT_SKILL,
  type PstackSkill,
} from "./sync-pstack-skills.constants.ts";
import { LEADING_NEWLINES_RE, TRAILING_DOT_RE, TRAILING_SPACE_RE } from "./sync-pstack-text.constants.ts";
import {
  adaptPatterns,
  applyRules,
  ensureUseFor,
  insertAfterFirstParagraph,
  parseFm,
  quoteDesc,
  rewritePrincipleRefs,
  rewriteUnslopRefs,
  slashBlock,
} from "./sync-pstack-text.ts";

type Adapter = (skill: PstackSkill, body: string, misses: string[]) => string;

const BRO_LEAD =
  "This reply only: restate the last message in plain human language. Not a mode switch or session flag. " +
  "After this reply, revert to output.md.";

/** Whether the skill called `name` has a recipe of its own. */
function hasAdapter(name: string): name is keyof typeof ADAPTERS {
  return Object.hasOwn(ADAPTERS, name);
}

function withSlash(skill: PstackSkill, body: string, extra?: string): string {
  return insertAfterFirstParagraph(body, slashBlock(skill.name, extra));
}

function ruled(skill: PstackSkill, body: string, misses: string[]): string {
  return applyRules(body, bodyRulesOf(skill.name), misses);
}

/** Skills whose body has its own recipe; the rest follow `adaptBody`. */
const ADAPTERS = {
  [BRO_SKILL]: (_skill, body) => [BRO_LEAD, "", body.trim(), "", "Slash `/bro` only.", ""].join("\n"),
  "blast-radius": (skill, body, misses) => withSlash(skill, rewriteUnslopRefs(ruled(skill, body, misses))),
  correct: (skill, body, misses) => withSlash(skill, ruled(skill, body, misses)),
  teach: (skill, body, misses) => withSlash(skill, rewriteUnslopRefs(ruled(skill, body, misses)), TEACH_NOT_EXPLAIN),
} satisfies Readonly<Record<string, Adapter>>;

/** A file of one skill: `rel` is its path inside the skill. */
type Target = {
  skill: PstackSkill;
  rel: string;
};

function adaptBody({ skill, rel }: Target, body: string, misses: string[]): string {
  if (rel === PATTERNS_REL) return adaptPatterns(body);

  if (hasAdapter(skill.name)) return ADAPTERS[skill.name](skill, body, misses);

  if (rel !== SKILL_REL) return rewriteUnslopRefs(body);

  if (skill.name === TYPESCRIPT_SKILL) return ruled(skill, body, misses);

  if (skill.name.startsWith(PRINCIPLE_PREFIX))
    return withSlash(skill, rewriteUnslopRefs(rewritePrincipleRefs(ruled(skill, body, misses))));

  const plain = rewriteUnslopRefs(body);

  return skill.slash ? withSlash(skill, plain) : plain;
}

function adaptDescription(skill: PstackSkill, desc: string, misses: string[]): string {
  const d = desc.trim();

  if (skill.name === TYPESCRIPT_SKILL)
    return d.includes(`/${TYPESCRIPT_SKILL}`) ? d : `${d.replace(TRAILING_DOT_RE, "")}, or for /${TYPESCRIPT_SKILL}.`;

  const out = applyRules(d, descriptionRulesOf(skill.name), misses);

  return skill.slash && skill.name !== BRO_SKILL ? ensureUseFor(out, skill.name) : out;
}

/** What adapting a file gives: its text, or why it cannot be; `misses` names adapters that did not match. */
export type Adapted = { ok: true; text: string; misses: string[] } | { ok: false; error: string; misses: string[] };

/**
 * Apply the repo adapters to one fetched pstack file. `misses` names adapters that did not match.
 * @param skill
 * @param rel Path inside the skill; only `SKILL.md` has frontmatter.
 * @param raw
 * @returns
 */
export function adaptFile(skill: PstackSkill, rel: string, raw: string): Adapted {
  const misses: string[] = [];

  if (rel !== SKILL_REL) {
    const text = adaptBody({ rel, skill }, raw.replaceAll("\r\n", "\n"), misses);

    return { misses, ok: true, text: text.endsWith("\n") ? text : `${text}\n` };
  }

  const split = splitFrontmatter(raw);

  if (!split.ok) return { error: split.error, misses, ok: false };
  const parsed = parseFm(split.fm);

  for (const k of DROP_FM) delete parsed[k];
  const desc = adaptDescription(skill, parsed.description ?? "", misses);
  const body = adaptBody({ rel, skill }, split.body.replaceAll("\r\n", "\n"), misses);
  const trimmed = body.replace(LEADING_NEWLINES_RE, "").replace(TRAILING_SPACE_RE, "");
  const text = `---\nname: ${skill.name}\ndescription: ${quoteDesc(desc)}\n---\n${trimmed}\n`;

  return { misses, ok: true, text };
}
