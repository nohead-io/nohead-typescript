import { defineConfig } from "vitest/config"

export default defineConfig({
  // A test that checks nothing fails.
  test: {
    expect: { requireAssertions: true },
    // The client reads NOHEAD_API_URL: one in the shell mustn't move the
    // tests off their mocked API.
    env: { NOHEAD_API_URL: "" },
  },
})
