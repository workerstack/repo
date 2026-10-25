#!/usr/bin/env node
/** Repo-only. Fetch ported pstack skills, apply grunt adapters, write SSOT. Not shipped. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_REPO = "backnotprop/pstack";
export const DEFAULT_REF = "main";
export const SKILLS_REL = ".rulesync/skills";

const PRINCIPLE_SKILL_NAMES = [
  "principle-attack-the-premise",
  "principle-boundary-discipline",
  "principle-build-the-lever",
  "principle-encode-lessons-in-structure",
  "principle-exhaust-the-design-space",
  "principle-experience-first",
  "principle-explain-the-number",
  "principle-fix-root-causes",
  "principle-foundational-thinking",
  "principle-guard-the-context-window",
  "principle-laziness-protocol",
  "principle-make-operations-idempotent",
  "principle-migrate-callers-then-delete-legacy-apis",
  "principle-minimize-reader-load",
  "principle-model-the-domain",
  "principle-never-block-on-the-human",
  "principle-outcome-oriented-execution",
  "principle-prove-it-works",
  "principle-redesign-from-first-principles",
  "principle-separate-before-serializing-shared-state",
  "principle-sequence-verifiable-units",
  "principle-subtract-before-you-add",
  "principle-test-behavior-not-implementation",
  "principle-type-system-discipline",
];

export const PSTACK_SKILLS = [
  { name: "blast-radius", files: ["SKILL.md"], slash: true },
  { name: "bro", files: ["SKILL.md"], slash: true },
  { name: "correct", files: ["SKILL.md"], slash: true },
  { name: "teach", files: ["SKILL.md"], slash: true },
  { name: "typescript-best-practices", files: ["SKILL.md", "references/patterns.md"], slash: false },
  { name: "unslop", files: ["SKILL.md"], slash: true },
  ...PRINCIPLE_SKILL_NAMES.map((name) => ({ name, files: ["SKILL.md"], slash: true })),
];

const DROP_FM = new Set(["disable-model-invocation", "paths"]);

export function parseArgv(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const out = {
    check: false,
    generate: true,
    ref: DEFAULT_REF,
    repo: DEFAULT_REPO,
    skills: [],
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--check") {
      out.check = true;
      continue;
    }
    if (a === "--no-generate") {
      out.generate = false;
      continue;
    }
    if (a === "--ref" || a === "--repo" || a === "--skill") {
      const v = args[i + 1];
      if (v == null || v.startsWith("-")) return { ok: false, error: `${a} needs a value` };
      i += 1;
      if (a === "--ref") out.ref = v;
      else if (a === "--repo") out.repo = v;
      else out.skills.push(v);
      continue;
    }
    return { ok: false, error: `unknown flag: ${a}` };
  }
  return { ok: true, ...out };
}

function unquoteYaml(raw) {
  const s = String(raw).trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

export function splitFrontmatter(text) {
  const src = String(text ?? "");
  if (!src.startsWith("---")) return { ok: false, error: "missing frontmatter" };
  const rest = src.slice(3).replace(/^\r?\n/, "");
  const m = rest.match(/\r?\n---\s*(?:\r?\n|$)/);
  if (!m || m.index == null) return { ok: false, error: "missing frontmatter close" };
  return { ok: true, fm: rest.slice(0, m.index), body: rest.slice(m.index + m[0].length) };
}

function parseFm(fm) {
  const obj = {};
  for (const line of String(fm).split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const km = line.match(/^([^:#\s][^:]*):\s*(.*?)\s*$/);
    if (!km) continue;
    obj[km[1].trim()] = unquoteYaml(km[2]);
  }
  return obj;
}

function quoteDesc(s) {
  return JSON.stringify(String(s ?? "").replace(/\s+/g, " ").trim());
}

function ensureUseFor(desc, name) {
  const d = String(desc ?? "").trim();
  if (d.includes(`/${name}`)) return d;
  if (/\bUse for /.test(d)) return d.replace(/\bUse for /, `Use for /${name}, `);
  return `${d.replace(/\.$/, "")}. Use for /${name}.`;
}

function replaceOnce(src, re, to, id, misses) {
  if (!re.test(src)) {
    misses.push(id);
    return src;
  }
  return src.replace(re, to);
}

function insertAfterFirstParagraph(body, block) {
  const src = String(body);
  if (src.includes(block.trim())) return src;
  const m = src.match(/^(# .+\n(?:\n)?)([\s\S]*?)\n\n/);
  if (!m) {
    const trimmed = src.replace(/\s+$/, "");
    return `${trimmed}\n\n${block}`;
  }
  return `${m[1]}${m[2]}\n\n${block}\n${src.slice(m[0].length)}`;
}

function slashBlock(name, extra = "") {
  return `Slash \`/${name}\` only. Not a session flag.${extra}\n`;
}

function rewriteUnslopRefs(body) {
  return String(body)
    .replace(/the \*\*unslop\*\* skill/g, "`/unslop`")
    .replace(/through `unslop`/g, "through `/unslop`")
    .replace(/through \*\*unslop\*\*/g, "through `/unslop`");
}

