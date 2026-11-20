// The client through the platform's fetch, against a real HTTP server on
// 127.0.0.1: what goes over the wire, which a fake fetch can't show.
import { describe, expect, it } from "vitest"

import {
  APIError,
  ConnectionError,
  Nohead,
  TimeoutError,
  UploadError,
  type Uploadable,
} from "../src/index.ts"
import { exampleOf, record } from "./helpers.ts"
import { localServer, sendJson } from "./server.ts"

const client = (url: string, timeout = 5_000) =>
  new Nohead({
    apiKey: "nohead_sk_test",
    baseUrl: url,
    projectId: "prj_1",
    maxRetries: 0,
    timeout,
  })

const asset = (status: string) =>
  exampleOf("assets_get", {
    id: "ast_1",
    filename: "a.txt",
    content_type: "text/plain",
    byte_size: 5,
    status,
  })

const hello = () => new TextEncoder().encode("hello")

/** A stream of `parts`, each a chunk. */
const streamOf = (...parts: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(new TextEncoder().encode(part))
      }
      controller.close()
    },
  })

/** The API and storage: an upload that storage takes and completes. */
const uploadServer = async () => {
  const server = await localServer((request, response) => {
    if (request.path === "/v1/projects/prj_1/assets") {
      sendJson(response, 201, {
        ...asset("pending"),
        upload: {
          method: "PUT",
          url: `${server.url}/storage/ast_1?signature=x`,
          headers: { "Content-Type": "text/plain" },
          expires_at: new Date(Date.now() + 900_000).toISOString(),
        },
      })
    } else if (request.path.startsWith("/storage/")) {
      response.end()
    } else {
      sendJson(response, 200, asset("ready"))
    }
  })
  return server
}

describe("over HTTP", () => {
  it.each<[string, () => Uploadable, number?]>([
    ["a Blob", () => new Blob(["hello"])],
    ["a Uint8Array", hello],
    ["an ArrayBuffer", () => hello().buffer],
    ["a ReadableStream", () => streamOf("hel", "lo"), 5],
  ])(
    "uploads %s with a Content-Length, not in chunks",
    async (_, file, byteSize) => {
      const { url, received } = await uploadServer()
      const ready = await client(url).assets.upload(file(), {
        filename: "a.txt",
        byte_size: byteSize,
      })
      expect(ready.status).toBe("ready")
      expect(received.map((r) => `${r.method} ${r.path}`)).toEqual([
        "POST /v1/projects/prj_1/assets",
        "PUT /storage/ast_1?signature=x",
        "POST /v1/assets/ast_1/complete",
      ])
      const put = received[1]!
      // Storage checks the signed size, and refuses a chunked body.
      expect(put.headers["content-length"]).toBe("5")
      expect(put.headers).not.toHaveProperty("transfer-encoding")
      expect(put.headers["content-type"]).toBe("text/plain")
      expect(put.headers).not.toHaveProperty("authorization")
      expect(put.body.toString()).toBe("hello")
    }
  )

  const helloWorld = () => new TextEncoder().encode("hello world")
  it.each<[string, () => Uploadable]>([
    ["a Blob", () => new Blob(["hello world"])],
    // Bytes that start inside their buffer.
    [
      "a Uint8Array",
      () => new TextEncoder().encode(">hello world").subarray(1),
    ],
    ["an ArrayBuffer", () => helloWorld().buffer],
    ["a ReadableStream", () => streamOf("hel", "lo wor", "ld")],
  ])("sends only byte_size bytes of %s", async (_, file) => {
    const { url, received } = await uploadServer()
    const ready = await client(url).assets.upload(file(), {
      filename: "a.txt",
      byte_size: 5,
    })
    expect(ready.status).toBe("ready")
    const put = received[1]!
    expect(put.headers["content-length"]).toBe("5")
    expect(put.body.toString()).toBe("hello")
  })

  it.each<[string, () => Uploadable, string[]]>([
    // A known size is refused before the upload starts.
    ["a Blob", () => new Blob(["hel"]), []],
    ["a Uint8Array", () => new TextEncoder().encode("hel"), []],
    ["an ArrayBuffer", () => new TextEncoder().encode("hel").buffer, []],
    [
      "a ReadableStream",
      () => streamOf("he", "l"),
      ["POST /v1/projects/prj_1/assets"],
    ],
  ])(
    "throws UploadError for %s with fewer bytes than byte_size",
    async (_, file, requests) => {
      const { url, received } = await uploadServer()
      const error = await client(url)
        .assets.upload(file(), { filename: "a.txt", byte_size: 5 })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(UploadError)
      expect((error as UploadError).message).toBe(
        "Could not upload a.txt: it has 3 bytes, fewer than its byte_size (5)"
      )
      expect(received.map((r) => `${r.method} ${r.path}`)).toEqual(requests)
    }
  )

  it("waits as long as the response keeps arriving", async () => {
    const body = JSON.stringify(record("rec_1", { title: "Slow" }))
    const { url } = await localServer((_, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      // Six parts 40 ms apart: longer than the timeout in all, never 150 ms
      // without progress.
      const parts = [0, 1, 2, 3, 4, 5].map((i) =>
        body.slice((i * body.length) / 6, ((i + 1) * body.length) / 6)
      )
      response.write(parts.shift())
      const timer = setInterval(() => {
        const part = parts.shift()
        if (part === undefined) {
          clearInterval(timer)
          response.end()
        } else {
          response.write(part)
        }
      }, 40)
      response.on("close", () => clearInterval(timer))
    })
    const started = performance.now()
    const got = await client(url, 150).records.get("rec_1")
    expect(got.data).toEqual({ title: "Slow" })
    expect(performance.now() - started).toBeGreaterThan(160)
  })

  it.each([
    ["before the response", () => undefined],
    [
      "in the middle of its body",
      (response: import("node:http").ServerResponse) => {
        response.writeHead(200, { "content-type": "application/json" })
        response.write('{"id":"rec_1",')
      },
    ],
  ])("times out when the response stalls %s", async (_, stall) => {
    const { url } = await localServer((_, response) => stall(response))
    const started = performance.now()
    const error = await client(url, 100)
      .records.get("rec_1")
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TimeoutError)
    expect((error as TimeoutError).message).toBe(
      `The request to ${new URL(url).host} timed out after 100 ms`
    )
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it.each([301, 302])("doesn't follow a %i", async (status) => {
    const { url, received } = await localServer((request, response) => {
      if (request.path === "/v1/records/rec_1") {
        response.writeHead(status, { location: `${url}/elsewhere` })
        response.end()
      } else {
        sendJson(response, 200, record("rec_1"))
      }
    })
    const error = await client(url)
      .records.get("rec_1")
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(APIError)
    // errors.test.ts has the whole message.
    expect(error).toMatchObject({
      status,
      type: "redirect",
      message: expect.stringContaining(`${url}/elsewhere`) as string,
    })
    expect(received.map((r) => r.path)).toEqual(["/v1/records/rec_1"])
  })

  it("can't read a malformed response: a connection error that says so", async () => {
    const { url } = await localServer((_, __, raw) => {
      raw.socket.end("HTTP/1.1 nonsense\r\n\r\n")
    })
    const error = await client(url)
      .records.get("rec_1")
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConnectionError)
    expect(error).not.toBeInstanceOf(TimeoutError)
    expect((error as ConnectionError).message).toMatch(
      /^The response from 127\.0\.0\.1:\d+ could not be read: /
    )
  })
})
