import { defineConfig } from "@workerstack/repo"

export default defineConfig({
  packs: ["agents", "standards", "docs", "release"],
  agents: { skills: ["google-workspace", "listen", "speak", "clasp"] },
})
