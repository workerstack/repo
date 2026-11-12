import { afterEach, expect, it, vi } from "vitest";

import { parsedFetch } from "./parsed-fetch.ts";

afterEach(() => vi.unstubAllGlobals());

/** Stubs the global fetch with one that answers `body` and records each call's url and method. */
function answering(body: string, init: ResponseInit = {}): { url: string; method: string | undefined }[] {
  const calls: { url: string; method: string | undefined }[] = [];
  vi.stubGlobal("fetch", (url: string, request: RequestInit) => {
    calls.push({ method: request.method, url });

    return Promise.resolve(new Response(body, init));
  });

  return calls;
}

it("hands the global fetch the url and init, and reads the reply's status, ok and headers", async () => {
  const calls = answering("{}", { headers: { "x-id": "7" }, status: 201 });
  const res = await parsedFetch("https://api.test/v1", { method: "POST" });
  expect(calls).toStrictEqual([{ method: "POST", url: "https://api.test/v1" }]);
  expect([res.status, res.ok, res.headers.get("x-id")]).toStrictEqual([201, true, "7"]);
});

it("parses a JSON body through json()", async () => {
  answering('{"text":"hi","n":[1,null]}');
  const res = await parsedFetch("https://api.test", {});
  expect(await res.json()).toStrictEqual({ n: [1, null], text: "hi" });
});

it("rejects a body that is no JSON", async () => {
  answering("not json", { status: 500 });
  const res = await parsedFetch("https://api.test", {});
  expect(res.ok).toBe(false);
  await expect(res.json()).rejects.toThrow(SyntaxError);
});

it("reads the body as text or bytes", async () => {
  answering("abc");
  const asText = await parsedFetch("https://api.test", {});
  expect(await asText.text()).toBe("abc");
  answering("abc");
  const asBytes = await parsedFetch("https://api.test", {});
  expect([...new Uint8Array(await asBytes.arrayBuffer())]).toStrictEqual([97, 98, 99]);
});
