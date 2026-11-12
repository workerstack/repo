import { SCOPE_VARIABLE, WORKER_USER_AGENT } from "../env.constants.ts";

/** The three scopes an env file declares; `REPO_ENV` names the current one. */
export type Scope = "local" | "dev" | "prod";

/** The brand of a sealed value: a registered symbol, so a copy of this module loaded twice still knows one. */
const SEALED: unique symbol = /* @__PURE__ */ Symbol.for("@workerstack/repo/env.sealed");

/** The handle a child env reads its parent's merged layers through. */
const LAYERS: unique symbol = /* @__PURE__ */ Symbol.for("@workerstack/repo/env.layers");

/** An age cipher, base64, that reads back as its plaintext. Made by `sealed(...)`. */
export type Sealed = { readonly [SEALED]: string };

/** One value of an env block: plain text, or sealed. */
export type Value = string | Sealed;

/** What a process variable must be: set, or set or unset. */
export type ProcessSpec = Readonly<Record<string, "required" | "optional">>;

/** Variables by name, as `process.env` holds them. */
export type Source = Readonly<Record<string, string | undefined>>;

/** The world an env reads: its variables, and a decryptor of sealed values. */
export type EnvIo = {
  /** The process variables `current` and `process` read, at each read. */
  source(): Source;
  /** The plaintext of each cipher, in order; `key` names the read that asked, for the error line. */
  reveal(ciphers: readonly string[], key: string): string[];
};

/** One block of values by name. */
type Block = Readonly<Record<string, Value>>;

/** A block with no keys: the layer a missing block or a missing parent adds. */
type Empty = object;

/** The global block or one scope's. */
type View = "global" | Scope;

/** Each view's merged values, before any is revealed. */
type Layers = Readonly<Record<View, Block>>;

/** Anything made by `createEnv`: a parent's merged layers are all a child reads. */
type EnvTree = { readonly [LAYERS]: Layers };

/** What `defineEnv` takes: a global block, one block per scope, the process variables read, and a parent env. */
export type EnvConfig = {
  /** The dev scope's values, over global and the parent's dev. */
  readonly dev: Block;
  /** Values every scope shares; a parent's scope value wins over them. */
  readonly global?: Block;
  /** The local scope's values, over global and the parent's local. */
  readonly local: Block;
  /** The env this one stacks on: its values carry into each scope of this one. */
  readonly parent?: EnvTree;
  /** The process variables this env reads, each required or optional. */
  readonly process?: ProcessSpec;
  /** The prod scope's values, over global and the parent's prod. */
  readonly prod: Block;
};

/** `B` over `A`: the keys of both, each typed by the later layer that has it. */
type Merge<A, B> = { readonly [K in keyof A | keyof B]: K extends keyof B ? B[K] : K extends keyof A ? A[K] : never };

/** The config's own block `K`, empty when it has none. */
type Own<C, K extends View> = C extends { readonly [P in K]: infer B extends Block } ? B : Empty;

/** The parent's merged view `K`, empty when there is no parent. */
type Above<C, K extends View> = C extends { readonly parent: { readonly [LAYERS]: infer L extends Layers } }
  ? L[K]
  : Empty;

/** A scope's layers: own global, then the parent's scope view, then own scope; later wins. */
type ScopeLayers<C, S extends Scope> = Merge<Merge<Own<C, "global">, Above<C, S>>, Own<C, S>>;

/** The merged layers of a config, before any value is revealed: what a child of it stacks on. */
type LayersOf<C> = {
  /** The dev view's values, sealed ones still sealed. */
  readonly dev: ScopeLayers<C, "dev">;
  /** The parent's global, then own global. */
  readonly global: Merge<Above<C, "global">, Own<C, "global">>;
  /** The local view's values, sealed ones still sealed. */
  readonly local: ScopeLayers<C, "local">;
  /** The prod view's values, sealed ones still sealed. */
  readonly prod: ScopeLayers<C, "prod">;
};

/** A layer as it reads: every sealed value a string. */
type Unwrap<B> = { readonly [K in keyof B]: B[K] extends Sealed ? string : B[K] };

/** The keys of a layer whose value is sealed. */
type SealedKeyOf<B> = { [K in keyof B]: B[K] extends Sealed ? K : never }[keyof B];

