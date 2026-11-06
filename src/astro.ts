/**
 * Astro's content collections from Nohead (`@nohead/sdk/astro`). In
 * src/content.config.ts:
 *
 *   import { defineCollection } from "astro:content"
 *   import { noheadLoader } from "@nohead/sdk/astro"
 *
 *   export const collections = {
 *     posts: defineCollection({
 *       loader: noheadLoader({ collection: "posts", expand: ["cover"] }),
 *     }),
 *   }
 *
 * Every published record becomes an entry, by its record ID, when the site
 * builds (and when `astro dev` starts or syncs).
 */
import type { Loader, LoaderContext } from "astro/loaders"

import { Nohead } from "./client.ts"
import { environment, type ClientOptions } from "./core.ts"
import { NoheadError } from "./errors.ts"
import type * as G from "./generated/types.gen.ts"
import type { RecordFilter, RecordSort } from "./types.ts"

export interface NoheadLoaderOptions extends ClientOptions {
  /** The collection's slug or ID. */
  collection: string
  /**
   * Filters, added to the default `{ published_at: { exists: true } }`, so
   * only published records load whatever the key may read. Set
   * `published_at` to change that: `undefined` loads every record.
   */
  filter?: RecordFilter
  /** The order of the entries, as `records.list` takes it: `"-date"`. */
  sort?: RecordSort
  /**
   * Asset (or relation) fields whose IDs to replace with what they point
   * at: an asset as an `EmbeddedAsset`, a published record as an
   * `EmbeddedRecord`. At most 5. Relations otherwise stay record IDs, for
   * `reference()`.
   */
  expand?: string[]
  /**
   * A rich text field to render: it moves from `data` into the entry's
   * `rendered`, so `render(entry)` returns its `<Content />`. As HTML (the
   * default), or with `richText: "markdown"`, through Astro's Markdown
   * pipeline (your remark and rehype plugins, syntax highlighting,
   * headings).
   */
  body?: string
  /**
   * How rich text fields read: `"html"` by default, strings ready for
   * `set:html`, or `"markdown"`. The `"document"` form is the API's.
   */
  richText?: G.RichText
}

/** An expanded asset field's value: what a page needs to show the file. */
export interface EmbeddedAsset {
  id: string
  filename: string
  content_type: string
  /** The asset's alt text, when it has some. */
  alt?: string
  /** For images: their size, and their URL (see `@nohead/sdk/images`). */
  width?: number
  height?: number
  image_url?: string
  /** The file as uploaded, for any ready asset. */
  file_url?: string
  /** For video and audio: the URL that plays inline. */
  media_url?: string
}

/** An expanded relation field's value: the related record's ID and fields. */
export interface EmbeddedRecord {
  id: string
  data: Record<string, unknown>
}

/**
 * An Astro content loader for a Nohead collection. It reads the key from
 * `apiKey` or `NOHEAD_API_KEY`, and takes the other client options too
 * (`timeout`, `maxRetries`, `headers`…). Empty fields are left out of an
 * entry's data, so a schema's `.optional()` fits them.
 */
export function noheadLoader(options: NoheadLoaderOptions): Loader {
  const {
    collection,
    filter,
    sort,
    expand,
    body,
    richText = "html",
    ...client
  } = options
  if (!collection) throw new TypeError("noheadLoader needs a collection")
  if (body && richText === "document") {
    throw new TypeError(
      'noheadLoader renders its body from HTML or Markdown: set richText to "html" or "markdown"'
    )
  }

  return {
    name: "nohead",
    async load(context: LoaderContext) {
      const { store, logger } = context
      // Astro reads .env into import.meta.env, not process.env.
      if (!client.apiKey && !environment().NOHEAD_API_KEY) {
        throw new NoheadError(
          "Missing API key: pass `apiKey: import.meta.env.NOHEAD_API_KEY` to noheadLoader, or set NOHEAD_API_KEY in the environment"
        )
      }
      const nohead = new Nohead({ ...client, richText })
      const records = []
      for await (const record of nohead.records.list(collection, {
        limit: 100,
        filter: { published_at: { exists: true }, ...filter },
        sort,
        expand,
      })) {
        records.push(record)
      }
      // Embedded records are published too, unless entries may not be.
      const publishedAt =
        filter && "published_at" in filter
          ? filter.published_at
          : { exists: true }
      const publishedOnly = !(
        publishedAt === undefined || publishedAt.exists === false
      )

      // Every entry is made before the store changes, so a failure leaves
      // the entries as they were.
      const entries = await Promise.all(
        records.map(async (record) => {
          const data = entryData(record, publishedOnly)
          const digest = context.generateDigest(data)
          if (store.get(record.id)?.digest === digest) return undefined
          let rendered
          if (body !== undefined) {
            const value = data[body]
            delete data[body]
            if (typeof value === "string") {
              rendered =
                richText === "markdown"
                  ? await context.renderMarkdown(value)
                  : { html: value }
            }
          }
          const parsed = await context.parseData({ id: record.id, data })
          return { id: record.id, data: parsed, digest, rendered }
        })
      )

      const ids = new Set(records.map((record) => record.id))
      for (const id of store.keys()) if (!ids.has(id)) store.delete(id)
      for (const entry of entries) if (entry) store.set(entry)
      logger.info(`Loaded ${records.length} records from ${collection}`)
    },
  }
}

/**
 * A record's fields as an entry's data: without empty values, and with each
 * expanded asset or relation in place of its ID.
 */
function entryData(
  record: G.Record,
  publishedOnly: boolean
): Record<string, unknown> {
  const data = present(record.data)
  // Gone since, or (as entries are) unpublished: left out.
  const shown = (
    embedded: G.Record | G.Asset | null
  ): embedded is G.Record | G.Asset =>
    embedded !== null &&
    !(publishedOnly && embedded.object === "record" && !embedded.published_at)
  for (const [key, embedded] of Object.entries(record.expanded ?? {})) {
    const value = record.data[key]
    // A rich text field's expansion (the assets its images show) is a list
    // beside a single value: the field keeps its text.
    if (Array.isArray(value) && Array.isArray(embedded)) {
      data[key] = embedded.filter(shown).map(entryValue)
    } else if (typeof value === "string" && !Array.isArray(embedded)) {
      if (shown(embedded)) data[key] = entryValue(embedded)
      else delete data[key]
    }
  }
  return data
}

function entryValue(
  embedded: G.Record | G.Asset
): EmbeddedAsset | EmbeddedRecord {
  if (embedded.object === "record") {
    return { id: embedded.id, data: present(embedded.data) }
  }
  const { id, filename, content_type } = embedded
  return {
    id,
    filename,
    content_type,
    ...present({
      alt: embedded.alt,
      width: embedded.width,
      height: embedded.height,
      image_url: embedded.image_url,
      file_url: embedded.file_url,
      media_url: embedded.media_url,
    }),
  }
}

/** The values that are set: Zod's `.optional()` takes undefined, not null. */
function present(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => value !== null && value !== undefined
    )
  )
}
