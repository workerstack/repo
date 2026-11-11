/** A name in camelCase: a lowercase letter, then letters and digits, as `programTimeout` or `parseUrl`. */
const CAMEL = /^[a-z][A-Za-z\d]*$/;
/** A name in PascalCase: an uppercase letter, then letters and digits, as `ConfigShape` or `URL`. */
const PASCAL = /^[A-Z][A-Za-z\d]*$/;
/** A name in UPPER_SNAKE: uppercase words of letters and digits joined by `_`, as `MAGIC_REGEX`. */
const UPPER_SNAKE = /^[A-Z][A-Z\d]*(?:_[A-Z\d]+)*$/;
/** A boolean's name: is, has, can, should or was, then an uppercase letter, so `island` and `hash` miss. */
const BOOLEAN_PREFIX = /^(?:is|has|can|should|was)[A-Z]/;
/** One word of a name: an acronym (`HTTP` of `HTTPServer`), a capitalised or lowercase word, or digits. */
const WORD = /[A-Z]+(?![a-z])\d*|[A-Z]?[a-z]+\d*|\d+/g;

/** Whether `name` is camelCase. */
export function isCamel(name: string): boolean {
  return CAMEL.test(name);
}

/** Whether `name` is PascalCase. */
export function isPascal(name: string): boolean {
  return PASCAL.test(name);
}

/** Whether `name` is UPPER_SNAKE. */
export function isUpperSnake(name: string): boolean {
  return UPPER_SNAKE.test(name);
}

/** Whether `name` reads as a boolean: `isReady`, `hasX`, `canX`, `shouldX`, `wasX`. */
export function isBooleanName(name: string): boolean {
  return BOOLEAN_PREFIX.test(name);
}

function wordsOf(name: string): string[] {
  return name.match(WORD) ?? [];
}

function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** `name` in PascalCase: "config_shape" → "ConfigShape". */
export function toPascal(name: string): string {
  const words = wordsOf(name);
  return words.length === 0 ? name : words.map(capitalised).join("");
}

/** `name` in camelCase: "PROGRAM_TIMEOUT" → "programTimeout", "tool_name" → "toolName". */
export function toCamel(name: string): string {
  const pascal = toPascal(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** `name` in UPPER_SNAKE: "tail" → "TAIL", "magicRegex" → "MAGIC_REGEX". */
export function toUpperSnake(name: string): string {
  const words = wordsOf(name);
  return words.length === 0 ? name : words.join("_").toUpperCase();
}

/** `name` as a boolean reads: "found" → "isFound". */
export function toBooleanName(name: string): string {
  return `is${toPascal(name)}`;
}
