import { expect, it, vi } from "vitest";
import { OPENAI_VOICES, voices, whoami } from "./speak.ts";
import type { FetchFn } from "./speak.ts";
import { cfgOf, failRes, fetchReturning, jsonRes, okRes } from "./fixtures/speak-kit.ts";

const eleven = () => cfgOf({ ELEVENLABS_API_KEY: "sk_el" });
const openai = () => cfgOf({ OPENAI_API_KEY: "sk_oa" });
const accountOf = (value: unknown) => whoami({ cfg: eleven(), fetchFn: fetchReturning(jsonRes(value)) });

it("whoami: shows the elevenlabs account", async () => {
  expect(await accountOf({ email: "me@example.com", subscription: { tier: "pro" } })).toBe(
    "elevenlabs  me@example.com  tier=pro",
  );
});

it.each([{ subscription: {} }, "nope", null])("whoami: shows dashes for missing details (%j)", async (value) => {
  expect(await accountOf(value)).toBe("elevenlabs  ok  tier=-");
});

it("whoami: shows dashes when the reply has no body reader", async () => {
  expect(await whoami({ cfg: eleven(), fetchFn: fetchReturning(okRes()) })).toBe("elevenlabs  ok  tier=-");
});

it("whoami: treats a scoped key as ok", async () => {
  const scoped = failRes(401, '{"status":"missing_permissions"}');
  expect(await whoami({ cfg: eleven(), fetchFn: fetchReturning(scoped) })).toMatch(/^elevenlabs {2}ok \(scoped key/);
});

it("whoami: rethrows any other elevenlabs failure", async () => {
  await expect(whoami({ cfg: eleven(), fetchFn: fetchReturning(failRes(500, "boom")) })).rejects.toThrow("500 boom");
});

it("whoami: checks the openai models endpoint with the bearer key", async () => {
  const urls: string[] = [];
  const fetchFn: FetchFn = (url, init) => {
    urls.push(`${url} ${init.headers?.Authorization}`);
    return Promise.resolve(okRes());
  };
  expect(await whoami({ cfg: openai(), fetchFn })).toBe("openai ok");
  expect(urls).toEqual(["https://api.openai.com/v1/models Bearer sk_oa"]);
});

it("whoami: reports a rejected openai key", async () => {
  const fetchFn = fetchReturning(failRes(403, ""));
  await expect(whoami({ cfg: openai(), fetchFn })).rejects.toThrow("openai key missing or rejected");
});

it("voices: lists openai voices without a request", async () => {
  const fetchFn = vi.fn();
  expect(await voices({ cfg: openai(), fetchFn })).toBe(OPENAI_VOICES.join("\n"));
  expect(fetchFn).not.toHaveBeenCalled();
});

it("voices: lists elevenlabs voices, with placeholders for junk entries", async () => {
  const list = jsonRes({ voices: [{ voice_id: "v1", name: "Ada" }, "junk"] });
  expect(await voices({ cfg: eleven(), fetchFn: fetchReturning(list) })).toBe("v1  Ada\nundefined  undefined");
});

it.each([{ voices: "no" }, null])("voices: lists nothing for an odd reply (%j)", async (value) => {
  expect(await voices({ cfg: eleven(), fetchFn: fetchReturning(jsonRes(value)) })).toBe("");
});

it("voices: lists nothing when the reply has no body reader", async () => {
  expect(await voices({ cfg: eleven(), fetchFn: fetchReturning(okRes()) })).toBe("");
});
