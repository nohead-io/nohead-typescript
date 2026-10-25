import { describe, expect, it, vi } from "vitest"

import { ConnectionError, UploadError, ValidationError } from "../src/index.ts"
import { apiError, exampleOf, json, mockClient, settle } from "./helpers.ts"

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
    const error = await nohead.assets
      .upload(new Blob(["x"]))
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UploadError)
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
