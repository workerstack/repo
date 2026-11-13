import { parse } from "jsonc-parser";
import { expect, it } from "vitest";

import type { JsonObject } from "../json.ts";
import { extensionsOf, outputOf, run, settingsOf, type Fixture } from "./__fixtures__/git-files-kit.ts";

const SETTINGS = ".vscode/settings.json";
const EXTENSIONS = ".vscode/extensions.json";

function typescript(version: string) {
  return { "node_modules/typescript/package.json": JSON.stringify({ version }) };
}

function standards(extra: Partial<Fixture> = {}): Fixture {
  return { packs: ["standards"], ...extra };
}

function settingsFor(fixture: Fixture): JsonObject {
  return parse(settingsOf(fixture, [])) /* the settings file is a JSON object */ as JsonObject;
}

function recommendationsFor(fixture: Fixture): string[] {
  const found = extensionsOf(fixture);

  if (found?.kind !== "file") throw new Error("no extensions.json planned");

  return (parse(found.content) /* the file is a JSON object of id lists */ as { recommendations: string[] })
    .recommendations;
}

it("adds nothing without the standards pack: no editor keys and no extensions file", () => {
  expect(Object.keys(settingsFor({}))).toStrictEqual(["files.readonlyInclude"]);
  expect(extensionsOf({})).toBeUndefined();
});

it("formats through bun and lints through oxc under the standards pack", () => {
  const settings = settingsFor(standards());
  expect(settings).toMatchObject({
    "editor.defaultFormatter": "wdomitrz.simple-lsp-client",
    "editor.formatOnSave": true,
    "oxc.enable.oxfmt": false,
    "simpleLspClient.formatters": {
      bun: { cmd: ["bun", "fmt", "--no-script", "--stdin-filepath", "${file}"] },
    },
  });

  expect(recommendationsFor(standards())).toStrictEqual(["oxc.oxc-vscode", "wdomitrz.simple-lsp-client"]);
});

it("points the editor at the installed TypeScript 7 or later, and at its lib for an older one", () => {
  const seven = settingsFor(standards({ files: typescript("7.0.2") }));
  expect(seven).toMatchObject({ "js/ts.experimental.useTsgo": true, "js/ts.tsdk.path": "./node_modules/typescript" });
  expect(seven).not.toHaveProperty("typescript.tsdk");
  expect(recommendationsFor(standards({ files: typescript("7.0.2") }))).toContain("TypeScriptTeam.native-preview");

  const six = settingsFor(standards({ files: typescript("6.0.3") }));
  expect(six).toMatchObject({ "js/ts.tsdk.path": "./node_modules/typescript/lib" });
  expect(six).not.toHaveProperty("js/ts.experimental.useTsgo");
  expect(six).not.toHaveProperty("typescript.tsdk");
  expect(recommendationsFor(standards({ files: typescript("6.0.3") }))).not.toContain("TypeScriptTeam.native-preview");
});

it("sets no TypeScript key when typescript is missing, unreadable or not numeric", () => {
  for (const files of [{}, { "node_modules/typescript/package.json": "{" }, typescript("next")]) {
    const settings = settingsFor(standards({ files }));
    expect(settings).not.toHaveProperty("typescript.tsdk");
    expect(settings).not.toHaveProperty("js/ts.tsdk.path");
  }
});

it("reads a prerelease version by its leading integer", () => {
  expect(settingsFor(standards({ files: typescript("7.1.0-beta.2") }))).toHaveProperty("js/ts.tsdk.path");
});

it("maps css to tailwindcss only when there is a Tailwind entry sheet", () => {
  const without = settingsFor(standards());
  expect(without).not.toHaveProperty("files.associations");
  expect(recommendationsFor(standards())).not.toContain("bradlc.vscode-tailwindcss");

  const withSheet = settingsFor(standards({ tailwind: "styles.css" }));
  expect(withSheet).toMatchObject({
    "css.lint.unknownAtRules": "ignore",
    "files.associations": { "*.css": "tailwindcss" },
  });
  expect(recommendationsFor(standards({ tailwind: "styles.css" }))).toContain("bradlc.vscode-tailwindcss");
});

it("recommends the Vitest extension when vitest is installed", () => {
  const files = { "node_modules/vitest/package.json": "{}" };
  expect(recommendationsFor(standards({ files }))).toContain("vitest.explorer");
  expect(recommendationsFor(standards())).not.toContain("vitest.explorer");
});

it("keeps a value the repo set, adds the keys it lacks, and a second pass changes nothing", () => {
  const before =
    '// mine\n{\n  "editor.formatOnSave": false,\r\n  "files.associations": { "*.css": "css" }\n}\n'.replaceAll(
      "\r\n",
      "\n",
    );

  const first = settingsOf(standards({ files: { [SETTINGS]: before } }), []);
  expect(parse(first)).toMatchObject({
    "editor.defaultFormatter": "wdomitrz.simple-lsp-client",
    "editor.formatOnSave": false,
    "files.associations": { "*.css": "css" },
  });

  expect(first.startsWith("{")).toBe(false);
  expect(first).toContain("// mine");
  expect(settingsOf(standards({ files: { [SETTINGS]: first } }), [])).toBe(first);
});

it("keeps CRLF on the keys it adds", () => {
  const after = settingsOf(standards({ files: { [SETTINGS]: '{\r\n  "a": 1\r\n}\r\n' } }), []);
  expect(after.replaceAll("\r\n", "")).not.toContain("\n");
  expect(after).toContain("oxc.enable.oxfmt");
});

it("adds missing recommendations after the ones the file holds, and a second pass changes nothing", () => {
  const before =
    '{\n  // team\n  "recommendations": ["a.b", "oxc.oxc-vscode"],\n  "unwantedRecommendations": ["x.y"]\n}\n';

  const first = outputOf(run(standards({ files: { [EXTENSIONS]: before } }), []).outputs, EXTENSIONS);
  expect(parse(first)).toStrictEqual({
    recommendations: ["a.b", "oxc.oxc-vscode", "wdomitrz.simple-lsp-client"],
    unwantedRecommendations: ["x.y"],
  });

  expect(first).toContain("// team");
  expect(outputOf(run(standards({ files: { [EXTENSIONS]: first } }), []).outputs, EXTENSIONS)).toBe(first);
});

it("creates the extensions file when there is none", () => {
  expect(outputOf(run(standards(), []).outputs, EXTENSIONS)).toBe(
    '{\n  "recommendations": [\n    "oxc.oxc-vscode",\n    "wdomitrz.simple-lsp-client"\n  ]\n}\n',
  );
});

it("leaves an extensions file it cannot use as is, with the reason", () => {
  for (const [text, repair] of [
    ["{ ", "CloseBraceExpected"],
    ["[]", "must hold a JSON object"],
    ['{ "recommendations": "x" }', "must be a list of extension ids"],
  ] as const) {
    const found = extensionsOf(standards({ files: { [EXTENSIONS]: text } }));
    expect(found).toMatchObject({ content: text });
    expect(found?.kind === "file" ? found.repairs?.join() : "").toContain(repair);
  }
});
