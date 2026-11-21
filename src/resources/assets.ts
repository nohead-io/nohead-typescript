import type { APIPromise, PagePromise } from "../api-promise.ts"
import type { RequestOptions } from "../core.ts"
import { AbortError, UploadError } from "../errors.ts"
import type {
  Asset,
  AssetUpdate,
  AssetUploadCreate,
  AssetWithUpload,
  AssetUsage,
} from "../generated/types.gen.ts"
import type { AssetListParams } from "../types.ts"
import { listQuery, Resource } from "./resource.ts"

/** What `assets.upload` accepts. A stream needs `byte_size`. */
export type Uploadable = Blob | ArrayBuffer | Uint8Array | ReadableStream

export interface UploadParams {
  /** Defaults to a `File`'s name, else `upload`. */
  filename?: string
  /**
   * Defaults to the `Blob`'s type; without one, the API types the file by
   * its filename's extension.
   */
  content_type?: string
  /**
   * Required for a `ReadableStream`; known for everything else. Only the
   * first `byte_size` bytes are sent, and a file with fewer throws
   * `UploadError`.
   */
  byte_size?: number
  /** Alt text, set from the start (as `update` would set it later). */
  alt?: string | null
}

/** Files of the key's project. `asset` is an asset ID (`ast_…`). */
export class Assets extends Resource {
  /**
   * Uploads a file and returns the `ready` asset: creates the upload, sends
   * the bytes straight to storage, then completes it (which checks the
   * file). Throws `UploadError` if storage refuses the bytes, and
   * `ValidationError` if the file fails the checks.
   *
   * With an `idempotencyKey`, running the same upload again resumes it: the
   * key starts the upload, and an asset that is already `ready` is returned
   * without sending the bytes again. Once the upload's URL has expired
   * (`upload.expires_at`), it throws `UploadError`: start over with a new key.
   *
   *   import { openAsBlob } from "node:fs"
   *   const asset = await nohead.assets.upload(await openAsBlob("a.jpg"), { filename: "a.jpg", alt: "A harbour at dawn" })
   *
   * Without `content_type`, the type is the Blob's, or else the API types
   * the file by its filename's extension, as for every client.
   */
  async upload(
    file: Uploadable,
    params: UploadParams = {},
    options?: RequestOptions
  ): Promise<Asset> {
    // Never a path: the Python and Ruby SDKs take one, so it would be easy
    // to send its text instead.
    if (typeof file === "string") {
      throw new TypeError(
        "upload takes a Blob, File, ArrayBuffer, Uint8Array or ReadableStream; to upload a file from disk, pass await fs.openAsBlob(path)"
      )
    }
    const size = sizeOf(file)
    const byteSize = params.byte_size ?? size
    if (byteSize === undefined) {
      throw new UploadError("Uploading a stream needs `byte_size`")
    }
    // Empty ones count as unset.
    const filename =
      params.filename ||
      (typeof File !== "undefined" && file instanceof File && file.name) ||
      "upload"
    const tooShort = (sent: number) =>
      new UploadError(
        `Could not upload ${filename}: it has ${sent} bytes, fewer than its byte_size (${byteSize})`
      )
    // A file known to be shorter fails before the upload starts.
    if (size !== undefined && size < byteSize) throw tooShort(size)
    // The type given, or the Blob's own; without one (a Blob from Node's
    // openAsBlob has none, nor do bytes), the API types the file by its
    // filename, the same for every client.
    const contentType =
      params.content_type || (file instanceof Blob ? file.type : "")
    const { upload, ...asset } = await this.createUpload(
      {
        filename,
        ...(contentType && { content_type: contentType }),
        byte_size: byteSize,
        ...(params.alt !== undefined && { alt: params.alt }),
      },
      options
    )

    // A replayed start returns the first run's asset, which may be done.
    if (options?.idempotencyKey) {
      const current = await this.get(asset.id, {
        ...options,
        idempotencyKey: undefined,
      })
      if (current.status === "ready") return current
      // The key replays the first run's upload URL, which expires sooner.
      if (Date.parse(upload.expires_at) <= Date.now()) {
        throw new UploadError(
          `The upload of ${filename} expired: start it again with a new idempotencyKey`
        )
      }
    }

    // The URL is signed for byte_size bytes: send those, and no more.
    let short: UploadError | undefined
    const body =
      file instanceof ReadableStream
        ? firstBytes(file as ReadableStream<Uint8Array>, byteSize, (sent) => {
            short = tooShort(sent)
            return short
          })
        : firstBytesOf(file, byteSize)
    const stream = body instanceof ReadableStream
    const response = await this.core
      .fetchWithRetries(
        upload.url,
        {
          method: upload.method,
          // The URL is signed for this size; fetch would send a stream
          // in chunks, without one.
          headers: stream
            ? { ...upload.headers, "Content-Length": String(byteSize) }
            : upload.headers,
          body,
          ...(stream ? { duplex: "half" } : {}),
        },
        { ...options, retry: !stream, byteSize }
      )
      .catch((error: unknown) => {
        if (error instanceof AbortError) throw error
        // A stream that ended too soon failed the request: say so, rather
        // than fetch's error for the bytes it was missing.
        if (short) throw short
        throw new UploadError(
          `Could not upload ${filename}: ${(error as Error).message}`,
          undefined,
          { cause: error }
        )
      })
    if (!response.ok) {
      throw new UploadError(
        `Storage refused the upload of ${filename} (${response.status})`,
        response.status
      )
    }
    // The key belongs to the start: the API refuses one key on two requests.
    return this.complete(asset.id, { ...options, idempotencyKey: undefined })
  }

