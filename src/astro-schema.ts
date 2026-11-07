// A collection's fields as the Zod schema and TypeScript type of the
// entries noheadLoader makes from its records (Astro's `createSchema`).
// Internal to @nohead/sdk/astro.
import type * as Zod from "astro/zod"

import type * as G from "./generated/types.gen.ts"
import type { RichText } from "./types.ts"

type Z = typeof Zod.z
type Schema = Zod.ZodType

export interface SchemaOptions {
  /** Fields whose IDs the loader replaces with what they point at. */
  expand: string[]
  /** The rich text field that moves to `rendered`, out of the data. */
  body: string | undefined
  richText: RichText
  /** Collection slugs by ID, for relations' targets. */
  slugs: Map<string, string>
  /** Whether entries are published records only: then each has `published_at`. */
  publishedOnly: boolean
}

/** The schema and the `Entry` type (a module, as Astro writes it) of the data. */
export function collectionSchema(
  z: Z,
  collection: G.Collection,
  options: SchemaOptions
): { schema: Schema; types: string } {
  const shape: Record<string, Schema> = {}
  const lines: string[] = []
  for (const field of collection.fields) {
    if (field.key === options.body) continue
    const { schema, type, optional } = fieldSchema(z, field, options)
    shape[field.key] = optional ? schema.optional() : schema
    const description = field.configuration.description
    const doc = `${field.name}${description ? `: ${description}` : ""}`
    lines.push(
      `  /** ${doc.replaceAll("*/", "*\\/")} */`,
      `  ${JSON.stringify(field.key)}${optional ? "?" : ""}: ${type}`
    )
  }
  // The record's own times, beside its fields (under keys Nohead reserves).
  const times = [
    [
      "published_at",
      "When it was published (publishing again moves it)",
      !options.publishedOnly,
    ],
    ["created_at", "When it was created", false],
    ["updated_at", "When it last changed", false],
  ] as const
  for (const [key, doc, optional] of times) {
    shape[key] = optional ? z.coerce.date().optional() : z.coerce.date()
    lines.push(`  /** ${doc} */`, `  ${key}${optional ? "?" : ""}: Date`)
  }
  const body = lines.join("\n")
  const used = ["EmbeddedAsset", "EmbeddedRecord"].filter((name) =>
    body.includes(name)
  )
  const types = [
    `// The data of the ${collection.slug} collection's entries, from its fields in Nohead (@nohead/sdk/astro).`,
    ...(used.length
      ? [`import type { ${used.join(", ")} } from "@nohead/sdk/astro"`]
      : []),
    ``,
    `export type Entry = {`,
    ...lines,
    `}`,
    ``,
  ].join("\n")
  return { schema: z.object(shape), types }
}

function fieldSchema(
  z: Z,
  field: G.Field,
  { expand, richText, slugs }: SchemaOptions
): { schema: Schema; type: string; optional: boolean } {
  const expanded = expand.includes(field.key)
  let one: { schema: Schema; type: string }
  switch (field.type) {
    case "text":
    case "long_text":
      one = { schema: z.string(), type: "string" }
      break
    case "rich_text":
      one =
        richText === "document"
          ? {
              schema: z.record(z.string(), z.unknown()),
              type: "Record<string, unknown>",
            }
          : { schema: z.string(), type: "string" }
      break
    case "integer":
      one = { schema: z.number().int(), type: "number" }
      break
    case "decimal":
      one = { schema: z.number(), type: "number" }
      break
    case "date":
      one = { schema: z.coerce.date(), type: "Date" }
      break
    case "boolean":
      // No value reads as false: it is never required.
      return {
        schema: z.boolean().default(false),
        type: "boolean",
        optional: false,
      }
    case "enum": {
      const options = field.configuration.options
      one = {
        schema: z.enum(options as [string, ...string[]]),
        type: options.map((option) => JSON.stringify(option)).join(" | "),
      }
      break
    }
    case "asset":
      one = expanded
        ? { schema: embeddedAsset(z), type: "EmbeddedAsset" }
        : { schema: z.string(), type: "string" }
      break
    case "relation": {
      const target = slugs.get(field.configuration.target_collection_id)
      one = expanded
        ? { schema: embeddedRecord(z), type: "EmbeddedRecord" }
        : target
          ? {
              schema: reference(z, target),
              type: `{ collection: ${JSON.stringify(target)}; id: string }`,
            }
          : { schema: z.string(), type: "string" }
      break
    }
    default:
      one = { schema: z.unknown(), type: "unknown" }
  }
  if (field.multiple) {
    const type = /[|{]/.test(one.type) ? `(${one.type})[]` : `${one.type}[]`
    return { schema: z.array(one.schema), type, optional: !field.required }
  }
  // An expanded asset or record deleted since (or unpublished) is left
  // out, so it may be missing even when the field is required.
  const optional =
    !field.required ||
    (expanded && (field.type === "asset" || field.type === "relation"))
  return { ...one, optional }
}

/**
 * What Astro's `reference(collection)` makes of a record ID: a lookup for
 * `getEntry`. Built here, since `astro:content` is Astro's virtual module.
 */
function reference(z: Z, collection: string): Schema {
  return z.union([
    z.string().transform((id) => ({ id, collection })),
    z.object({ id: z.string(), collection: z.literal(collection) }),
  ])
}

function embeddedAsset(z: Z): Schema {
  return z.object({
    id: z.string(),
    filename: z.string(),
    content_type: z.string(),
    alt: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    image_url: z.string().optional(),
    file_url: z.string().optional(),
    media_url: z.string().optional(),
  })
}

function embeddedRecord(z: Z): Schema {
  return z.object({ id: z.string(), data: z.record(z.string(), z.unknown()) })
}
