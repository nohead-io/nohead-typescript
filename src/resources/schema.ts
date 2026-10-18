import type { APIPromise, PagePromise } from "../api-promise.ts"
import type { RequestOptions, WriteOptions } from "../core.ts"
import type {
  Collection,
  FieldOrder,
  CollectionCreate,
  CollectionUpdate,
  Field,
  FieldCreate,
  FieldMigration,
  FieldMigrationPreview,
  FieldUpdate,
  Schema,
  SchemaChange,
  SchemaChangeDetail,
  SearchIndex,
} from "../generated/types.gen.ts"
import type {
  DeletedListParams,
  DryRunParams,
  FieldMigrateParams,
  FieldReorderParams,
  ListParams,
  SchemaParams,
} from "../types.ts"
import { listQuery, Resource } from "./resource.ts"

/** Collections of the key's project. `collection` is an ID or slug. */
export class Collections extends Resource {
  readonly schemaChanges = new SchemaChanges(this.core)
  readonly searchIndex = new SearchIndexes(this.core)

  list(
    params: DeletedListParams = {},
    options?: RequestOptions
  ): PagePromise<Collection> {
    return this.core.paginate(
      "collections_list",
      { query: listQuery(params, ["deleted"]) },
      options
    )
  }

  get(collection: string, options?: RequestOptions): APIPromise<Collection> {
    return this.core.request(
      "collections_get",
      { path: { collection_id: collection } },
      options
    )
  }

  /** Creates a collection, optionally with its fields. */
  create(
    params: CollectionCreate,
    options?: WriteOptions
  ): APIPromise<Collection> {
    return this.core.request("collections_create", { body: params }, options)
  }

  update(
    collection: string,
    params: CollectionUpdate,
    options?: WriteOptions
  ): APIPromise<Collection> {
    return this.core.request(
      "collections_update",
      { path: { collection_id: collection }, body: params },
      options
    )
  }

  /**
   * Soft-deletes the collection and its records: `restore` brings them back
   * until its `purge_after`.
   */
  delete(collection: string, options?: WriteOptions): APIPromise<Collection> {
    return this.core.request(
      "collections_delete",
      { path: { collection_id: collection } },
      options
    )
  }

  restore(collection: string, options?: WriteOptions): APIPromise<Collection> {
    return this.core.request(
      "collections_restore",
      { path: { collection_id: collection } },
      options
    )
  }

  /** The collection's schema, now or at a past `version`. */
  schema(
    collection: string,
    params: SchemaParams = {},
    options?: RequestOptions
  ): APIPromise<Schema> {
    return this.core.request(
      "collections_get_schema",
      { path: { collection_id: collection }, query: params },
      options
    )
  }
}

/** A collection's schema history, newest first. */
export class SchemaChanges extends Resource {
  list(
    collection: string,
    params: ListParams = {},
    options?: RequestOptions
  ): PagePromise<SchemaChange> {
    return this.core.paginate(
      "schema_changes_list",
      { path: { collection_id: collection }, query: params },
      options
    )
  }

  get(
    collection: string,
    schemaChange: string,
    options?: RequestOptions
  ): APIPromise<SchemaChangeDetail> {
    return this.core.request(
      "schema_changes_get",
      {
        path: { collection_id: collection, schema_change_id: schemaChange },
      },
      options
    )
  }
}

/** A collection's search index. */
export class SearchIndexes extends Resource {
  get(collection: string, options?: RequestOptions): APIPromise<SearchIndex> {
    return this.core.request(
      "search_index_get",
      { path: { collection_id: collection } },
      options
    )
  }

  /** Rebuilds the index from the records; searches keep working meanwhile. */
  rebuild(
    collection: string,
    options?: RequestOptions
  ): APIPromise<SearchIndex> {
    return this.core.request(
      "search_index_rebuild",
      { path: { collection_id: collection } },
      options
    )
  }
}

