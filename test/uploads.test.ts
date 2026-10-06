import { describe, expect, it } from "vitest"

import { UploadError, ValidationError } from "../src/index.ts"
import { apiError, json, mockClient } from "./helpers.ts"

const asset = (status: string) => ({
  id: "ast_1",
  object: "asset",
  filename: "a.png",
  status,
})
const created = json(201, {
  object: "asset_upload",
  asset: asset("pending"),
  upload: {
    method: "PUT",
    url: "https://storage.test/uploads/prj_1/ast_1?signature=x",
    headers: { "Content-Type": "image/png" },
    expires_at: "2026-10-02T13:00:00.000Z",
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
      "POST api.test/v1/projects/prj_1/assets/uploads",
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
      "POST /v1/projects/prj_1/assets/uploads",
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

  it("needs byte_size for a stream", async () => {
    const { nohead } = mockClient([created])
    await expect(
      nohead.assets.upload(new ReadableStream())
    ).rejects.toBeInstanceOf(UploadError)
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
