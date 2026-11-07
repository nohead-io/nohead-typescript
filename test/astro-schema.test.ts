import type { z } from "astro/zod"
import { describe, expect, it } from "vitest"

import { noheadLoader, type NoheadLoaderOptions } from "../src/astro.ts"
import {
  API_HOST,
  apiError,
  exampleOf,
  json,
  mockFetch,
  page,
} from "./helpers.ts"

const IDS = {
  people: "col_people",
  categories: "col_categories",
  posts: "col_posts",
}

let position = 0
const field = (
  key: string,
  type: string,
  configuration: Record<string, unknown> = {},
  flags: { required?: boolean; multiple?: boolean } = {}
) => ({
  id: `fld_${key}`,
  object: "field",
  collection_id: IDS.posts,
  name: key[0]!.toUpperCase() + key.slice(1),
  key,
  type,
  configuration,
  required: flags.required ?? false,
  multiple: flags.multiple ?? false,
  position: position++,
  deleted_at: null,
  purge_after: null,
  aliases: [],
  created_at: "2026-10-02T12:00:00.000Z",
  updated_at: "2026-10-02T12:00:00.000Z",
})

const required = { required: true }
// The starter's posts (nohead.schema.yaml), with a few more types.
const posts = exampleOf("collections_get", {
  id: IDS.posts,
  slug: "posts",
  fields: [
    field("title", "text", { max_length: 120 }, required),
    field(
      "slug",
      "text",
      {
        format: "slug",
        description: "The address of the post, /posts/<slug>.",
      },
      required
    ),
    field("date", "date", {}, required),
    field(
      "category",
      "relation",
      { target_collection_id: IDS.categories },
      required
    ),
    field(
      "authors",
      "relation",
      { target_collection_id: IDS.people },
      { required: true, multiple: true }
    ),
    field("summary", "long_text", {}, required),
    field("cover", "asset", { accepted_types: ["image/*"] }),
    field("gallery", "asset", {}, { multiple: true }),
    field("body", "rich_text", {}, required),
    field("notes", "rich_text"),
    field("tags", "text", {}, { multiple: true }),
    field("featured", "boolean"),
    field("status", "enum", { options: ["draft", "live"] }, required),
    field("year", "integer"),
    field("price", "decimal"),
    field("extra", "json"),
  ],
})
const collections = page(
  Object.entries(IDS).map(([slug, id]) =>
    exampleOf("collections_get", { id, slug, fields: [] })
  ),
  null
)

/** createSchema against the mocked API: the collection, then the project's. */
async function schemaOf(
  options: Partial<NoheadLoaderOptions> = {},
  reply = json(200, posts)
) {
  const { fetch, calls } = mockFetch([
    (call) =>
      call.url.pathname.endsWith("/collections") ? collections : reply,
  ])
  const loader = noheadLoader({
    collection: "posts",
    apiKey: "nohead_sk_test",
    baseUrl: `https://${API_HOST}`,
    projectId: "prj_1",
    fetch,
    expand: ["cover", "gallery"],
    body: "body",
    ...options,
  })
  if (!("createSchema" in loader) || !loader.createSchema)
    throw new Error("No createSchema")
  const result = await loader.createSchema()
  return { ...result, schema: result.schema as z.ZodType, calls }
}

const cover = {
  id: "ast_1",
  filename: "a.jpg",
  content_type: "image/jpeg",
  alt: "A chalkboard",
  width: 1200,
  height: 800,
  image_url: "https://images.nohead.io/plain/a",
}
const entry = {
  title: "One",
  slug: "one",
  date: "2026-10-01",
  category: "rec_c",
  authors: ["rec_a", "rec_b"],
  summary: "First",
  cover,
  gallery: [cover],
  notes: "<p>Notes</p>",
  tags: ["studio"],
  status: "live",
  year: 2026,
  price: 9.5,
  extra: { any: ["thing"] },
  // The record's own times, beside its fields.
  published_at: "2026-10-02T12:00:00.000Z",
  created_at: "2026-10-01T09:00:00.000Z",
  updated_at: "2026-10-03T15:30:00.000Z",
}
/** The times as the schema makes them: Dates. */
const TIMES = {
  published_at: new Date("2026-10-02T12:00:00.000Z"),
  created_at: new Date("2026-10-01T09:00:00.000Z"),
  updated_at: new Date("2026-10-03T15:30:00.000Z"),
}

