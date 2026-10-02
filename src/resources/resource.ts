import type { Core } from "../core.ts"

export abstract class Resource {
  protected readonly core: Core

  constructor(core: Core) {
    this.core = core
  }
}
