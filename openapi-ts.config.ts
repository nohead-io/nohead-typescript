import { defineConfig } from "@hey-api/openapi-ts"

// Types only: the SDK's requests are hand-written (docs: README, "Development").
// The input is the published contract, copied from the API (x-internal
// operations already removed).
export default defineConfig({
  input: "openapi.json",
  output: {
    path: "src/generated",
    module: { extension: ".ts" },
    indexFile: false,
  },
  plugins: ["@hey-api/typescript"],
})
