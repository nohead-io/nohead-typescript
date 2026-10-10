// The contract (openapi.json) as the tests read it: which operation a request
// is, and an example of any schema, which the mock replies in calls.ts are
// made of.
import { readFileSync } from "node:fs"

import { OPERATIONS } from "../src/generated/operations.gen.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON Schema
type Schema = any

export interface Parameter {
  name: string
  in: string
  schema: Schema
  /** Where `schema` is in the contract. */
  schemaAt: string
}

export const spec = JSON.parse(readFileSync("openapi.json", "utf8"))

/** A JSON pointer into the contract. */
const pointer = (...parts: string[]) =>
  "#/" + parts.map((p) => p.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")

/** The value at a pointer, and where it is, following a `$ref` there. */
function at(path: string): { pointer: string; value: Schema } {
  const value = path
    .slice(2)
    .split("/")
    .reduce(
      (node, part) => node[part.replace(/~1/g, "/").replace(/~0/g, "~")],
      spec
    )
  return value.$ref ? at(value.$ref) : { pointer: path, value }
}

function parameters(owner: Schema, path: string): Parameter[] {
  return (owner.parameters ?? []).map((_: unknown, i: number) => {
    const { pointer, value } = at(`${path}/parameters/${i}`)
    return { ...value, schemaAt: `${pointer}/schema` }
  })
}

/** The JSON body schema of a request or response, by pointer. */
function json(path: string | undefined) {
  if (!path) return undefined
  const schema = `${at(path).pointer}/content/application~1json/schema`
  return { pointer: schema, schema: at(schema).value }
}

export const routes = Object.entries(OPERATIONS).map(
  ([id, { method, path }]) => {
    const item = spec.paths[path]
    const operation = item[method.toLowerCase()]
    const pattern = new RegExp(`^${path.replace(/\{\w+\}/g, "[^/]+")}$`)
    const itemAt = pointer("paths", path)
    const operationAt = pointer("paths", path, method.toLowerCase())
    const query: Parameter[] = [
      ...parameters(item, itemAt),
      ...parameters(operation, operationAt),
    ].filter((p) => p.in === "query")
    const status = Object.keys(operation.responses).find((code) =>
      code.startsWith("2")
    )!
    return {
      id,
      method,
      pattern,
      query,
      /** The request body, if the operation takes one. */
      body: json(operation.requestBody && `${operationAt}/requestBody`),
      bodyRequired: Boolean(operation.requestBody?.required),
      /** The first success status, and its body. */
      status: Number(status),
      response: json(`${operationAt}/responses/${status}`)!,
    }
  }
)

export type Route = (typeof routes)[number]

export function routeOf(method: string, pathname: string): Route {
  const route = routes.find(
    (r) => r.method === method && r.pattern.test(pathname)
  )
  if (!route) throw new Error(`No operation for ${method} ${pathname}`)
  return route
}

/**
 * A value that matches `schema`: its example, constant, first enum value or
 * default, else one built from its type, with every property (the first
 * non-null type, the first of `oneOf` and `anyOf`).
 */
export function example(schema: Schema): unknown {
  if (schema.$ref) return example(at(schema.$ref).value)
  if (schema.examples) return schema.examples[0]
  if ("const" in schema) return schema.const
  if (schema.enum) return schema.enum[0]
  if ("default" in schema) return schema.default
  if (schema.allOf) {
    return Object.assign({}, ...schema.allOf.map(example))
  }
  if (schema.oneOf ?? schema.anyOf)
    return example((schema.oneOf ?? schema.anyOf)[0])
  const types = [schema.type].flat()
  const type = types.find((t) => t !== "null") ?? types[0]
  switch (type) {
    case "object":
      return Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([name, property]) => [
          name,
          example(property),
        ])
      )
    case "array":
      return Array.from({ length: Math.max(schema.minItems ?? 1, 1) }, () =>
        example(schema.items ?? {})
      )
    case "string":
      return schema.format === "date-time"
        ? "2026-10-02T12:00:00Z"
        : schema.format === "date"
          ? "2026-10-02"
          : "string"
    case "integer":
    case "number":
      return schema.minimum ?? 1
    case "boolean":
      return false
    case "null":
      return null
    default:
      return {}
  }
}
