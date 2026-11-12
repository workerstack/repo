import { Decrypter, Encrypter, generateIdentity, identityToRecipient } from "age-encryption";

import { readRequest } from "./keys.ts";

/** What age says when no identity it holds opens a file: the file was sealed for another key. */
const NO_MATCH = "no identity matched";

/** An age X25519 key pair: the secret identity and the `age1…` recipient that seals for it. */
export type AgeKeyPair = { readonly identity: string; readonly recipient: string };

/** A new age X25519 key pair. */
export async function newIdentity(): Promise<AgeKeyPair> {
  const identity = await generateIdentity();

  return { identity, recipient: await identityToRecipient(identity) };
}

/** `text` sealed for `recipient`, as the base64 of age's binary cipher. */
export async function seal(text: string, recipient: string): Promise<string> {
  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);

  return Buffer.from(await encrypter.encrypt(text)).toString("base64");
}

/** Each base64 cipher's plaintext, in order, opened by whichever of `identities` it was sealed for. */
export function reveal(ciphers: readonly string[], identities: readonly string[]): Promise<string[]> {
  const decrypter = new Decrypter();

  for (const identity of identities) decrypter.addIdentity(identity);

  return Promise.all(ciphers.map((cipher) => decrypter.decrypt(Buffer.from(cipher, "base64"), "text")));
}

/** Whether `cause`, thrown by `reveal`, says a cipher was sealed for a key none of the identities is. */
export function isWrongKey(cause: unknown): boolean {
  return cause instanceof Error && cause.message.includes(NO_MATCH);
}

/**
 * The decrypt child's work: the `{ ciphers, identities }` JSON it reads on stdin in, the JSON list of plaintexts it
 * writes on stdout out. Throws when a cipher does not open; `isWrongKey` says whether it was sealed for another key.
 */
export async function decryptChild(input: string): Promise<string> {
  const request = readRequest(input);

  return JSON.stringify(await reveal(request.ciphers, request.identities));
}
