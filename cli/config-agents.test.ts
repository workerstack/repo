import { describe, expect, it } from "vitest";

import { AGENTS, repo, useConfigKit } from "./__fixtures__/config-kit.ts";
import { HOSTS, SKILL_PACKS, loadConfig } from "./config.ts";

useConfigKit();

/** The agents a config resolves to, or the errors loading it. */
async function agentsOf(source: string) {
  const result = await loadConfig(repo(source));

  return result.ok ? result.config.agents : result.errors;
}

describe("agents", () => {
  it("lists the hosts and skill packs", () => {
    expect(HOSTS).toStrictEqual(["claude", "codex", "antigravity", "grok", "cursor"]);
    expect(SKILL_PACKS).toStrictEqual(["google-workspace", "listen", "speak", "clasp"]);
  });

  it("parses agents.hosts and agents.skills", async () => {
    expect(
      await agentsOf(
        'export default { packs: ["agents"], agents: { hosts: ["codex", "claude"], skills: ["listen", "clasp"] } }\n',
      ),
    ).toStrictEqual({
      hosts: ["codex", "claude"],
      skills: ["listen", "clasp"],
    });
  });

  it("defaults hosts to all five and skills to none when only one is given", async () => {
    expect(await agentsOf('export default { packs: ["agents"], agents: { skills: ["speak"] } }\n')).toStrictEqual({
      hosts: [...HOSTS],
      skills: ["speak"],
    });
    expect(await agentsOf('export default { packs: ["agents"], agents: { hosts: ["grok"] } }\n')).toStrictEqual({
      hosts: ["grok"],
      skills: [],
    });
  });
});

describe("agents", () => {
  it("resolves a missing agents to every host and no skills", async () => {
    expect(await agentsOf("export default { packs: [] }\n")).toStrictEqual(AGENTS);
    expect(await agentsOf('export default { packs: ["agents"] }\n')).toStrictEqual(AGENTS);
  });

  it("rejects an unknown host", async () => {
    expect(await agentsOf('export default { packs: ["agents"], agents: { hosts: ["clod"] } }\n')).toStrictEqual([
      'workerstack.config.ts: agents.hosts[0]: "clod" is not a host; use claude, codex, antigravity, grok or cursor',
    ]);
  });

  it("rejects an unknown skill", async () => {
    expect(
      await agentsOf('export default { packs: ["agents"], agents: { skills: ["listen", "nope"] } }\n'),
    ).toStrictEqual([
      'workerstack.config.ts: agents.skills[1]: "nope" is not a skill pack; use google-workspace, listen, ' +
        "speak or clasp",
    ]);
  });
});

describe("agents", () => {
  it("rejects a duplicate host and a duplicate skill", async () => {
    expect(
      await agentsOf(
        'export default { packs: ["agents"], agents: { hosts: ["claude", "claude"], skills: ["listen", "listen"] } }\n',
      ),
    ).toStrictEqual([
      'workerstack.config.ts: agents.hosts: "claude" is listed twice',
      'workerstack.config.ts: agents.skills: "listen" is listed twice',
    ]);
  });

  it("rejects an empty hosts list", async () => {
    expect(await agentsOf('export default { packs: ["agents"], agents: { hosts: [] } }\n')).toStrictEqual([
      "workerstack.config.ts: agents.hosts: list at least one host",
    ]);
  });

  it("rejects an unknown key inside agents", async () => {
    expect(await agentsOf('export default { packs: ["agents"], agents: { host: [] } }\n')).toStrictEqual([
      'workerstack.config.ts: agents: unknown key "host"',
    ]);
  });
});
