import path from "node:path";

import { SKILL_PACKS } from "../config.ts";
import { WORKSPACE_SKILLS_REL, STOCK_SKILLS_REL, listSkillDirNames } from "../scripts/skill-conflicts.ts";
import { byCodeUnit } from "./by-code-unit.ts";
import type { Output, SyncContext } from "./outputs.ts";

const OVERLAY_SKILLS_REL = ".repo/skills";
const CLAUDE_SKILLS_REL = ".claude/skills";

function posix(rel: string): string {
  return rel.split(path.sep).join("/");
}

/** Whether the hosts read skills from `.agents/skills`: codex and antigravity do. */
function readsAgentsDir(hosts: readonly string[]): boolean {
  return hosts.includes("codex") || hosts.includes("antigravity");
}

/** The skill names to link: the stock's (without the packs not enabled) and the overlay's own, sorted. */
function skillNames(ctx: SyncContext, stock: string, own: readonly string[]): string[] {
  const { skills } = ctx.config.agents;
  const optional = new Set<string>(SKILL_PACKS.filter((pack) => !skills.includes(pack)));
  const stockNames = listSkillDirNames(path.join(stock, STOCK_SKILLS_REL)).filter((name) => !optional.has(name));
  return [...new Set([...stockNames, ...own])].toSorted(byCodeUnit);
}

/** The skill links for `hosts`: `.agents/skills` for codex and antigravity, `.claude/skills` for claude. */
export function skillLinks(ctx: SyncContext, stock: string, { self }: { self: boolean }): Output[] {
  const { hosts } = ctx.config.agents;
  const own = self ? [] : listSkillDirNames(path.join(ctx.root, OVERLAY_SKILLS_REL));
  function sourceOf(name: string) {
    return own.includes(name)
      ? path.join(ctx.root, OVERLAY_SKILLS_REL, name)
      : path.join(stock, STOCK_SKILLS_REL, name);
  }
  const agentsDir = readsAgentsDir(hosts);
  const links: Output[] = [];
  function add(dir: string, name: string, target: string) {
    return links.push({ kind: "link", managed: "whole", path: `${dir}/${name}`, target, tracked: self });
  }
  for (const name of skillNames(ctx, stock, own)) {
    if (agentsDir)
      add(WORKSPACE_SKILLS_REL, name, posix(path.relative(path.join(ctx.root, WORKSPACE_SKILLS_REL), sourceOf(name))));
    if (hosts.includes("claude")) {
      const target =
        agentsDir && !self
          ? `../../${WORKSPACE_SKILLS_REL}/${name}`
          : posix(path.relative(path.join(ctx.root, CLAUDE_SKILLS_REL), sourceOf(name)));
      add(CLAUDE_SKILLS_REL, name, target);
    }
  }
  return links;
}

/**
 * Each workspace package's own skills, linked straight to `<pkg>/.repo/skills/<name>` from the dirs its hosts read:
 * `<pkg>/.claude/skills` for claude (which names them `/<pkg>:<name>`), `<pkg>/.agents/skills` for codex and
 * antigravity.
 */
export function packageSkillLinks(ctx: SyncContext, { self }: { self: boolean }): Output[] {
  const { hosts } = ctx.config.agents;
  const dirs = [
    ...(hosts.includes("claude") ? [CLAUDE_SKILLS_REL] : []),
    ...(readsAgentsDir(hosts) ? [".agents/skills"] : []),
  ];
  return ctx.workspace.packages.flatMap(({ dir }) =>
    listSkillDirNames(path.join(ctx.root, dir, OVERLAY_SKILLS_REL)).flatMap((name): Output[] =>
      dirs.map((host) => ({
        kind: "link",
        managed: "whole",
        path: `${dir}/${host}/${name}`,
        target: `../../${OVERLAY_SKILLS_REL}/${name}`,
        tracked: self,
      })),
    ),
  );
}
