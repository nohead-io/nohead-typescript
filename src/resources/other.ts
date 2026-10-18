import type { APIPromise, PagePromise } from "../api-promise.ts"
import type { RequestOptions } from "../core.ts"
import type {
  AuditEvent,
  FeatureFlags as FeatureFlagList,
  Health as HealthStatus,
  Principal,
} from "../generated/types.gen.ts"
import type { AuditEventListParams } from "../types.ts"
import { Resource } from "./resource.ts"

/**
 * The project's activity log, newest first. Needs the `audit:read` scope.
 * Filter by `type` (`record.*` for a prefix), `resource_type` (one or
 * several), `resource_id`, `actor_type`, `actor_id` and `created_at`
 * (`{ gte, lt }`).
 */
export class AuditEvents extends Resource {
  list(
    params: AuditEventListParams = {},
    options?: RequestOptions
  ): PagePromise<AuditEvent> {
    const { filter, ...rest } = params
    const resourceType = filter?.resource_type
    return this.core.paginate(
      "audit_events_list",
      {
        query: {
          ...rest,
          filter: Array.isArray(resourceType)
            ? { ...filter, resource_type: { in: resourceType } }
            : filter,
        },
      },
      options
    )
  }
}

export class FeatureFlags extends Resource {
  /** Flags evaluated for the key's project. */
  list(options?: RequestOptions): APIPromise<FeatureFlagList> {
    return this.core.request("feature_flags_list", {}, options)
  }
}

export class Me extends Resource {
  /** The API key: its project, scopes, `published_only` and expiry. */
  get(options?: RequestOptions): APIPromise<Principal> {
    return this.core.request("me_get", {}, options)
  }
}

export class Health extends Resource {
  check(options?: RequestOptions): APIPromise<HealthStatus> {
    return this.core.request("health_check", {}, options)
  }
}
