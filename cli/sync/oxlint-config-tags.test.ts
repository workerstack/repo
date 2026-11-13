import { expect, it } from "vitest";

import type { ResolvedLint } from "../config.ts";
import type { JsonObject } from "../json.ts";
import { oxlintConfig } from "./oxlint-config.ts";
import type { Workspace } from "./workspace.ts";

type Config = { rules: JsonObject };

/** A root and three packages, as `readWorkspace` reads them. */
const APP: Workspace = {
  manifest: { name: "@app/root", workspaces: ["packages/*"] },
  packages: [
    { dir: "packages/lib", manifest: { name: "@app/lib" } },
    { dir: "packages/ui", manifest: { name: "@app/ui" } },
    { dir: "packages/web", manifest: { name: "@app/web" } },
  ],
  root: "/repo",
};

const TAGS = { "@app/lib": "lib", "@app/ui": "ui", "@app/web": "app" };
const ALLOW = { app: ["ui", "lib"], lib: [], ui: ["lib"] };

function configOf(lint: ResolvedLint): Config {
  const built = oxlintConfig(APP, lint);

  if (!built.ok) throw new Error(built.errors.join("\n"));

  return JSON.parse(built.value) /* the config sync writes */ as Config;
}

it("oxlintConfig writes the tags as the options of repo/boundaries, and none without lint.boundaries", () => {
  expect(configOf({ boundaries: { allow: ALLOW, tags: TAGS }, skip: [] }).rules["repo/boundaries"]).toStrictEqual([
    "error",
    { allow: ALLOW, tags: TAGS },
  ]);
  expect(configOf({ skip: [] }).rules["repo/boundaries"]).toBe("error");
});

it("oxlintConfig tags the root package too", () => {
  const tags = { ...TAGS, "@app/root": "app" };
  expect(configOf({ boundaries: { allow: ALLOW, tags }, skip: [] }).rules["repo/boundaries"]).toStrictEqual([
    "error",
    { allow: ALLOW, tags },
  ]);
});

it("oxlintConfig takes a nameless root, whose packages alone a tag can name", () => {
  const nameless: Workspace = { ...APP, manifest: { workspaces: ["packages/*"] } };
  expect(oxlintConfig(nameless, { boundaries: { allow: ALLOW, tags: TAGS }, skip: [] }).ok).toBe(true);
  const rootTagged = { allow: ALLOW, tags: { ...TAGS, "@app/root": "app" } };
  expect(oxlintConfig(nameless, { boundaries: rootTagged, skip: [] })).toStrictEqual({
    errors: ['repo.config.ts: lint.boundaries.tags: "@app/root" is not a workspace package'],
    ok: false,
  });
});

it.each([
  [
    { allow: ALLOW, tags: { ...TAGS, "@app/gone": "lib" } },
    'lint.boundaries.tags: "@app/gone" is not a workspace package',
  ],
  [
    { allow: { ...ALLOW, lib: ["web"] }, tags: TAGS },
    'lint.boundaries.allow.lib: "web" is not a tag lint.boundaries.tags gives',
  ],
  [
    { allow: { app: ["ui", "lib"], lib: [] }, tags: TAGS },
    'lint.boundaries.allow: tag "ui" has no entry; list the tags it may import, or []',
  ],
  [
    { allow: { ...ALLOW, gone: [] }, tags: TAGS },
    'lint.boundaries.allow.gone: no package carries tag "gone"; drop the entry',
  ],
])("oxlintConfig refuses %j and writes nothing", (boundaries, error) => {
  expect(oxlintConfig(APP, { boundaries, skip: [] })).toStrictEqual({
    errors: [`repo.config.ts: ${error}`],
    ok: false,
  });
});
