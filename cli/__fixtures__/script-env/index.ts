/**
 * A fake `@acme/script-env`, written from the createScriptEnv contract the migrate tests rely on and copied by them
 * into a temp repo as the package's source, where it is the file that defines createScriptEnv:
 *
 * - `createScriptEnv({ global?, local, dev, prod, parent? })` merges each scope as own global, then the parent's scope,
 *   then own scope, later winning (global: the parent's global, then own), and its views hold strings: every
 *   `secret()` of every layer unwrapped.
 * - `secret(value)` marks a value secret: deployed as a secret, read as its string.
 * - `secretKeysOf(env, scope)` names the keys of `scope` whose winning value was a `secret()`; on any object
 *   createScriptEnv did not make it finds none, so a defineEnv instance gets an empty set.
 * - `unwrapSecrets(values)` turns a block's `secret()` values into their strings; a view's strings stay as they are.
 */

const SECRET: unique symbol = /* @__PURE__ */ Symbol.for("@acme/script-env.secret");
const SECRET_KEYS: unique symbol = /* @__PURE__ */ Symbol.for("@acme/script-env.secret-keys");

/** A value marked secret: deployed as a secret, read as its string. */
export type Secret = { readonly [SECRET]: string };

/** One value of a block: plain text, or marked secret. */
export type ScriptValue = string | Secret;

/** One block of values by name. */
export type ScriptBlock = Readonly<Record<string, ScriptValue>>;

/** The scopes a script env declares. */
export type ScriptScope = "local" | "dev" | "prod";

/** The global block or one scope's. */
type View = "global" | ScriptScope;

/** Each view's merged values, secrets still marked. */
type Layers = Readonly<Record<View, ScriptBlock>>;

/** A script env: each view's merged values as strings. */
export type ScriptEnv = Readonly<Record<View, Readonly<Record<string, string>>>> & {
  readonly layers: Layers;
  readonly [SECRET_KEYS]: Readonly<Record<ScriptScope, ReadonlySet<string>>>;
};

/** What createScriptEnv takes: a global block, one block per scope, and the env this one stacks on. */
export type ScriptEnvConfig = {
  readonly dev: ScriptBlock;
  readonly global?: ScriptBlock;
  readonly local: ScriptBlock;
  readonly parent?: ScriptEnv;
  readonly prod: ScriptBlock;
};

/** `value` marked secret. */
export function secret(value: string): Secret {
  return Object.freeze({ [SECRET]: value });
}

function isSecret(value: ScriptValue): value is Secret {
  return typeof value !== "string";
}

/** Each value of `values` as its string, a `secret()` unwrapped. */
export function unwrapSecrets(values: Readonly<Record<string, ScriptValue>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, isSecret(value) ? value[SECRET] : value]),
  );
}

function isScriptEnv(env: object): env is ScriptEnv {
  return SECRET_KEYS in env;
}

/** The keys of `scope` in `env` whose winning value was a `secret()`; none for an env createScriptEnv did not make. */
export function secretKeysOf(env: object, scope: ScriptScope): ReadonlySet<string> {
  return isScriptEnv(env) ? env[SECRET_KEYS][scope] : new Set();
}

/** Each view's layers, later winning: a scope stacks own global, the parent's scope, then own scope. */
function layersOf(config: ScriptEnvConfig): Layers {
  const own = config.global ?? {};
  const above = config.parent?.layers ?? { dev: {}, global: {}, local: {}, prod: {} };

  return {
    dev: { ...own, ...above.dev, ...config.dev },
    global: { ...above.global, ...own },
    local: { ...own, ...above.local, ...config.local },
    prod: { ...own, ...above.prod, ...config.prod },
  };
}

/** The keys of `block` whose value is a `secret()`. */
function secretsIn(block: ScriptBlock): ReadonlySet<string> {
  return new Set(Object.keys(block).filter((key) => isSecret(block[key] /* a key of its own block */ as ScriptValue)));
}

/** The env of `config`: merged as the file comment says, every view's values strings. */
export function createScriptEnv(config: ScriptEnvConfig): ScriptEnv {
  const layers = layersOf(config);

  return {
    dev: unwrapSecrets(layers.dev),
    global: unwrapSecrets(layers.global),
    layers,
    local: unwrapSecrets(layers.local),
    prod: unwrapSecrets(layers.prod),
    [SECRET_KEYS]: { dev: secretsIn(layers.dev), local: secretsIn(layers.local), prod: secretsIn(layers.prod) },
  };
}