describe("noheadLoader's schema", () => {
  it("reads the collection and the project's collections", async () => {
    const { calls } = await schemaOf()
    expect(calls.map((call) => call.url.pathname).sort()).toEqual([
      "/v1/collections/posts",
      "/v1/projects/prj_1/collections",
    ])
  })

  it("parses an entry's data: references, dates, embedded assets, defaults", async () => {
    const { schema } = await schemaOf()
    expect(schema.parse(entry)).toEqual({
      ...entry,
      ...TIMES,
      date: new Date("2026-10-01"),
      category: { id: "rec_c", collection: "categories" },
      authors: [
        { id: "rec_a", collection: "people" },
        { id: "rec_b", collection: "people" },
      ],
      featured: false,
    })
    // Optional fields may be missing; so may an expanded asset, deleted since.
    const rest: Record<string, unknown> = { ...entry }
    for (const key of [
      "cover",
      "gallery",
      "notes",
      "tags",
      "year",
      "price",
      "extra",
    ]) {
      delete rest[key]
    }
    expect(() => schema.parse(rest)).not.toThrow()
  })

  it("refuses what the fields don't allow", async () => {
    const { schema } = await schemaOf()
    for (const bad of [
      { title: undefined },
      { authors: undefined },
      { status: "archived" },
      { year: 2026.5 },
      { cover: "ast_1" },
      { tags: "studio" },
    ]) {
      expect(() => schema.parse({ ...entry, ...bad })).toThrow()
    }
  })

  it("leaves the body out, and keeps unexpanded assets and relations as IDs", async () => {
    const { schema } = await schemaOf({ expand: ["category"], body: undefined })
    const parsed = schema.parse({
      ...entry,
      body: "<p>Body</p>",
      cover: "ast_1",
      gallery: ["ast_2"],
      category: { id: "rec_c", data: { name: "Studio" } },
    }) as Record<string, unknown>
    expect(parsed).toMatchObject({
      body: "<p>Body</p>",
      cover: "ast_1",
      gallery: ["ast_2"],
      category: { id: "rec_c", data: { name: "Studio" } },
    })
    const withBody = await schemaOf()
    expect(withBody.schema.parse({ ...entry, body: "x" })).not.toHaveProperty(
      "body"
    )
  })

  it("writes the entries' type", async () => {
    const { types } = await schemaOf()
    expect(types).toContain(
      'import type { EmbeddedAsset } from "@nohead/sdk/astro"'
    )
    for (const line of [
      '  "title": string',
      "  /** Slug: The address of the post, /posts/<slug>. */",
      '  "date": Date',
      '  "category": { collection: "categories"; id: string }',
      '  "authors": ({ collection: "people"; id: string })[]',
      '  "cover"?: EmbeddedAsset',
      '  "gallery"?: EmbeddedAsset[]',
      '  "notes"?: string',
      '  "tags"?: string[]',
      '  "featured": boolean',
      '  "status": "draft" | "live"',
      '  "year"?: number',
      '  "extra"?: unknown',
    ]) {
      expect(types).toContain(line)
    }
    expect(types).not.toContain('"body"')
    expect(types).toMatch(/export type Entry = \{/)
  })

  it("types documents, expanded relations, and relations to a collection it can't find", async () => {
    const odd = exampleOf("collections_get", {
      id: IDS.posts,
      slug: "posts",
      fields: [
        field("notes", "rich_text"),
        field(
          "category",
          "relation",
          { target_collection_id: IDS.categories },
          required
        ),
        field("elsewhere", "relation", { target_collection_id: "col_gone" }),
      ],
    })
    const { schema, types } = await schemaOf(
      { expand: ["category"], body: undefined, richText: "document" },
      json(200, odd)
    )
    expect(types).toContain('  "notes"?: Record<string, unknown>')
    expect(types).toContain('  "category"?: EmbeddedRecord')
    expect(types).toContain('  "elsewhere"?: string')
    expect(types).toContain(
      'import type { EmbeddedRecord } from "@nohead/sdk/astro"'
    )
    const times = {
      published_at: entry.published_at,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
    }
    expect(
      schema.parse({
        notes: { type: "doc", content: [] },
        category: { id: "rec_c", data: { name: "Studio" } },
        elsewhere: "rec_x",
        ...times,
      })
    ).toEqual({
      notes: { type: "doc", content: [] },
      category: { id: "rec_c", data: { name: "Studio" } },
      elsewhere: "rec_x",
      ...TIMES,
    })
  })

  it("types the record's times, published_at only for published entries", async () => {
    const { schema, types } = await schemaOf()
    expect(types).toContain("  published_at: Date")
    expect(types).toContain("  created_at: Date")
    expect(types).toContain("  updated_at: Date")
    const unpublished: Record<string, unknown> = { ...entry }
    delete unpublished.published_at
    expect(() => schema.parse(unpublished)).toThrow()

    const all = await schemaOf({ filter: { published_at: undefined } })
    expect(all.types).toContain("  published_at?: Date")
    expect(all.schema.parse(unpublished)).not.toHaveProperty("published_at")
  })

  it("says which scope it needs when the key can't read the schema", async () => {
    await expect(
      schemaOf({}, apiError(403, "authorization_error"))
    ).rejects.toThrow(
      "noheadLoader reads the posts collection's fields for its schema, which takes the key's schema:read scope: add it, or pass a schema to defineCollection"
    )
  })
})