/** The config's process spec, empty when it declares none. */
type ProcessOf<C> = C extends { readonly process: infer P extends ProcessSpec } ? P : Empty;

/** An intersection as one object type, each key's modifiers kept. */
type Flat<T> = { [K in keyof T]: T[K] };

/** The keys of a process spec declared `required`. */
type RequiredKey<P> = { [K in keyof P]: P[K] extends "required" ? K : never }[keyof P];

/** A process spec as it reads: a required variable a string, an optional one a key only when set. */
type ProcessView<P> = Flat<
  { readonly [K in RequiredKey<P>]: string } & { readonly [K in Exclude<keyof P, RequiredKey<P>>]?: string | undefined }
>;

/** Every key any scope has: what `current` may be asked. */
type CurrentKey<C> = keyof LayersOf<C>["local"] | keyof LayersOf<C>["dev"] | keyof LayersOf<C>["prod"];

/** A defined env: each scope's merged values, the current scope's, and the declared process variables. */
export type EnvInstance<C> = {
  readonly [LAYERS]: LayersOf<C>;
  /** The values of the scope `REPO_ENV` names (local when unset); a key that scope lacks throws. */
  readonly current: { readonly [K in CurrentKey<C>]: string };
  /** The dev scope's values, sealed ones decrypted on read. */
  readonly dev: Unwrap<LayersOf<C>["dev"]>;
  /** The global values, sealed ones decrypted on read. */
  readonly global: Unwrap<LayersOf<C>["global"]>;
  /** The local scope's values, sealed ones decrypted on read. */
  readonly local: Unwrap<LayersOf<C>["local"]>;
  /** The declared process variables; an unset required one throws when read. */
  readonly process: ProcessView<ProcessOf<C>>;
  /** The prod scope's values, sealed ones decrypted on read. */
  readonly prod: Unwrap<LayersOf<C>["prod"]>;
  /** The process view of another source. */
  read(source: Source): ProcessView<ProcessOf<C>>;
  /** The keys of `scope` whose winning layer is sealed. */
  sealedKeys<S extends Scope>(scope: S): ReadonlySet<SealedKeyOf<LayersOf<C>[S]>>;
};

/** A plain value as is, a sealed one revealed; `key` names the read. */
type Plain = (key: string, value: Value) => string;

const SCOPES: readonly Scope[] = ["local", "dev", "prod"];
const VIEWS: readonly View[] = ["global", ...SCOPES];
const DEFAULT_SCOPE: Scope = "local";
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;

/** What the error line names when the caller's file is unknown. */
const UNKNOWN_ORIGIN = "its env file";

/** A sealed value from the base64 of an age cipher; refuses one that is empty or not base64. */
export function sealedValue(cipher: string): Sealed {
  if (cipher === "") throw new Error("repo env: sealed() got an empty cipher; pass the base64 of an age cipher");

  if (!BASE64.test(cipher))
    throw new Error("repo env: sealed() got text that is not base64; pass the base64 of an age cipher, not plaintext");

  return Object.freeze({ [SEALED]: cipher });
}

function isSealed(value: Value): value is Sealed {
  return typeof value !== "string";
}

function isScope(name: string): name is Scope {
  return SCOPES.some((scope) => scope === name);
}

/** Refuses a Cloudflare Worker: its values come from `ctx.env`, and it has no process to decrypt in. */
function refuseWorker(): void {
  if ("caches" in globalThis && globalThis.navigator.userAgent === WORKER_USER_AGENT)
    throw new Error("repo env: defineEnv is script-only; a Cloudflare Worker reads ctx.env");
}

/** Each view's layers, later winning: a scope stacks own global, the parent's scope view, then own scope. */
function layersOf(config: EnvConfig): Layers {
  const own = config.global ?? {};
  const above = config.parent?.[LAYERS] ?? { dev: {}, global: {}, local: {}, prod: {} };

  return {
    dev: { ...own, ...above.dev, ...config.dev },
    global: { ...above.global, ...own },
    local: { ...own, ...above.local, ...config.local },
    prod: { ...own, ...above.prod, ...config.prod },
  };
}

/** Every distinct cipher across `layers`, the parent's winning values included. */
function ciphersOf(layers: Layers): string[] {
  const values = VIEWS.flatMap((view) => Object.values(layers[view]));

  return [...new Set(values.filter(isSealed).map((value) => value[SEALED]))];
}

