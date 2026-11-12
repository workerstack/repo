import { describe, expect, it } from "vitest";

import { decryptChild, isWrongKey, newIdentity, reveal, seal } from "./age.ts";

describe("seal and reveal", () => {
  it("reveals what it sealed, from a base64 age cipher", async () => {
    const { identity, recipient } = await newIdentity();
    const cipher = await seal("hello env", recipient);
    expect(cipher).toMatch(/^YWdl[A-Za-z0-9+/]+=*$/);
    expect(await reveal([cipher], [identity])).toStrictEqual(["hello env"]);
  });

  it("names an age X25519 recipient", async () => {
    const { recipient } = await newIdentity();
    expect(recipient).toMatch(/^age1[a-z0-9]{58}$/);
  });

  it("refuses a cipher sealed for another key", async () => {
    const sender = await newIdentity();
    const other = await newIdentity();
    const cipher = await seal("hello env", sender.recipient);
    await expect(reveal([cipher], [other.identity])).rejects.toThrow(Error);
  });

  it("reveals each cipher with whichever identity it was sealed for, in order", async () => {
    const first = await newIdentity();
    const second = await newIdentity();
    const ciphers = [await seal("one", second.recipient), await seal("two", first.recipient)];
    expect(await reveal(ciphers, [first.identity, second.identity])).toStrictEqual(["one", "two"]);
  });

  it("reveals nothing for no ciphers", async () => {
    expect(await reveal([], [])).toStrictEqual([]);
  });
});

describe("isWrongKey", () => {
  it("names a cipher sealed for another key", async () => {
    const sender = await newIdentity();
    const other = await newIdentity();
    const cipher = await seal("hello env", sender.recipient);
    const error: unknown = await reveal([cipher], [other.identity]).catch((caught: unknown) => caught);
    expect(isWrongKey(error)).toBe(true);
  });

  it("does not name a cipher that is not age", async () => {
    const { identity } = await newIdentity();
    const error: unknown = await reveal(["AAAA"], [identity]).catch((caught: unknown) => caught);
    expect([error instanceof Error, isWrongKey(error)]).toStrictEqual([true, false]);
  });

  it("does not name a thrown value that is not an error", () => {
    expect(isWrongKey("no identity matched")).toBe(false);
  });
});

describe("decryptChild", () => {
  it("answers a stdin request with the plaintexts as JSON", async () => {
    const { identity, recipient } = await newIdentity();
    const input = JSON.stringify({ ciphers: [await seal("one", recipient)], identities: [identity] });
    expect(JSON.parse(await decryptChild(input))).toStrictEqual(["one"]);
  });

  it("refuses a request that is not cipher and identity lists", async () => {
    await expect(decryptChild("{}")).rejects.toThrow("repo env: the decrypt child takes");
  });
});
