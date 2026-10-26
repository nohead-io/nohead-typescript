import { defineConfig } from "vitest/config"

export default defineConfig({
  // A test that checks nothing fails.
  test: { expect: { requireAssertions: true } },
})
