import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Nohead, NoheadError, VERSION } from "../src/index.ts"
import { json, mockClient, mockFetch, page, record, settle } from "./helpers.ts"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe("configuration", () => {
  it("needs an API key", () => {
    vi.stubEnv("NOHEAD_API_KEY", "")
    expect(() => new Nohead()).toThrow(NoheadError)
  })

  it("reads the key from the environment, not the URL", async () => {
    vi.stubEnv("NOHEAD_API_KEY", "nohead_sk_env")
    vi.stubEnv("NOHEAD_API_URL", "https://env.test/")
    const fetch = vi.fn(async () => json(200, record("rec_1")))
    await new Nohead({ fetch }).records.get("rec_1")
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.nohead.io/v1/records/rec_1")
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer nohead_sk_env"
    )
  })

  it("takes the base URL from its option", async () => {
    vi.stubEnv("NOHEAD_API_URL", "https://env.test")
    const fetch = vi.fn(async () => json(200, record("rec_1")))
    await new Nohead({
      apiKey: "nohead_sk_x",
      baseUrl: "https://api.test",
      fetch,
    }).records.get("rec_1")
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(
      "https://api.test/v1/records/rec_1"
    )
  })

  it("treats empty options as unset", async () => {
    vi.stubEnv("NOHEAD_API_KEY", "nohead_sk_env")
    vi.stubEnv("NOHEAD_API_URL", "https://env.test")
    const fetch = vi.fn(async () => json(200, record("rec_1")))
    await new Nohead({ apiKey: "", baseUrl: "", fetch }).records.get("rec_1")
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.nohead.io/v1/records/rec_1")
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer nohead_sk_env"
    )
    vi.stubEnv("NOHEAD_API_KEY", "")
    expect(() => new Nohead({ apiKey: "" })).toThrow("Missing API key")
  })

  it.each(["ftp://api.test", "api.nohead.io", "https://", "/v1", "///"])(
    "refuses a base URL that isn't http or https (%s)",
    (baseUrl) => {
      expect(() => new Nohead({ apiKey: "nohead_sk_x", baseUrl })).toThrow(
        new NoheadError("baseUrl must be an http or https URL")
      )
    }
  )

  it("drops trailing slashes from the base URL", async () => {
    const fetch = vi.fn(async () => json(200, record("rec_1")))
    await new Nohead({
      apiKey: "nohead_sk_x",
      baseUrl: "https://api.test///",
      fetch,
    }).records.get("rec_1")
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(
      "https://api.test/v1/records/rec_1"
    )
  })

  it("defaults to the production API", async () => {
    const fetch = vi.fn(async () => json(200, record("rec_1")))
    await new Nohead({ apiKey: "nohead_sk_x", fetch }).records.get("rec_1")
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

  it("sends each header once, whatever its case", async () => {
    const { nohead, calls } = mockClient([json(201, record("rec_1"))], {
      headers: { authorization: "Bearer nohead_sk_other", "x-a": "client" },
    })
    await nohead.records.create(
      "posts",
      { data: {} },
      {
        idempotencyKey: "k1",
        headers: {
          "X-A": "call",
          "idempotency-key": "k2",
          "CONTENT-TYPE": "text/plain",
        },
      }
    )
    const sent = calls[0]!.init.headers as Record<string, string>
    const names = Object.keys(sent).map((name) => name.toLowerCase())
    expect(names).toEqual([...new Set(names)])
    const headers = calls[0]!.headers
    expect(headers.get("authorization")).toBe("Bearer nohead_sk_other")
    expect(headers.get("x-a")).toBe("call")
    // The request options' headers win.
    expect(headers.get("idempotency-key")).toBe("k1")
    expect(headers.get("content-type")).toBe("application/json")
  })

  it("keeps VERSION in step with package.json", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"))
    expect(VERSION).toBe(pkg.version)
  })
})

const me = json(200, {
  object: "principal",
  type: "api_key",
  user: null,
  api_key: {
    id: "key_1",
    name: "Site",
    scopes: [],
    published_only: false,
    project_id: "prj_9",
    expires_at: null,
  },
})

describe("the key's project", () => {
  it("is looked up once with GET /v1/me", async () => {
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

  it("is looked up for an empty projectId", async () => {
    const { nohead, calls } = mockClient([me, page([], null)], {
      projectId: "",
    })
    await nohead.collections.list()
    expect(calls.map((c) => c.url.pathname)).toEqual([
      "/v1/me",
      "/v1/projects/prj_9/collections",
    ])
  })

  it("fails clearly for credentials without a project", async () => {
    const me = json(200, {
      object: "principal",
      type: "user",
      user: { id: "usr_1", email: "a@example.com", name: null, staff: false },
      api_key: null,
    })
    const { nohead } = mockClient([me], { projectId: undefined })
    await expect(nohead.collections.list()).rejects.toThrow(
      "not a project API key"
    )
  })
})

describe("withOptions", () => {
  it("copies the client with other settings", async () => {
    const onRetry = vi.fn()
    const { fetch, calls } = mockFetch([
      me,
      page([], null),
      new TypeError("fetch failed"),
      page([], null),
      page([], null),
    ])
    const nohead = new Nohead({
      apiKey: "nohead_sk_test",
      baseUrl: "https://api.test",
      fetch,
      maxRetries: 0,
      headers: { "X-A": "client", "X-B": "client" },
    })
    const copy = nohead.withOptions({
      maxRetries: 1,
      timeout: 5_000,
      headers: { "x-b": "copy" },
      onRetry,
    })
    await nohead.collections.list()
    // The copy retries, and doesn't look the project up again.
    vi.useFakeTimers()
    await settle(copy.collections.list())
    expect(onRetry).toHaveBeenCalledTimes(1)
    await nohead.webhooks.list()
    expect(calls.map((c) => c.url.pathname)).toEqual([
      "/v1/me",
      "/v1/projects/prj_9/collections",
      "/v1/projects/prj_9/collections",
      "/v1/projects/prj_9/collections",
      "/v1/projects/prj_9/webhooks",
    ])
    expect(calls[3]!.headers.get("x-a")).toBe("client")
    expect(calls[3]!.headers.get("x-b")).toBe("copy")
    expect(calls[4]!.headers.get("x-b")).toBe("client")
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
