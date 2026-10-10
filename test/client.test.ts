import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Nohead, NoheadError, VERSION } from "../src/index.ts"
import { json, mockClient, record } from "./helpers.ts"

afterEach(() => vi.unstubAllEnvs())

describe("configuration", () => {
  it("needs an API key", () => {
    vi.stubEnv("NOHEAD_API_KEY", "")
    expect(() => new Nohead()).toThrow(NoheadError)
  })

  it("reads the key and URL from the environment", async () => {
    vi.stubEnv("NOHEAD_API_KEY", "sk_live_env")
    vi.stubEnv("NOHEAD_API_URL", "https://env.test/")
    const fetch = vi.fn(async () => json(200, record("rec_1")))
    await new Nohead({ fetch }).records.get("rec_1")
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://env.test/v1/records/rec_1")
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer sk_live_env"
    )
  })

  it("drops trailing slashes from the base URL", async () => {
    const fetch = vi.fn(async () => json(200, record("rec_1")))
    await new Nohead({
      apiKey: "sk_live_x",
      baseUrl: "https://api.test///",
      fetch,
    }).records.get("rec_1")
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(
      "https://api.test/v1/records/rec_1"
    )
  })

  it("defaults to the production API", async () => {
    vi.stubEnv("NOHEAD_API_URL", "")
    const fetch = vi.fn(async () => json(200, record("rec_1")))
    await new Nohead({ apiKey: "sk_live_x", fetch }).records.get("rec_1")
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(
      "https://api.nohead.io/v1/records/rec_1"
    )
  })

  it("identifies itself", async () => {
    const { nohead, calls } = mockClient([json(200, record("rec_1"))], {
      headers: { "X-Extra": "yes" },
    })
    await nohead.records.get("rec_1")
    expect(calls[0]!.headers.get("nohead-client")).toBe(
      `sdk-typescript/${VERSION}`
    )
    expect(calls[0]!.headers.get("user-agent")).toBe(
      `nohead-typescript/${VERSION} node/${process.versions.node}`
    )
    expect(calls[0]!.headers.get("accept")).toBe("application/json")
    expect(calls[0]!.headers.get("x-extra")).toBe("yes")
  })

  it("keeps VERSION in step with package.json", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"))
    expect(VERSION).toBe(pkg.version)
  })
})

describe("the key's project", () => {
  it("is looked up once with GET /v1/me", async () => {
    const me = json(200, {
      object: "principal",
      type: "api_key",
      user: null,
      api_key: { id: "key_1", project_id: "prj_9", scopes: [] },
    })
    const list = json(200, {
      data: [],
      meta: { next_cursor: null, has_more: false },
    })
    const { nohead, calls } = mockClient([me, list], { projectId: undefined })
    await nohead.collections.list()
    await nohead.webhooks.list()
    expect(calls.map((c) => c.url.pathname)).toEqual([
      "/v1/me",
      "/v1/projects/prj_9/collections",
      "/v1/projects/prj_9/webhooks",
    ])
  })

  it("fails clearly for credentials without a project", async () => {
    const me = json(200, {
      object: "principal",
      type: "user",
      user: {},
      api_key: null,
    })
    const { nohead } = mockClient([me], { projectId: undefined })
    await expect(nohead.collections.list()).rejects.toThrow(
      "not a project API key"
    )
  })
})

describe("withResponse", () => {
  it("returns the data with the response", async () => {
    const { nohead } = mockClient([
      json(200, record("rec_1"), { "x-request-id": "req_42" }),
    ])
    const { data, response, requestId } = await nohead.records
      .get("rec_1")
      .withResponse()
    expect(data.id).toBe("rec_1")
    expect(response.status).toBe(200)
    expect(requestId).toBe("req_42")
  })
})
