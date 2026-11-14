import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import type { configSchema } from "./config-schema.ts";
import { DEFAULT_PACKS } from "./config-schema.ts";
import { defineConfig } from "./config.ts";
import type { DefaultPack, RepoConfig } from "./repo-config.types.ts";

type Input = z.input<typeof configSchema>;

/** Every key of any member of the union `U`. */
type AllKeys<U> = U extends unknown ? keyof U : never;

/** True when `T` is a union of two or more types. */
type IsUnion<T, All = T> = T extends unknown ? ([All] extends [T] ? false : true) : never;

/** An exactly-one union as the one object the schema reads: every key of every member, each optional. */
type Loose<U> = { [K in AllKeys<U>]?: U extends unknown ? (K extends keyof U ? U[K] : never) : never };

/** `T` as the schema reads it: a non-empty tuple as a plain array, a taken name dropped, a union loosened. */
type Widened<T> = [T] extends [readonly (infer Item)[]]
  ? readonly Widened<Item>[]
  : [T] extends [object]
    ? WidenedObject<true extends IsUnion<T> ? Loose<T> : T>
    : T;

/** Each key of `T` widened, except one typed `never`, which the schema has no key for. */
type WidenedObject<T> = {
  [K in keyof T as [Exclude<T[K], undefined>] extends [never] ? never : K]:
    | Widened<Exclude<T[K], undefined>>
    | Extract<T[K], undefined>;
};

/** The keys of `T` at the top and in each section, as one union of dotted paths. */
type Keys<T> = {
  [K in keyof T & string]-?: Exclude<T[K], undefined> extends readonly unknown[] | string | number | boolean
    ? K
    : K | `${K}.${keyof Exclude<T[K], undefined> & string}`;
}[keyof T & string];

describe("RepoConfig", () => {
  it("is the shape the schema reads, no wider and no narrower", () => {
    expectTypeOf<RepoConfig>().toExtend<Input>();
    expectTypeOf<Input>().toExtend<Widened<RepoConfig>>();
    expectTypeOf<Keys<RepoConfig>>().toEqualTypeOf<Keys<Input>>();
  });

  it("defaults to the packs a config gets when it omits packs", () => {
    expectTypeOf<DefaultPack>().toEqualTypeOf<(typeof DEFAULT_PACKS)[number]>();
    expect(DEFAULT_PACKS).toStrictEqual(["agents", "standards", "docs"]);
  });
});

describe("defineConfig with its packs on", () => {
  it("takes every section while its pack is on", () => {
    const all = defineConfig({
      agents: { hosts: ["claude"], skills: ["speak"] },
      ci: { checks: { e2e: ["bun", "run", "test:e2e"] } },
      clean: { build: [".astro"] },
      commit: { maxChangedLines: 400 },
      coverage: { mutate: ["src/**/*.ts"] },
      knip: {
        ignore: [
          { dependency: "turbo", reason: "spawned by path" },
          { file: "a.ts", reason: "a script" },
        ],
      },
      link: { "@app/ui": "../ui" },
      lint: { skip: [{ files: ["a.ts"], reason: "a reason here", rules: ["eslint/no-await-in-loop"] }] },
      nightly: { secrets: ["API_TOKEN"], shards: 4 },
      owner: { github: "octo", name: "Octo Cat" },
      packs: ["agents", "standards", "release", "workspace"],
      tdd: true,
      turbo: { tasks: { build: { outputs: ["dist/**"] } } },
      workflow: "pull-request",
    });

    expect(all.workflow).toBe("pull-request");
  });
});

describe("defineConfig with a pack off", () => {
  it("refuses a section whose pack is off", () => {
    // @ts-expect-error nightly needs the release pack, off by default
    defineConfig({ nightly: { shards: 2 } });
    // @ts-expect-error turbo needs the workspace pack
    defineConfig({ turbo: {} });
    // @ts-expect-error agents needs the agents pack
    defineConfig({ agents: {}, packs: ["docs"] });
    // @ts-expect-error commit needs the standards pack
    defineConfig({ commit: {}, packs: ["docs"] });
    // @ts-expect-error knip needs the standards pack
    defineConfig({ knip: {}, packs: ["docs"] });
    // @ts-expect-error lint needs the standards pack
    defineConfig({ lint: {}, packs: ["docs"] });
    // @ts-expect-error tdd needs the standards pack
    defineConfig({ packs: ["docs"], tdd: true });
    expect(defineConfig({ nightly: { shards: 2 }, packs: ["release"] }).nightly).toStrictEqual({ shards: 2 });
  });
});

describe("defineConfig on a value the schema refuses", () => {
  it("refuses the values the schema refuses that a type can name", () => {
    // @ts-expect-error fmt is a built-in check
    defineConfig({ ci: { checks: { fmt: ["x"] } } });
    // @ts-expect-error a check needs a command
    defineConfig({ ci: { checks: { e2e: [] } } });
    // @ts-expect-error test is generated
    defineConfig({ packs: ["workspace"], turbo: { tasks: { test: {} } } });
    // @ts-expect-error a skip needs a file
    defineConfig({ lint: { skip: [{ files: [], reason: "a reason here", rules: ["a"] }] } });
    // @ts-expect-error a skip needs a rule
    defineConfig({ lint: { skip: [{ files: ["a.ts"], reason: "a reason here", rules: [] }] } });
    // @ts-expect-error mutate needs a glob
    defineConfig({ coverage: { mutate: [] } });
    // @ts-expect-error agents needs a host
    defineConfig({ agents: { hosts: [] } });
    // @ts-expect-error a knip entry names one of file, dependency or binary
    defineConfig({ knip: { ignore: [{ dependency: "b", file: "a.ts", reason: "why" }] } });
    // @ts-expect-error a knip entry names one of file, dependency or binary
    defineConfig({ knip: { ignore: [{ reason: "why" }] } });
    // @ts-expect-error not a pack
    defineConfig({ packs: ["nope"] });
    expect(defineConfig({}).packs).toBeUndefined();
  });
});