function rewritePrincipleRefs(body) {
  return String(body)
    .replace(/\[([^\]]+)\]\(\.\.\/(principle-[a-z0-9-]+)\/SKILL\.md\)/g, "`/$2`")
    .replace(/(?:[Tt]he )?\*\*([a-z0-9-]+)\*\* principle skill/g, "`/principle-$1`")
    .replace(/the `typescript-best-practices` skill/g, "`/typescript-best-practices`");
}

function adaptExplainTheNumber(body, misses) {
  return replaceOnce(
    String(body),
    /For a performance number, run the full procedure with the \[benchmark-checklist\]\(\.\.\/benchmark-checklist\/SKILL\.md\) skill\./,
    "For a performance number, run a full measured procedure: name the limiter, check tuning, count errors, repeat, check end-to-end relevance, and confirm the work happened.",
    "explain-the-number.benchmark-checklist",
    misses,
  );
}

function adaptProveItWorks(body, misses) {
  return replaceOnce(
    String(body),
    / \(the \*\*show-me-your-work\*\* skill\)/,
    "",
    "prove-it-works.show-me-your-work",
    misses,
  );
}

function adaptBuildTheLever(body, misses) {
  return replaceOnce(
    String(body),
    /When you fan work out to subagents, write the lever as a skill they all read/,
    "When you split work across later turns or child runs, write the lever as a skill they all read",
    "build-the-lever.subagents",
    misses,
  );
}

function adaptNeverBlock(body, misses) {
  return replaceOnce(
    String(body),
    /The human supervises asynchronously\. Agents must stay unblocked\. Make reasonable decisions, proceed, and let the human course-correct after the fact\. Since code changes are reversible and reviewable, a wrong decision usually costs less than blocking\./,
    "Don't ask preference on reversible execution. Make a reasonable call, do the work, and show the result. Stop for plan approval (scope.md), real blockers, and irreversible actions (force-push, delete production data, send external messages). A `locked` or `in-progress` roadmap that `/implement-roadmap` is running is already that approval.",
    "never-block-on-the-human.lead",
    misses,
  );
}

function adaptPrincipleBody(skill, body, misses) {
  let out = String(body);
  if (skill.name === "principle-explain-the-number") out = adaptExplainTheNumber(out, misses);
  if (skill.name === "principle-prove-it-works") out = adaptProveItWorks(out, misses);
  if (skill.name === "principle-build-the-lever") out = adaptBuildTheLever(out, misses);
  if (skill.name === "principle-never-block-on-the-human") out = adaptNeverBlock(out, misses);
  return insertAfterFirstParagraph(rewriteUnslopRefs(rewritePrincipleRefs(out)), slashBlock(skill.name));
}

function adaptBro(body) {
  const trimmed = String(body).trim();
  return [
    "This reply only: restate the last message in plain human language. Not a mode switch or session flag. After this reply, revert to output.md.",
    "",
    trimmed,
    "",
    "Slash `/bro` only.",
    "",
  ].join("\n");
}

