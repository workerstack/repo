import { expect, it } from "vitest";

import { LOCK_OK, ROOT, lines } from "./__fixtures__/check-workspace-lines.ts";
import { checkDeps } from "./check-deps.ts";
import type { PackageJson, Workspace } from "./sync/workspace.ts";
import type { Surface } from "./type-surface.ts";

const BIN = { bin: { kit: "./bin.ts" }, private: false };

/** A surface whose files use the named packages, each file reached from the "." export. */
function surface(uses: Record<string, string[]>, missing: Surface["missing"] = []): Surface {
  const files = Object.values(uses).flat();

  return { keys: new Map(files.map((file) => [file, "."])), missing, uses: new Map(Object.entries(uses)) };
}

/** A repo whose root is `manifest`, with no workspace packages. */
function rootOnly(manifest: PackageJson): Workspace {
  return { manifest, packages: [], root: "/repo" };
}

function peer(file: string, name: string, used: string): string {
  return (
    `${file}: ${name} is in "dependencies" but the types of "." use it (${used}); ` +
    'move it to "peerDependencies" and "devDependencies" keeping its version'
  );
}

function bundle(file: string, name: string): string {
  return (
    `${file}: ${name} is in "dependencies" of a library (no "bin"); ` +
    'bundle it, or move it to "peerDependencies" and "devDependencies"'
  );
}

it("gives a bin package's exposed dep the peer line, naming the first file that uses it", () => {
  const workspace = rootOnly({ ...BIN, dependencies: { cli: "1.0.0", zod: "^4.0.0" } });
  const surfaces = new Map([[".", surface({ zod: ["src/a.ts", "src/b.ts"] })]]);

  expect(checkDeps(workspace, surfaces)).toStrictEqual([peer("package.json", "zod", "src/a.ts")]);
});

it("gives a library the bundle line for an internal dep and the peer line for an exposed one", () => {
  const workspace = rootOnly({ dependencies: { nanoid: "^5.0.0", zod: "^4.0.0" }, private: false });
  const surfaces = new Map([[".", surface({ zod: ["src/index.ts"] })]]);

  expect(checkDeps(workspace, surfaces)).toStrictEqual([
    bundle("package.json", "nanoid"),
    peer("package.json", "zod", "src/index.ts"),
  ]);
});

it("says nothing of a private package, optionalDependencies or a package without a surface", () => {
  const exposed = surface({ esbuild: ["src/index.ts"], zod: ["src/index.ts"] });
  const hidden = rootOnly({ dependencies: { zod: "^4.0.0" } });
  const optional = rootOnly({ ...BIN, optionalDependencies: { esbuild: "1.0.0" } });

  expect(checkDeps(hidden, new Map([[".", exposed]]))).toStrictEqual([]);
  expect(checkDeps(optional, new Map([[".", exposed]]))).toStrictEqual([]);
  expect(checkDeps(rootOnly({ ...BIN, dependencies: { zod: "1" } }), new Map())).toStrictEqual([]);
});

it("names an exposed dep's file without a key when no export's types reach it", () => {
  const workspace = rootOnly({ ...BIN, dependencies: { zod: "^4.0.0" } });
  const unkeyed: Surface = { keys: new Map(), missing: [], uses: new Map([["zod", ["x.d.ts"]]]) };
  const surfaces = new Map([[".", unkeyed]]);

  expect(checkDeps(workspace, surfaces)).toStrictEqual([
    'package.json: zod is in "dependencies" but the exported types use it (x.d.ts); ' +
      'move it to "peerDependencies" and "devDependencies" keeping its version',
  ]);
});

it("starts a workspace package's line with its package.json and prints the missing-types line", () => {
  const kit = { dir: "packages/kit", manifest: { dependencies: { nanoid: "^5.0.0" }, private: false } };
  const workspace: Workspace = { manifest: { private: true }, packages: [kit], root: "/repo" };
  const missing: Surface["missing"] = [{ cause: "unmapped", key: "./client", types: "dist/client.d.ts" }];

  expect(checkDeps(workspace, new Map([["packages/kit", surface({}, missing)]]))).toStrictEqual([
    'packages/kit/package.json: the types of "./client" (dist/client.d.ts) are missing and no tsconfig.build.json ' +
      'maps them to a source; build first or point "types" at the source',
    bundle("packages/kit/package.json", "nanoid"),
  ]);
});

it("says how to fix a missing source target and a declaration target the build emits nothing to", () => {
  const missing: Surface["missing"] = [
    { cause: "source", key: "./gone", types: "src/gone.ts" },
    { cause: "unbuilt", key: "./client", types: "dist/client.d.ts" },
  ];

  expect(checkDeps(rootOnly({ ...BIN }), new Map([[".", surface({}, missing)]]))).toStrictEqual([
    'package.json: the types of "./gone" (src/gone.ts) are missing; restore the file or drop the export',
    'package.json: the types of "./client" (dist/client.d.ts) are missing and no source in tsconfig.build.json ' +
      'emits them; build first or point "types" at the source',
  ]);
});

const KIT_FILE = "packages/kit/package.json";

/** A workspace-pack repo whose one package, at packages/kit, is `manifest`. */
function workspaceOf(manifest: PackageJson): Workspace {
  return { manifest: ROOT, packages: [{ dir: "packages/kit", manifest }], root: "/repo" };
}

it("passes checkDeps and checkWorkspace once a catalog: dep is moved as written", () => {
  const before = { ...BIN, dependencies: { zod: "catalog:" }, name: "kit" };
  const after = { ...BIN, devDependencies: { zod: "catalog:" }, name: "kit", peerDependencies: { zod: "catalog:" } };
  const surfaces = new Map([["packages/kit", surface({ zod: ["src/index.ts"] })]]);

  expect(checkDeps(workspaceOf(before), surfaces)).toStrictEqual([peer(KIT_FILE, "zod", "src/index.ts")]);
  expect(checkDeps(workspaceOf(after), surfaces)).toStrictEqual([]);
  expect(lines({ [KIT_FILE]: after, "package.json": ROOT }, LOCK_OK)).toStrictEqual([]);
});
