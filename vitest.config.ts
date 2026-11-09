import { defineConfig } from "vitest/config"

export default defineConfig({
  // A test that checks nothing fails.
  test: {
    expect: { requireAssertions: true },
    // The client reads NOHEAD_API_URL: one in the shell mustn't move the
    // tests off their mocked API.
    // Not UTC, so a time read in the local zone where the API sends GMT (an
    // HTTP date's) is hours off, and fails its test.
    env: { NOHEAD_API_URL: "", TZ: "America/Los_Angeles" },
  },
})
