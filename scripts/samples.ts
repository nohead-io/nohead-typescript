// Writes samples.json: for each API-key operation, a TypeScript code sample
// that calls it, from the calls in test/calls.ts (which the contract test
// checks against the contract). The Nohead API repository puts them in the
// docs site's API reference (x-codeSamples).
import { writeFileSync } from "node:fs"

import { format } from "prettier"

import { OPERATIONS } from "../src/generated/operations.gen.ts"
import { Nohead, PagePromise } from "../src/index.ts"
import { everyCall, mockReply } from "../test/calls.ts"

const routes = Object.entries(OPERATIONS).map(([id, { method, path }]) => ({
  id,
  method,
  pattern: new RegExp(`^${path.replace(/\{\w+\}/g, "[^/]+")}$`),
}))

// What a list's items are called in the loop, by operation.
const ITEMS: Record<string, string> = {
  record_revisions: "revision",
  schema_changes: "change",
  webhook_deliveries: "delivery",
  audit_events: "event",
  collections_search: "record",
  projects_search: "record",
}
const itemName = (operation: string) =>
  Object.entries(ITEMS).find(([prefix]) => operation.startsWith(prefix))?.[1] ??
  operation.split("_")[0]!.replace(/s$/, "")

const HEADER = `import { Nohead } from "@nohead/sdk"\n\nconst nohead = new Nohead()\n\n`

const samples: Record<string, string> = {}
for (const call of everyCall) {
  let first: string | undefined
  const nohead = new Nohead({
    apiKey: "sk_live_sample",
    baseUrl: "https://api.test",
    projectId: "prj_sample",
    maxRetries: 0,
    // Async like fetch: anything that throws rejects the request's promise.
    // eslint-disable-next-line @typescript-eslint/require-await
    fetch: async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : input)
      const method = init.method ?? "GET"
      const route = routes.find(
        (r) => r.method === method && r.pattern.test(url.pathname)
      )
      if (url.host === "api.test" && route) first ??= route.id
      return mockReply({
        method,
        url,
        headers: new Headers(init.headers),
        body: undefined,
      })
    },
  })
  const result = call(nohead)
  await Promise.resolve(result).catch(() => undefined)
  if (!first) throw new Error(`No operation for ${call.toString()}`)

  const expression = call.toString().replace(/^\(nohead\)\s*=>\s*/, "")
  const statement =
    result instanceof PagePromise
      ? `for await (const ${itemName(first)} of ${expression}) {\n  console.log(${itemName(first)})\n}`
      : `const result = await ${expression}`
  samples[first] ??= await format(HEADER + statement, {
    parser: "typescript",
    semi: false,
    trailingComma: "es5",
  })
}

const sorted = Object.fromEntries(Object.entries(samples).sort())
writeFileSync("samples.json", JSON.stringify(sorted, null, 2) + "\n")
console.log(`samples.json: ${Object.keys(sorted).length} operations`)