function adaptBlastRadius(body, misses) {
  let out = String(body);
  out = replaceOnce(
    out,
    /Companion to `how` and `why`\. `how` tells you what the code does\. `why` tells you why it's shaped that way\. Blast radius tells you what it breaks somewhere else\./,
    "This is not a walkthrough of what the code does, and not a history of why it was built. Blast radius is what the change breaks somewhere else.",
    "blast-radius.how-why",
    misses,
  );
  out = replaceOnce(
    out,
    /Use `why` step 2 to pull the PR and commits\./,
    "Pull the PR and commits: `git log` / `git blame` on the changed files, `gh pr view` when a PR number is in the history.",
    "blast-radius.why-step-2",
    misses,
  );
  out = replaceOnce(
    out,
    /Same rules as `why`\. Cite a real `file:line`, a search that finds nothing is still an answer, and never make up a caller or an API\./,
    "Cite a real `file:line`. A search that finds nothing is still an answer. Never make up a caller or an API.",
    "blast-radius.why-rules",
    misses,
  );
  out = replaceOnce(
    out,
    /For a big or wide change, run it as an `arena`\. Ask more than one model the same question and merge the answers\./,
    "For a big or wide change, run a second independent pass (another model or a fresh read of the same question) and merge the answers.",
    "blast-radius.arena",
    misses,
  );
  out = rewriteUnslopRefs(out);
  return insertAfterFirstParagraph(out, slashBlock("blast-radius"));
}

function adaptCorrect(body, misses) {
  let out = String(body);
  out = replaceOnce(
    out,
    /keep a table in the agent instruction file that pairs/,
    "keep a table in `AGENTS.md` (SSOT: `.rulesync/rules/overview.md`) that pairs",
    "correct.rule-table",
    misses,
  );
  return insertAfterFirstParagraph(out, slashBlock("correct"));
}

function adaptTeach(body, misses) {
  let out = String(body);
  out = replaceOnce(
    out,
    /Teach sits on top of `how` and `why`\. Get your bearings on what the work is and what it touches, then run `how` for how it works and `why` for why it's that way\. Those are real skill invocations that do their own digging\. Blend what they find into one plain explanation, lead with what matters to the person, and go deeper when they ask\. Reword freely for teaching, with one exception\. Keep `why`'s confidence language intact \(its hedges are findings, not style\)\./,
    "Get your bearings on what the work is and what it touches, then find how it works and why it's that way. Those are real reads of the code and of the history, not a restatement of the question. Blend what they find into one plain explanation, lead with what matters to the person, and go deeper when they ask. Reword freely for teaching, with one exception. Keep confidence language from the history intact (its hedges are findings, not style).",
    "teach.how-why-lead",
    misses,
  );
  out = replaceOnce(
    out,
    /2\. Let `how` and `why` do the work, don't redo it\. Read the code yourself to get oriented, then run `how` for how it works and `why` for why\. Run them in parallel and combine the results\. Match the size to the question\. Run both for a subsystem, maybe one is enough for a small change\. Keep `why` narrow by default since its full sweep is slow\. Put the narrowing in the ask itself \(a scoped question, git plus a source or two\) so `why` records the skipped categories per its own contract, and widen it only when the reasons are the point\./,
    "2. Dig, don't invent. Read the code yourself to get oriented, then work out how it works (runtime path, where things live, gotchas) and why it is that way (`git log` / `git blame`, `gh pr view` when a PR number is in the history, tickets when they exist). Do both in parallel when the question is a subsystem. Match the size to the question. One side may be enough for a small change. Keep the history sweep narrow by default. Put the narrowing in the ask itself (a scoped question, git plus a source or two) and record what you skipped, and widen it only when the reasons are the point.",
    "teach.step-2",
    misses,
  );
  out = replaceOnce(
    out,
    /When the idea is spatial, like layout, overlap, scroll position, or a before and after, reach for the image-generation tool and draw it/,
    "When the idea is spatial, like layout, overlap, scroll position, or a before and after, and the harness has an image-generation tool, draw it",
    "teach.image-tool",
    misses,
  );
  out = replaceOnce(
    out,
    /and the threads worth chasing with `how` or `why`\./,
    "and the threads worth chasing next.",
    "teach.reply-chase",
    misses,
  );
  out = rewriteUnslopRefs(out);
  return insertAfterFirstParagraph(
    out,
    slashBlock("teach", " Not `/explain` (that is a longer recap of this session's work)."),
  );
}

