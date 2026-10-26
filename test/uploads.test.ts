import { describe, expect, it, vi } from "vitest"

import {
  ConnectionError,
  TimeoutError,
  UploadError,
  ValidationError,
  type Uploadable,
} from "../src/index.ts"
import {
  apiError,
  exampleOf,
  json,
  mockClient,
  settle,
  type Call,
} from "./helpers.ts"

const asset = (status: string) =>
  exampleOf("assets_get", { id: "ast_1", filename: "a.png", status })
const createdUntil = (expiresAt: string) =>
  json(201, {
    ...exampleOf("assets_upload", asset("pending")),
    upload: {
      method: "PUT",
      url: "https://storage.test/uploads/prj_1/ast_1?signature=x",
      headers: { "Content-Type": "image/png" },
      expires_at: expiresAt,
    },
  })
const created = createdUntil(new Date(Date.now() + 900_000).toISOString())

/** Three bytes as a stream, which fetch can send only once. */
const bytes = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]))
      controller.close()
    },
  })

// Storage that answers only when the request's signal aborts it.
const hang = (call: Call) =>
  new Promise<Response>((_, reject) =>
    call.signal?.addEventListener("abort", () =>
      reject(call.signal!.reason as Error)
    )
  )

describe("assets.upload", () => {
  it("creates the upload, sends the bytes to storage, then completes it", async () => {
    const { nohead, calls } = mockClient([
      created,
      new Response(null, { status: 200 }),
      json(200, asset("ready")),
    ])
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", {
      type: "image/png",
    })
    const ready = await nohead.assets.upload(file)
    expect(ready.status).toBe("ready")
    expect(
      calls.map((c) => `${c.method} ${c.url.host}${c.url.pathname}`)
    ).toEqual([
      "POST api.test/v1/projects/prj_1/assets",
      "PUT storage.test/uploads/prj_1/ast_1",
      "POST api.test/v1/assets/ast_1/complete",
    ])
    expect(calls[0]!.body).toEqual({
      filename: "a.png",
      content_type: "image/png",
      byte_size: 3,
    })
    const put = calls[1]!
    expect(new Uint8Array(await (put.body as Blob).arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3])
    )
    expect(put.headers.get("content-type")).toBe("image/png")
    expect(put.headers.has("authorization")).toBe(false)
    expect(put.init).not.toHaveProperty("duplex")
  })

  it("sends a stream as it reads it (duplex)", async () => {
    const { nohead, calls } = mockClient([
      created,
      new Response(null),
      json(200, asset("ready")),
    ])
    const ready = await nohead.assets.upload(bytes(), { byte_size: 3 })
    expect(ready.status).toBe("ready")
    expect(calls[0]!.body).toMatchObject({ byte_size: 3 })
    const put = calls[1]!
    expect(put.body).toBeInstanceOf(ReadableStream)
    expect(put.init).toHaveProperty("duplex", "half")
    // The URL is signed for the size, which fetch wouldn't send for a stream.
    expect(put.headers.get("content-length")).toBe("3")
    expect(put.headers.get("content-type")).toBe("image/png")
    expect(calls[2]!.url.pathname).toBe("/v1/assets/ast_1/complete")
  })

  it("uses an idempotency key only to start the upload", async () => {
    const { nohead, calls } = mockClient([
      created,
      json(200, asset("pending")),
      new Response(null),
      json(200, asset("ready")),
    ])
    await nohead.assets.upload(new Blob(["x"]), {}, { idempotencyKey: "k1" })
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      "POST /v1/projects/prj_1/assets",
      "GET /v1/assets/ast_1",
      "PUT /uploads/prj_1/ast_1",
      "POST /v1/assets/ast_1/complete",
    ])
    const keys = calls.map((c) => c.headers.get("idempotency-key"))
    expect(keys[0]).toBe("k1")
    expect(keys[3]).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("returns an asset a replayed upload already finished", async () => {
    const { nohead, calls } = mockClient([created, json(200, asset("ready"))])
    const ready = await nohead.assets.upload(
      new Blob(["x"]),
      {},
      { idempotencyKey: "k1" }
    )
    expect(ready.status).toBe("ready")
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"])
  })

  it("refuses to resume once the upload URL expired", async () => {
    const { nohead, calls } = mockClient([
      createdUntil("2026-10-02T13:00:00.000Z"),
      json(200, asset("pending")),
    ])
    await expect(
      nohead.assets.upload(new Blob(["x"]), {}, { idempotencyKey: "k1" })
    ).rejects.toThrow(/new idempotencyKey/)
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"])
  })

  it("names bytes without a file name", async () => {
    const { nohead, calls } = mockClient([
      created,
      new Response(null),
      json(200, asset("ready")),
    ])
    await nohead.assets.upload(new Uint8Array(10), { filename: "data.bin" })
    expect(calls[0]!.body).toEqual({
      filename: "data.bin",
      content_type: "application/octet-stream",
      byte_size: 10,
    })
  })

  it("takes an empty filename and content type as unset", async () => {
    const { nohead, calls } = mockClient([
      created,
      new Response(null),
      json(200, asset("ready")),
      created,
      new Response(null),
      json(200, asset("ready")),
    ])
    await nohead.assets.upload(new Blob(["x"]), {
      filename: "",
      content_type: "",
    })
    const file = new File(["x"], "a.png", { type: "image/png" })
    await nohead.assets.upload(file, { filename: "", content_type: "" })
    expect(calls[0]!.body).toMatchObject({
      filename: "upload",
      content_type: "application/octet-stream",
    })
    expect(calls[3]!.body).toMatchObject({
      filename: "a.png",
      content_type: "image/png",
    })
  })

  it("refuses a string, which is never a file's path or content", async () => {
    const { nohead, calls } = mockClient([created])
    await expect(
      nohead.assets.upload("a.png" as unknown as Uploadable)
    ).rejects.toThrow(
      new TypeError(
        "upload takes a Blob, File, ArrayBuffer, Uint8Array or ReadableStream; to upload a file from disk, pass await fs.openAsBlob(path)"
      )
    )
    expect(calls).toHaveLength(0)
  })

  it("gives the bytes as long as they take at 64 KiB/s", async () => {
    vi.useFakeTimers()
    try {
      const { nohead } = mockClient([created, hang], {
        timeout: 10,
        maxRetries: 0,
      })
      let error: unknown
      // 10 s at 64 KiB/s.
      void nohead.assets
        .upload(new Uint8Array(655_360))
        .catch((e: unknown) => (error = e))
      await vi.advanceTimersByTimeAsync(9_999)
      expect(error).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      expect(error).toBeInstanceOf(UploadError)
      expect((error as UploadError).message).toBe(
        "Could not upload upload: The request timed out after 10000 ms"
      )
      expect((error as UploadError).cause).toBeInstanceOf(TimeoutError)
    } finally {
      vi.useRealTimers()
    }
  })

  it("refuses storage's redirect", async () => {
    const { nohead, calls } = mockClient([
      created,
      new Response(null, {
        status: 307,
        headers: { location: "https://elsewhere.test/" },
      }),
    ])
    const error = await nohead.assets
      .upload(new Blob(["x"]))
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UploadError)
    expect((error as UploadError).message).toBe(
      "Storage refused the upload of upload (307)"
    )
    expect(calls).toHaveLength(2)
    expect(calls[1]!.init.redirect).toBe("manual")
  })

  it("types a Blob without a type by its filename", async () => {
    const { nohead, calls } = mockClient([
      created,
      new Response(null),
      json(200, asset("ready")),
    ])
    // As Node's openAsBlob makes one: no type.
    await nohead.assets.upload(new Blob(["x"]), { filename: "Cover.JPG" })
    expect(calls[0]!.body).toMatchObject({ content_type: "image/jpeg" })
  })

  it("needs byte_size for a stream", async () => {
    const { nohead } = mockClient([created])
    await expect(
      nohead.assets.upload(new ReadableStream())
    ).rejects.toBeInstanceOf(UploadError)
  })

  it("retries the bytes on a server error", async () => {
    vi.useFakeTimers()
    try {
      const { nohead, calls } = mockClient([
        created,
        new Response(null, { status: 503 }),
        new Response(null),
        json(200, asset("ready")),
      ])
      await settle(nohead.assets.upload(new Blob(["x"])))
      expect(calls.map((c) => `${c.method} ${c.url.host}`)).toEqual([
        "POST api.test",
        "PUT storage.test",
        "PUT storage.test",
        "POST api.test",
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it("doesn't send a stream twice, which it can't replay", async () => {
    vi.useFakeTimers()
    try {
      const { nohead, calls } = mockClient([
        created,
        new Response(null, { status: 503 }),
        new Response(null),
        json(200, asset("ready")),
      ])
      const error = await settle(
        nohead.assets.upload(bytes(), { byte_size: 3 })
      ).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(UploadError)
      expect((error as UploadError).status).toBe(503)
      expect(calls.map((c) => `${c.method} ${c.url.host}`)).toEqual([
        "POST api.test",
        "PUT storage.test",
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it("doesn't send a stream again after a connection failure", async () => {
    const { nohead, calls } = mockClient([
      created,
      new TypeError("fetch failed"),
      new Response(null),
    ])
    const error = await nohead.assets
      .upload(bytes(), { byte_size: 3 })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UploadError)
    expect((error as UploadError).message).toBe(
      "Could not upload upload: Could not reach storage.test: fetch failed"
    )
    expect((error as UploadError).status).toBeUndefined()
    expect((error as UploadError).cause).toBeInstanceOf(ConnectionError)
    expect(calls).toHaveLength(2)
  })

  it("throws UploadError with the status when storage fails every attempt", async () => {
    vi.useFakeTimers()
    try {
      const { nohead, calls } = mockClient([
        created,
        new Response(null, { status: 503 }),
      ])
      const error = await settle(nohead.assets.upload(new Blob(["x"]))).catch(
        (e: unknown) => e
      )
      expect(error).toBeInstanceOf(UploadError)
      expect((error as UploadError).status).toBe(503)
      // The first attempt and the client's two retries.
      expect(calls.filter((c) => c.method === "PUT")).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it("throws UploadError when storage refuses the bytes", async () => {
    const { nohead } = mockClient([
      created,
      new Response("denied", { status: 403 }),
    ])
    // Named as the caller named it, not as the API stored it.
    const error = await nohead.assets
      .upload(new Blob(["x"]), { filename: "cover.png" })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UploadError)
    expect((error as UploadError).message).toBe(
      "Storage refused the upload of cover.png (403)"
    )
    expect((error as UploadError).status).toBe(403)
  })

  it("throws ValidationError when the file fails the checks", async () => {
    const { nohead } = mockClient(
      [created, new Response(null), apiError(422, "validation_error")],
      { maxRetries: 0 }
    )
    await expect(nohead.assets.upload(new Blob(["x"]))).rejects.toBeInstanceOf(
      ValidationError
    )
  })
})
