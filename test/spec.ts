// The contract (openapi.json) as the tests read it: which operation a request
// is, and an example of any schema, which the mock replies in calls.ts are
// made of.
import { readFileSync } from "node:fs"

import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js"

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

/** Headers sent from request options (`ifMatch`, `changeNote`). */
export const OPTION_HEADERS = ["If-Match", "Nohead-Change-Note"]

export const routes = Object.entries(OPERATIONS).map(
  ([id, { method, path }]) => {
    const item = spec.paths[path]
    const operation = item[method.toLowerCase()]
    const pattern = new RegExp(`^${path.replace(/\{\w+\}/g, "[^/]+")}$`)
    const itemAt = pointer("paths", path)
    const operationAt = pointer("paths", path, method.toLowerCase())
    const declared = [
      ...parameters(item, itemAt),
      ...parameters(operation, operationAt),
    ]
    const query = declared.filter((p) => p.in === "query")
    const status = Object.keys(operation.responses).find((code) =>
      code.startsWith("2")
    )!
    return {
      id,
      method,
      pattern,
      query,
      /** The headers the SDK sends from options that the operation declares. */
      headers: declared
        .filter((p) => p.in === "header" && OPTION_HEADERS.includes(p.name))
        .map((p) => p.name)
        .sort(),
      /** The request body, if the operation takes one. */
      body: json(operation.requestBody && `${operationAt}/requestBody`),
      bodyRequired: Boolean(operation.requestBody?.required),
      /** The first success status, and its body. */
      status: Number(status),
      response: json(`${operationAt}/responses/${status}`)!,
      /** Where the operation's responses are, by status. */
      responsesAt: `${operationAt}/responses`,
      statuses: Object.keys(operation.responses).map(Number),
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

const ajv = new Ajv2020({ strict: false, validateFormats: false })
ajv.addSchema(spec, "openapi.json")

/** The errors of `value` against the schema at `pointer` in the contract. */
export function errors(pointer: string, value: unknown) {
  const validate = ajv.getSchema(`openapi.json${pointer}`)!
  return validate(value) ? [] : validate.errors!
}

/**
 * A request's query parameters by name, as their schemas read them:
 * `filter[a][b]=v` nests, and numbers and booleans are parsed when declared.
 */
export function queryValues(url: URL, params: Parameter[]) {
  const values: Record<string, unknown> = {}
  for (const [key, value] of url.searchParams) {
    const [name, ...path] = key.split(/[[\]]+/).filter(Boolean) as [string]
    if (path.length > 0) {
      let node = (values[name] ??= {}) as Record<string, unknown>
      for (const part of path.slice(0, -1)) {
        node = (node[part] ??= {}) as Record<string, unknown>
      }
      node[path.at(-1)!] = value
      continue
    }
    const type = params.find((p) => p.name === name)?.schema.type
    values[name] =
      (type === "integer" || type === "number") && /^-?\d+(\.\d+)?$/.test(value)
        ? Number(value)
        : type === "boolean" && (value === "true" || value === "false")
          ? value === "true"
          : value
  }
  return values
}

/** A request's query parameter names, without their `[…]` keys. */
export const queryNames = (url: URL) => [
  ...new Set([...url.searchParams.keys()].map((k) => k.replace(/\[.*$/, ""))),
]

const explain = (where: string, found: ErrorObject[]) =>
  found.map(
    (e) => `${where}${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`
  )

/**
 * How a request breaks the contract: no operation for its method and path,
 * a query parameter its operation doesn't declare or a value that doesn't
 * match, or a JSON body that doesn't match (or is missing).
 */
export function requestProblems(request: {
  method: string
  url: URL
  body: unknown
}): string[] {
  const route = routes.find(
    (r) => r.method === request.method && r.pattern.test(request.url.pathname)
  )
  if (!route)
    return [`No operation for ${request.method} ${request.url.pathname}`]
  const problems: string[] = []
  const declared = route.query.map((p) => p.name)
  for (const name of queryNames(request.url)) {
    if (!declared.includes(name)) problems.push(`undeclared query ${name}`)
  }
  const values = queryValues(request.url, route.query)
  for (const param of route.query.filter((p) => p.name in values)) {
    problems.push(
      ...explain(
        `query ${param.name}`,
        errors(param.schemaAt, values[param.name])
      )
    )
  }
  if (request.body === undefined) {
    if (route.bodyRequired) problems.push("no body, which it needs")
  } else if (!route.body) {
    problems.push("a body, which it takes none of")
  } else {
    problems.push(...explain("body", errors(route.body.pointer, request.body)))
  }
  return problems.map((p) => `${route.id} request: ${p}`)
}

/**
 * How a reply to an operation breaks the contract: a status the operation
 * doesn't document, or a body that doesn't match the documented one. Any
 * operation can fail with a 5xx, documented or not, with the error envelope.
 */
export function replyProblems(
  route: Route,
  status: number,
  body: unknown
): string[] {
  let pointer: string
  if (route.statuses.includes(status)) {
    const response = at(`${route.responsesAt}/${status}`)
    const content = response.value.content?.["application/json"]
    if (!content) {
      return body === undefined
        ? []
        : [`${route.id} ${status}: a body, which it documents none of`]
    }
    pointer = `${response.pointer}/content/application~1json/schema`
  } else if (status >= 500) {
    pointer = "#/components/schemas/Error"
  } else {
    return [`${route.id} does not document a ${status} response`]
  }
  return explain(`${route.id} ${status} reply`, errors(pointer, body))
}

/**
 * Values that match `schema`, one per `oneOf` and `anyOf` variant anywhere in
 * it (the first holds the first of each): its example, constant, first enum
 * value or default, else one built from its type, with every property (the
 * first non-null type).
 */
export function examples(schema: Schema): unknown[] {
  if (schema.$ref) return examples(at(schema.$ref).value)
  if (schema.examples) return [schema.examples[0]]
  if ("const" in schema) return [schema.const]
  if (schema.enum) return [schema.enum[0]]
  if ("default" in schema) return [schema.default]
  if (schema.allOf) {
    return combine(schema.allOf.map(examples), (parts) =>
      Object.assign({}, ...parts)
    )
  }
  const variants = schema.oneOf ?? schema.anyOf
  if (variants) return (variants as Schema[]).flatMap(examples)
  const types = [schema.type].flat()
  const type = types.find((t) => t !== "null") ?? types[0]
  switch (type) {
    case "object": {
      const properties = Object.entries(schema.properties ?? {})
      return combine(
        properties.map(([, property]) => examples(property)),
        (values) =>
          Object.fromEntries(properties.map(([name], i) => [name, values[i]]))
      )
    }
    case "array": {
      const length = Math.max(schema.minItems ?? 1, 1)
      return examples(schema.items ?? {}).map((item) =>
        Array.from({ length }, () => structuredClone(item))
      )
    }
    case "string":
      return [
        schema.format === "date-time"
          ? "2026-10-02T12:00:00Z"
          : schema.format === "date"
            ? "2026-10-02"
            : "string",
      ]
    case "integer":
    case "number":
      return [schema.minimum ?? 1]
    case "boolean":
      return [false]
    case "null":
      return [null]
    default:
      return [{}]
  }
}

/** The first of `examples(schema)`. */
export const example = (schema: Schema): unknown => examples(schema)[0]

/**
 * As many values as the longest list of `parts` has: the nth takes each
 * part's nth example (or its last), so every example of every part is used.
 */
function combine(
  parts: unknown[][],
  build: (values: unknown[]) => unknown
): unknown[] {
  const count = Math.max(1, ...parts.map((p) => p.length))
  return Array.from({ length: count }, (_, n) =>
    build(parts.map((p) => structuredClone(p[Math.min(n, p.length - 1)])))
  )
}
