import { sealedValue } from "../define.ts";
import type { EnvIo, Sealed } from "../define.ts";

/** A fake `EnvIo` over `source`, and every list of ciphers it was asked to reveal. */
export type FakeIo = { readonly calls: string[][]; readonly io: EnvIo };

/** A fake decryptor: each cipher is base64 of its plaintext. Records every call it gets. */
export function fakeIo(source: Record<string, string | undefined> = {}): FakeIo {
  const calls: string[][] = [];
  const io: EnvIo = {
    reveal: (ciphers) => {
      calls.push([...ciphers]);
      return ciphers.map((cipher) => atob(cipher));
    },
    source: () => source,
  };
  return { calls, io };
}

/** A sealed value whose fake cipher reveals to `text`. */
export function sealedOf(text: string): Sealed {
  return sealedValue(btoa(text));
}
