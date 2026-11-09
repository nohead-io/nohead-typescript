import { defineConfig } from "vitest/config"

// Not UTC, so a time read in the local zone where the API sends GMT (an HTTP
// date's) is off, and fails its test. The test workers inherit it.
process.env.TZ = "America/Los_Angeles"

export default defineConfig({
  // A test that checks nothing fails.
  test: {
    expect: { requireAssertions: true },
    // The client reads NOHEAD_API_URL: one in the shell mustn't move the
    // tests off their mocked API.
    env: { NOHEAD_API_URL: "" },
  },
})