/** Fields of a collection. `field` is a field ID (`fld_…`). */
export class Fields extends Resource {
  list(
    collection: string,
    params: DeletedListParams = {},
    options?: RequestOptions
  ): PagePromise<Field> {
    return this.core.paginate(
      "fields_list",
      {
        path: { collection_id: collection },
        query: listQuery(params, ["deleted"]),
      },
      options
    )
  }

  create(
    collection: string,
    params: FieldCreate,
    options?: WriteOptions
  ): APIPromise<Field> {
    return this.core.request(
      "fields_create",
      { path: { collection_id: collection }, body: params },
      options
    )
  }

  get(field: string, options?: RequestOptions): APIPromise<Field> {
    return this.core.request(
      "fields_get",
      { path: { field_id: field } },
      options
    )
  }

  /**
   * Renames, describes or loosens a field. Changes that rewrite record
   * values (type, `multiple`, tighter rules) are `migrate`.
   */
  update(
    field: string,
    params: FieldUpdate,
    options?: WriteOptions
  ): APIPromise<Field> {
    return this.core.request(
      "fields_update",
      { path: { field_id: field }, body: params },
      options
    )
  }

  /**
   * Soft-deletes the field: its values come back with `restore` until its
   * `purge_after`.
   */
  delete(field: string, options?: WriteOptions): APIPromise<Field> {
    return this.core.request(
      "fields_delete",
      { path: { field_id: field } },
      options
    )
  }

  restore(field: string, options?: WriteOptions): APIPromise<Field> {
    return this.core.request(
      "fields_restore",
      { path: { field_id: field } },
      options
    )
  }

  /** The collection's active fields, in order. */
  order(collection: string, options?: RequestOptions): APIPromise<FieldOrder> {
    return this.core.request(
      "fields_get_order",
      { path: { collection_id: collection } },
      options
    )
  }

  /** Puts the collection's fields in this order; lists every active field once. */
  reorder(
    collection: string,
    params: FieldReorderParams,
    options?: WriteOptions
  ): APIPromise<FieldOrder> {
    return this.core.request(
      "fields_reorder",
      { path: { collection_id: collection }, body: params },
      options
    )
  }

  /** Stops accepting a renamed field's old API key before its 6 months end. */
  removeAlias(
    field: string,
    alias: string,
    options?: RequestOptions
  ): APIPromise<Field> {
    return this.core.request(
      "fields_remove_alias",
      { path: { field_id: field, alias } },
      options
    )
  }

  /**
   * Starts a field migration (type, `multiple`, tighter configuration or a
   * backfill) that rewrites every record. With `dry_run`, previews it.
   */
  migrate(
    field: string,
    params: FieldMigrateParams & { dry_run: true },
    options?: WriteOptions
  ): APIPromise<FieldMigrationPreview>
  migrate(
    field: string,
    params: FieldMigrateParams & DryRunParams,
    options?: WriteOptions
  ): APIPromise<FieldMigration>
  migrate(
    field: string,
    { dry_run, ...body }: FieldMigrateParams & DryRunParams,
    options?: WriteOptions
  ): APIPromise<unknown> {
    return this.core.request(
      "fields_migrate",
      { path: { field_id: field }, query: { dry_run }, body },
      options
    )
  }
}

/** Field migrations. While one runs, its collection is read-only. */
export class Migrations extends Resource {
  list(
    collection: string,
    params: ListParams = {},
    options?: RequestOptions
  ): PagePromise<FieldMigration> {
    return this.core.paginate(
      "migrations_list",
      { path: { collection_id: collection }, query: params },
      options
    )
  }

  get(migration: string, options?: RequestOptions): APIPromise<FieldMigration> {
    return this.core.request(
      "migrations_get",
      { path: { migration_id: migration } },
      options
    )
  }

  cancel(
    migration: string,
    options?: RequestOptions
  ): APIPromise<FieldMigration> {
    return this.core.request(
      "migrations_cancel",
      { path: { migration_id: migration } },
      options
    )
  }
}
