import type { APIPromise, PagePromise } from "../api-promise.ts"
import type { RequestOptions } from "../core.ts"
import { AbortError, UploadError } from "../errors.ts"
import type {
  Asset,
  AssetUpload,
  AssetUploadCreate,
  AssetUsage,
  DownloadUrl,
  ImageUrl,
} from "../generated/types.gen.ts"
import type { AssetListParams, ImageUrlParams } from "../types.ts"
import { Resource } from "./resource.ts"

/** What `assets.upload` accepts. A stream needs `byte_size`. */
export type Uploadable = Blob | ArrayBuffer | Uint8Array | ReadableStream

export interface UploadParams {
  /** Defaults to a `File`'s name, else `upload`. */
  filename?: string
  /** Defaults to the `Blob`'s type, else `application/octet-stream`. */
  content_type?: string
  /** Required for a `ReadableStream`; known for everything else. */
  byte_size?: number
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
   * without sending the bytes again.
   *
   *   import { openAsBlob } from "node:fs"
   *   const asset = await nohead.assets.upload(await openAsBlob("a.jpg"), { filename: "a.jpg" })
   */
  async upload(
    file: Uploadable,
    params: UploadParams = {},
    options?: RequestOptions
  ): Promise<Asset> {
    const byteSize = params.byte_size ?? sizeOf(file)
    if (byteSize === undefined) {
      throw new UploadError("Uploading a stream needs `byte_size`")
    }
    const { asset, upload } = await this.createUpload(
      {
        filename:
          params.filename ??
          (typeof File !== "undefined" && file instanceof File
            ? file.name
            : "upload"),
        content_type:
          params.content_type ??
          ((file instanceof Blob && file.type) || "application/octet-stream"),
        byte_size: byteSize,
      },
      options
    )

    // A replayed start returns the first run's asset, which may be done.
    if (options?.idempotencyKey) {
      const current = await this.get(asset.id, {
        ...options,
        idempotencyKey: undefined,
        changeNote: undefined,
      })
      if (current.status === "ready") return current
    }

    const stream = file instanceof ReadableStream
    const response = await this.core
      .fetchWithRetries(
        upload.url,
        {
          method: upload.method,
          headers: upload.headers,
          body: file as BodyInit,
          ...(stream ? { duplex: "half" } : {}),
        },
        { ...options, retry: !stream }
      )
      .catch((error: unknown) => {
        if (error instanceof AbortError) throw error
        throw new UploadError(
          `Could not upload ${asset.filename}: ${(error as Error).message}`,
          undefined,
          { cause: error }
        )
      })
    if (!response.ok) {
      throw new UploadError(
        `Storage refused the upload of ${asset.filename} (${response.status})`,
        response.status
      )
    }
    // The key belongs to the start: the API refuses one key on two requests.
    return this.complete(asset.id, { ...options, idempotencyKey: undefined })
  }

  /**
   * The first step of an upload: a `pending` asset and a presigned URL to
   * `PUT` the bytes to (for example from a browser). Then `complete` it.
   */
  createUpload(
    params: AssetUploadCreate,
    options?: RequestOptions
  ): APIPromise<AssetUpload> {
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
    params: AssetListParams = {},
    options?: RequestOptions
  ): PagePromise<Asset> {
    return this.core.paginate("assets_list", { query: params }, options)
  }

  get(asset: string, options?: RequestOptions): APIPromise<Asset> {
    return this.core.request(
      "assets_get",
      { path: { asset_id: asset } },
      options
    )
  }

  /**
   * Soft-deletes the asset; the file is purged after 30 days, or now with
   * `purge`.
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
   * Permanently deletes a deleted asset now, instead of 30 days after the
   * delete, and frees its storage. It can't be restored, records that use
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

  /** A signed, cacheable URL of an image rendition (`url`). */
  imageUrl(
    asset: string,
    params: ImageUrlParams = {},
    options?: RequestOptions
  ): APIPromise<ImageUrl> {
    return this.core.request(
      "assets_image_url",
      { path: { asset_id: asset }, query: params },
      options
    )
  }

  /** A 15-minute link to download the original file (`url`). */
  downloadUrl(
    asset: string,
    options?: RequestOptions
  ): APIPromise<DownloadUrl> {
    return this.core.request(
      "assets_download_url",
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