function adaptTypescriptSkill(body, misses) {
  let out = String(body);
  out = replaceOnce(
    out,
    /Apply the \*\*type-system-discipline\*\* principle skill first\.\n/,
    "Make illegal states unrepresentable. Brand semantic primitives. Parse external data at boundaries. Exhaust variants. Derive types from the schema that owns the shape.\n\nValidate at the boundary (CLI, config, network, external APIs). Trust types inside. Keep business logic in pure functions.\n",
    "typescript.principles",
    misses,
  );
  out = replaceOnce(
    out,
    / See the \*\*boundary-discipline\*\* principle skill\./,
    "",
    "typescript.boundary-cell",
    misses,
  );
  out = replaceOnce(
    out,
    /Examples: `references\/patterns\.md`\./,
    "Examples: `references/patterns.md` next to this skill.",
    "typescript.examples",
    misses,
  );
  return out;
}

function adaptPatterns(body) {
  return String(body)
    .replace(
      / The underlying principles are language-agnostic\. See the \*\*type-system-discipline\*\* and \*\*boundary-discipline\*\* principle skills\./,
      " The underlying principles are language-agnostic.",
    )
    .replace(/ See the \*\*boundary-discipline\*\* principle skill\./g, "");
}

function adaptDescription(skill, desc, misses = []) {
  let d = String(desc ?? "").trim();
  if (skill.name === "typescript-best-practices") {
    if (!d.includes("/typescript-best-practices")) {
      d = `${d.replace(/\.$/, "")}, or for /typescript-best-practices.`;
    }
    return d;
  }
  if (skill.name === "teach") {
    d = d.replace(
      /Runs the `how` and `why` skills and weaves what they find into one clear explanation\./,
      "Dig into how it works and why it is that way, then weave that into one clear explanation.",
    );
  }
  if (skill.name === "principle-build-the-lever") {
    d = replaceOnce(
      d,
      /or a skill your subagents follow/,
      "or a skill later turns follow",
      "build-the-lever.desc-subagents",
      misses,
    );
  }
  if (skill.name === "principle-guard-the-context-window") {
    d = replaceOnce(
      d,
      /Route bulk to subagents; keep summaries in the main thread, not raw payloads\./,
      "Route bulk to grunt-job and `.tmp/grunt/` scratch; keep summaries in the session, not raw payloads.",
      "guard-the-context-window.desc-subagents",
      misses,
    );
  }
  if (skill.slash && skill.name !== "bro") d = ensureUseFor(d, skill.name);
  return d;
}

function adaptBody(skill, rel, body, misses) {
  if (rel === "references/patterns.md") return adaptPatterns(body);
  if (skill.name === "bro") return adaptBro(body);
  if (skill.name === "blast-radius") return adaptBlastRadius(body, misses);
  if (skill.name === "correct") return adaptCorrect(body, misses);
  if (skill.name === "teach") return adaptTeach(body, misses);
  if (skill.name === "typescript-best-practices" && rel === "SKILL.md") {
    return adaptTypescriptSkill(body, misses);
  }
  if (skill.name.startsWith("principle-") && rel === "SKILL.md") {
    return adaptPrincipleBody(skill, body, misses);
  }
  if (skill.slash && rel === "SKILL.md") {
    return insertAfterFirstParagraph(rewriteUnslopRefs(body), slashBlock(skill.name));
  }
  return rewriteUnslopRefs(body);
}