/** An object whose enumerable getter per key returns `read(key)`. */
function getters(keys: readonly string[], read: (key: string) => string | undefined): Record<string, unknown> {
  const view: Record<string, unknown> = {};

  for (const key of keys) Object.defineProperty(view, key, { enumerable: true, get: () => read(key) });

  return view;
}

/**
 * The reader of `layers` for one env instance: every sealed value of the tree is revealed in one `io.reveal` on the
 * first sealed read and kept in this closure, so a plain read needs no key and no plaintext outlives the instance.
 */
function plainOf(layers: Layers, io: EnvIo): Plain {
  const revealed = new Map<string, string>();

  return (key, value) => {
    if (!isSealed(value)) return value;

    if (revealed.size === 0) {
      const ciphers = ciphersOf(layers);

      for (const [index, text] of io.reveal(ciphers, key).entries()) revealed.set(String(ciphers[index]), text);
    }

    return revealed.get(value[SEALED]) /* every cipher of the tree was revealed together */ as string;
  };
}

/** A view of `block` read through `plain`. */
function viewOf(block: Block, plain: Plain): Record<string, unknown> {
  return getters(Object.keys(block), (key) => plain(key, block[key] /* a key of its own block */ as Value));
}

/** The scope `REPO_ENV` names in `source`, local when unset. */
function currentScope(source: Source): Scope {
  const named = source[SCOPE_VARIABLE] ?? DEFAULT_SCOPE;

  if (isScope(named)) return named;
  throw new Error(`repo env: REPO_ENV is "${named}"; set it to local, dev or prod`);
}

/** How `current` reads: the layers, the process source, the value reader, and the defining file. */
type CurrentRead = { readonly io: EnvIo; readonly layers: Layers; readonly origin: string; readonly plain: Plain };

/** Every scope's keys, each read from the scope `REPO_ENV` names at read time; a key it lacks names `origin`. */
function currentOf({ io, layers, origin, plain }: CurrentRead): Record<string, unknown> {
  const keys = [...new Set(SCOPES.flatMap((scope) => Object.keys(layers[scope])))];

  return getters(keys, (key) => {
    const scope = currentScope(io.source());
    const value = layers[scope][key];

    if (value === undefined)
      throw new Error(`repo env: ${key} has no ${scope} value in ${origin}; add it to its ${scope} block`);

    return plain(key, value);
  });
}

/**
 * The process view of `source` per `spec`: a required variable is always a key and throws when read unset; an optional
 * one is a key only when `source` sets it, so a spread over defaults keeps them.
 */
function processView(spec: ProcessSpec, source: Source): Record<string, unknown> {
  const keys = Object.keys(spec).filter((name) => spec[name] === "required" || source[name] !== undefined);

  return getters(keys, (name) => {
    const value = source[name];

    if (value === undefined && spec[name] === "required")
      throw new Error(`repo env: process.${name} is required and unset`);

    return value;
  });
}

/** The keys of `block` whose value is sealed. */
function sealedKeysOf(block: Block): ReadonlySet<string> {
  return new Set(Object.entries(block).flatMap(([key, value]) => (isSealed(value) ? [key] : [])));
}

/**
 * The env of `config` over `io`: merged like createScriptEnv, plain values read as they are, and every sealed value of
 * the tree revealed together on the first sealed read, kept for this instance only. `origin` names the defining file.
 */
export function createEnv<C extends EnvConfig>(config: C, io: EnvIo, origin: string = UNKNOWN_ORIGIN): EnvInstance<C> {
  refuseWorker();
  const layers = layersOf(config);
  const plain = plainOf(layers, io);
  const spec = config.process ?? {};

  const env = {
    current: currentOf({ io, layers, origin, plain }),
    dev: viewOf(layers.dev, plain),
    global: viewOf(layers.global, plain),
    local: viewOf(layers.local, plain),
    get process() {
      return processView(spec, io.source());
    },
    prod: viewOf(layers.prod, plain),
    read: (source: Source) => processView(spec, source),
    sealedKeys: (scope: Scope) => sealedKeysOf(layers[scope]),
  };

  Object.defineProperty(env, LAYERS, { value: layers });

  // Each view holds a getter per key of the layers its type is computed from.
  return env /* the views match the layer types */ as EnvInstance<C>;
}