  /**
   * The first step of an upload: a `pending` asset with its `upload`, a
   * presigned URL to `PUT` the bytes to (for example from a browser). Then
   * `complete` it.
   */
  createUpload(
    params: AssetUploadCreate,
    options?: RequestOptions
  ): APIPromise<AssetWithUpload> {
    return this.core.request("assets_upload", { body: params }, options)
  }

  /** Checks an uploaded file and marks the asset `ready`. */
  complete(asset: string, options?: RequestOptions): APIPromise<Asset> {
    return this.core.request(
      "assets_complete",
      { path: { asset_id: asset } },
      options
    )
  }

  list(
    { content_type, kind, ...params }: AssetListParams = {},
    options?: RequestOptions
  ): PagePromise<Asset> {
    return this.core.paginate(
      "assets_list",
      {
        query: listQuery(
          {
            ...params,
            content_type: Array.isArray(content_type)
              ? { in: content_type }
              : content_type,
            kind: Array.isArray(kind) ? { in: kind } : kind,
          },
          ["deleted", "content_type", "kind"]
        ),
      },
      options
    )
  }

  get(asset: string, options?: RequestOptions): APIPromise<Asset> {
    return this.core.request(
      "assets_get",
      { path: { asset_id: asset } },
      options
    )
  }

  /**
   * Renames the asset (`filename`) or sets its `alt` text (`null` or `""`
   * clears it). The file itself can't change: upload a new asset for that.
   * `alt` is the default wherever the asset is used. A deleted asset is a
   * `ConflictError`: restore it first.
   */
  update(
    asset: string,
    params: AssetUpdate,
    options?: RequestOptions
  ): APIPromise<Asset> {
    return this.core.request(
      "assets_update",
      { path: { asset_id: asset }, body: params },
      options
    )
  }

  /**
   * Soft-deletes the asset: `restore` brings it back until its
   * `purge_after`, when the file is purged (or now, with `purge`).
   */
  delete(asset: string, options?: RequestOptions): APIPromise<Asset> {
    return this.core.request(
      "assets_delete",
      { path: { asset_id: asset } },
      options
    )
  }

  restore(asset: string, options?: RequestOptions): APIPromise<Asset> {
    return this.core.request(
      "assets_restore",
      { path: { asset_id: asset } },
      options
    )
  }

  /**
   * Permanently deletes a deleted asset now, instead of at its
   * `purge_after`, and frees its storage. It can't be restored, records that use
   * it keep an ID that no longer resolves, and its image URLs stop working
   * within a minute or so. Returns the asset as it was. An asset that isn't
   * deleted is a `ConflictError`: delete it first.
   */
  purge(asset: string, options?: RequestOptions): APIPromise<Asset> {
    return this.core.request(
      "assets_purge",
      { path: { asset_id: asset } },
      options
    )
  }

  /**
   * Where the asset is used: how many undeleted records use it (`records`),
   * how many of those are published (`published`), and the 10 most recently
   * updated with the fields that use it (`uses`). Needs `records:read` too.
   */
  usage(asset: string, options?: RequestOptions): APIPromise<AssetUsage> {
    return this.core.request(
      "assets_usage",
      { path: { asset_id: asset } },
      options
    )
  }
}

function sizeOf(file: Uploadable): number | undefined {
  if (file instanceof Blob) return file.size
  if (file instanceof ArrayBuffer || ArrayBuffer.isView(file)) {
    return file.byteLength
  }
  return undefined
}

function firstBytesOf(
  file: Exclude<Uploadable, ReadableStream>,
  byteSize: number
): BodyInit {
  // Typed as the Blob is, which fetch sends when storage's headers don't.
  if (file instanceof Blob) return file.slice(0, byteSize, file.type)
  if (ArrayBuffer.isView(file)) {
    return new Uint8Array(file.buffer as ArrayBuffer, file.byteOffset, byteSize)
  }
  // An ArrayBuffer, from this realm or another (`instanceof` fails then).
  return new Uint8Array(file, 0, byteSize)
}

/**
 * The first `byteSize` bytes of `source`, which is then cancelled; when it
 * ends sooner, the stream errors with `tooShort`'s error.
 */
function firstBytes(
  source: ReadableStream<Uint8Array>,
  byteSize: number,
  tooShort: (sent: number) => UploadError
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  let sent = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent < byteSize) {
        const { done, value } = await reader.read()
        if (done) {
          controller.error(tooShort(sent))
          return
        }
        const chunk = value.subarray(0, byteSize - sent)
        sent += chunk.byteLength
        controller.enqueue(chunk)
      }
      if (sent === byteSize) {
        controller.close()
        reader.cancel().catch(() => undefined)
      }
    },
    cancel: (reason) => reader.cancel(reason),
  })
}