export function adaptFile(skill, rel, raw) {
  const misses = [];
  if (rel !== "SKILL.md") {
    const text = adaptBody(skill, rel, String(raw).replace(/\r\n/g, "\n"), misses);
    return { ok: true, text: text.endsWith("\n") ? text : `${text}\n`, misses };
  }
  const split = splitFrontmatter(raw);
  if (!split.ok) return { ok: false, error: split.error, misses };
  const parsed = parseFm(split.fm);
  for (const k of DROP_FM) delete parsed[k];
  const name = skill.name;
  const desc = adaptDescription(skill, parsed.description || "", misses);
  const body = adaptBody(skill, rel, String(split.body).replace(/\r\n/g, "\n"), misses);
  const text = `---\nname: ${name}\ndescription: ${quoteDesc(desc)}\n---\n${body.replace(/^\n+/, "").replace(/\s+$/, "")}\n`;
  return { ok: true, text, misses };
}

function rawUrl(repo, ref, skillName, rel) {
  return `https://raw.githubusercontent.com/${repo}/${ref}/skills/${skillName}/${rel}`;
}

export async function fetchText(url, fetchImpl = fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.text();
}

function resolveSkills(names) {
  if (!names.length) return PSTACK_SKILLS;
  const byName = new Map(PSTACK_SKILLS.map((s) => [s.name, s]));
  const out = [];
  for (const name of names) {
    const skill = byName.get(name);
    if (!skill) throw new Error(`unknown pstack skill: ${name}`);
    out.push(skill);
  }
  return out;
}

export async function syncPstackSkills({
  workspaceRoot,
  argv = [],
  fetchImpl = fetch,
  generateFn,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const parsed = parseArgv(argv);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const root = path.resolve(workspaceRoot ?? process.cwd());
  const skills = resolveSkills(parsed.skills);
  const reports = [];
  let wrote = 0;
  let drifted = 0;
  const allMisses = [];

  for (const skill of skills) {
    for (const rel of skill.files) {
      const url = rawUrl(parsed.repo, parsed.ref, skill.name, rel);
      const raw = await fetchText(url, fetchImpl);
      const adapted = adaptFile(skill, rel, raw);
      if (!adapted.ok) return { ok: false, error: `${skill.name}/${rel}: ${adapted.error}` };
      for (const id of adapted.misses) allMisses.push(`${skill.name}/${rel}: ${id}`);
      const dest = path.join(root, SKILLS_REL, skill.name, rel);
      const prev = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : null;
      const same = prev === adapted.text;
      const status = same ? "ok" : parsed.check ? "drift" : "write";
      if (!same) {
        if (parsed.check) drifted += 1;
        else {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, adapted.text);
          wrote += 1;
        }
      }
      reports.push({ skill: skill.name, rel, status });
      stdout.write(`${status} ${skill.name}/${rel}\n`);
    }
  }

  for (const miss of allMisses) stderr.write(`miss ${miss}\n`);

  if (!parsed.check && parsed.generate && wrote > 0) {
    const run =
      generateFn ||
      (() =>
        execFileSync("npm", ["run", "rulesync:generate"], {
          cwd: root,
          stdio: "inherit",
        }));
    run();
  }

  if (parsed.check && drifted > 0) {
    return { ok: false, error: `${drifted} file(s) drifted`, reports, misses: allMisses };
  }
  if (allMisses.length) {
    return { ok: false, error: `${allMisses.length} adapter miss(es)`, reports, misses: allMisses };
  }
  return { ok: true, reports, wrote, misses: [] };
}

async function main(argv) {
  try {
    const result = await syncPstackSkills({ argv });
    if (!result.ok) {
      process.stderr.write(`${result.error}\n`);
      return 1;
    }
    return 0;
  } catch (err) {
    process.stderr.write((err && err.message ? err.message : String(err)) + "\n");
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile) {
  const argv = process.argv.slice(2);
  main(argv).then((code) => process.exit(code));
}
