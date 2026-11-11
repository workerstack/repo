import { PSTACK_SKILLS, type PstackSkill } from "./sync-pstack-skills.constants.ts";

/** The upstream repository and ref the skills come from. */
export type Source = {
  repo: string;
  ref: string;
};

export type TextFetch = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export function rawUrl({ repo, ref }: Source, skillName: string, rel: string): string {
  return `https://raw.githubusercontent.com/${repo}/${ref}/skills/${skillName}/${rel}`;
}

/**
 * GET `url` as text; throws `<status> <url>` on a non-ok response.
 * @param url
 * @param [fetchImpl] Defaults to `globalThis.fetch`.
 * @returns
 */
export async function fetchText(url: string, fetchImpl: TextFetch = fetch): Promise<string> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.text();
}

/** The named skills in order, or all of them when none are named; throws on an unknown name. */
export function resolveSkills(names: string[]): readonly PstackSkill[] {
  if (!names.length) return PSTACK_SKILLS;
  const byName = new Map(PSTACK_SKILLS.map((s) => [s.name, s]));
  return names.map((name) => {
    const skill = byName.get(name);
    if (!skill) throw new Error(`unknown pstack skill: ${name}`);
    return skill;
  });
}
