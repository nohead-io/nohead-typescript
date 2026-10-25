import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ClientOptions, Nohead as Client } from "../src/index.ts"
import { API_HOST, json, mockFetch, record } from "./helpers.ts"

// What has been warned about is the process's, not a client's, so that a
// client made per request (as on Workers) doesn't warn on every one. Each
// test loads the SDK afresh.
let Nohead: typeof Client
beforeEach(async () => {
  vi.resetModules()
  ;({ Nohead } = await import("../src/index.ts"))
})
afterEach(() => {
  vi.restoreAllMocks()
})

function client(replies: Response[], options: ClientOptions = {}) {
  return new Nohead({
    apiKey: "nohead_sk_test",
    baseUrl: `https://${API_HOST}`,
    projectId: "prj_1",
    fetch: mockFetch(replies).fetch,
    ...options,
  })
}

const deprecated = {
  deprecation: "@1798761600",
  sunset: "Fri, 01 Jan 2027 00:00:00 GMT",
  link: '<https://nohead.io/docs/changelog>; rel="deprecation"',
}

const empty = { data: [], meta: { next_cursor: null, has_more: false } }

function warnings() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  return () => warn.mock.calls.map(([message]) => message as string)
}

describe("warnings", () => {
  it("names a deprecated operation once, with its Sunset and Link", async () => {
    const warned = warnings()
    const nohead = client([
      json(200, record("rec_1"), deprecated),
      json(200, record("rec_1"), deprecated),
      json(200, empty),
    ])
    await nohead.records.get("rec_1")
    await nohead.records.get("rec_1")
    await nohead.records.list("posts")
    // Once per process: another client doesn't warn again.
    await client([json(200, record("rec_1"), deprecated)]).records.get("rec_1")
    expect(warned()).toEqual([
      "[nohead] records_get is deprecated and will be removed after Fri, 01 Jan 2027 00:00:00 GMT. See https://nohead.io/docs/changelog",
    ])
  })

  it("warns about each deprecated operation", async () => {
    const warned = warnings()
    const nohead = client([
      json(200, record("rec_1"), { deprecation: "@1798761600" }),
      json(200, empty, { deprecation: "@1798761600" }),
    ])
    await nohead.records.get("rec_1")
    await nohead.records.list("posts")
    expect(warned()).toEqual([
      "[nohead] records_get is deprecated",
      "[nohead] records_list is deprecated",
    ])
  })

  it("names a plan's usage warning once", async () => {
    const warned = warnings()
    const usage = { "nohead-usage-warning": "records: 1,000 of 1,000" }
    const nohead = client([
      json(200, record("rec_1"), usage),
      json(200, empty, { "nohead-usage-warning": "records: 1,001 of 1,000" }),
    ])
    await nohead.records.get("rec_1")
    await nohead.records.list("posts")
    expect(warned()).toEqual([
      "[nohead] Over a plan limit: records: 1,000 of 1,000",
    ])
  })

  it("keeps quiet with warnings: false", async () => {
    const warned = warnings()
    const headers = { ...deprecated, "nohead-usage-warning": "records" }
    const nohead = client([json(200, record("rec_1"), headers)], {
      warnings: false,
    })
    const { response } = await nohead.records.get("rec_1").withResponse()
    expect(warned()).toEqual([])
    // The headers are still there to read.
    expect(response.headers.get("deprecation")).toBe("@1798761600")
  })
})
