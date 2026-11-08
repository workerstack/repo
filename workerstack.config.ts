import { defineConfig } from "@workerstack/repo"

export default defineConfig({
  packs: ["agents", "docs"],
  agents: { skills: ["google-workspace", "listen", "speak", "clasp"] },
})
