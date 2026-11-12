import {
  CREDENTIAL_NAME,
  CREDENTIAL_REASON,
  CREDENTIAL_SHAPE,
  DIGIT,
  ENTROPY_BITS,
  ENTROPY_REASON,
  LETTER,
  LOWER,
  PUBLIC_PREFIXES,
  SECRET_PREFIXES,
  TOKEN_SHAPE,
  UPPER,
  URL_MARK,
} from "./check-env-values.constants.ts";

/** The Shannon entropy of `text`, in bits per character. */
function entropyOf(text: string): number {
  const counts = new Map<string, number>();

  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  const shares = [...counts.values()].map((count) => count / text.length);

  return shares.reduce((bits, share) => bits - share * Math.log2(share), 0);
}

/** A mixed-case token of high entropy: no hex id, UUID, domain or slug mixes both cases. */
function isRandomToken(value: string): boolean {
  return TOKEN_SHAPE.test(value) && UPPER.test(value) && LOWER.test(value) && entropyOf(value) >= ENTROPY_BITS;
}

/** A long value of letters and digits, no space, under a key named for a credential. */
function isNamedCredential(key: string, value: string): boolean {
  return CREDENTIAL_NAME.test(key) && CREDENTIAL_SHAPE.test(value) && LETTER.test(value);
}

/**
 * Why the value of `key` looks like a secret (`sk_ prefix`, `high entropy`, `credential name`), or null when it does
 * not: a provider prefix; a mixed-case token with digits of high entropy; or a long letter-and-digit value under a key
 * named for a credential. A URL and a Stripe publishable key are never secrets.
 */
export function secretReason(key: string, value: string): string | null {
  if (PUBLIC_PREFIXES.some((head) => value.startsWith(head))) return null;
  const prefix = SECRET_PREFIXES.find((head) => value.startsWith(head));

  if (prefix !== undefined) return `${prefix} prefix`;

  if (value.includes(URL_MARK) || !DIGIT.test(value)) return null;

  if (isRandomToken(value)) return ENTROPY_REASON;

  return isNamedCredential(key, value) ? CREDENTIAL_REASON : null;
}
