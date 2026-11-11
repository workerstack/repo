import path from "node:path";

import { main } from "../link.ts";
import { NAME, type World, scene, sibling } from "./link-world.ts";

/** A scene with the flare package and a second `solo` sibling both linked, in that order. */
export async function linkedPair(): Promise<World> {
  const w = scene();
  sibling(path.join(w.base, "solo"), "@workerstack/solo", "1.0.0");
  await main([NAME], w.io());
  await main(["@workerstack/solo"], w.io());
  return w;
}
