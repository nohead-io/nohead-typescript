import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import type { AddressInfo } from "node:net"

import { onTestFinished } from "vitest"

/** A request as the server received it, body and all. */
export interface Received {
  method: string
  path: string
  headers: IncomingHttpHeaders
  body: Buffer
}

type Handler = (
  request: Received,
  response: ServerResponse,
  raw: IncomingMessage
) => void | Promise<void>

/**
 * A real HTTP server on 127.0.0.1 (a free port), for what a fake fetch can't
 * show: what the platform's fetch actually sends, and how the client reads
 * what comes back. It records every request, and closes when the test ends.
 */
export async function localServer(
  handler: Handler
): Promise<{ url: string; received: Received[] }> {
  const received: Received[] = []
  const server = createServer((raw, response) => {
    const chunks: Buffer[] = []
    raw.on("data", (chunk: Buffer) => chunks.push(chunk))
    raw.on("end", () => {
      const request: Received = {
        method: raw.method ?? "",
        path: raw.url ?? "",
        headers: raw.headers,
        body: Buffer.concat(chunks),
      }
      received.push(request)
      Promise.resolve(handler(request, response, raw)).catch(
        (error: unknown) => {
          response.destroy(error as Error)
        }
      )
    })
  })
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve())
  )
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  )
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, received }
}

/** Sends `body` as JSON. */
export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown
): void {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}
