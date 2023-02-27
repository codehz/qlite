import { z } from 'zod';

export const QLiteTableRootFields = z
  .object({
    select: z.string().optional(),
    select_by_pk: z.string().optional(),
    select_aggregate: z.string().optional(),
    insert: z.string().optional(),
    insert_one: z.string().optional(),
    update: z.string().optional(),
    update_many: z.string().optional(),
    update_by_pk: z.string().optional(),
    delete: z.string().optional(),
    delete_by_pk: z.string().optional(),
  })
  .strict();
export type QLiteTableRootFields = z.infer<typeof QLiteTableRootFields>;

export const QLitePrimitiveTypeName = z.enum([
  'integer',
  'real',
  'uuid',
  'text',
  'boolean',
  'timestamp',
  'json',
]);
export type QLitePrimitiveTypeName = z.infer<typeof QLitePrimitiveTypeName>;

export const QLiteColumnConfig = z
  .object({
    dbname: z.string().optional(),
    comments: z.string().optional(),
    type: QLitePrimitiveTypeName,
    not_null: z.boolean().default(() => false),
    default: z.string().optional(),
    primary_key: z.boolean().default(() => false),
    generate_uuid: z.boolean().default(() => false),
  })
  .strict();
export type QLiteColumnConfig = z.infer<typeof QLiteColumnConfig>;

export const QLiteRelationConfig = z
  .object({
    type: z.enum(['object', 'array']),
    comments: z.string().optional(),
    remote_table: z.string(),
    mappings: z.record(z.string()),
  })
  .strict();
export type QLiteRelationConfig = z.infer<typeof QLiteRelationConfig>;

export const QLitePermissionExpression = z.record(z.unknown());
export type QLitePermissionExpression = z.infer<
  typeof QLitePermissionExpression
>;

export const QLiteInsertPermissionConfig = z
  .object({
    check: QLitePermissionExpression.default(() => ({})),
    columns: z.array(z.string()),
  })
  .strict();
export type QLiteInsertPermissionConfig = z.infer<
  typeof QLiteInsertPermissionConfig
>;

export const QLiteSelectPermissionConfig = z
  .object({
    filter: QLitePermissionExpression.default(() => ({})),
    columns: z.array(z.string()),
  })
  .strict();
export type QLiteSelectPermissionConfig = z.infer<
  typeof QLiteSelectPermissionConfig
>;

export const QLiteUpdatePermissionConfig = z
  .object({
    filter: QLitePermissionExpression.default(() => ({})),
    check: QLitePermissionExpression.default(() => ({})),
    columns: z.array(z.string()),
  })
  .strict();
export type QLiteUpdatePermissionConfig = z.infer<
  typeof QLiteUpdatePermissionConfig
>;

export const QLiteDeletePermissionConfig = z
  .object({
    filter: QLitePermissionExpression.default(() => ({})),
  })
  .strict();
export type QLiteDeletePermissionConfig = z.infer<
  typeof QLiteDeletePermissionConfig
>;

export const QLiteTableConfig = z
  .object({
    dbname: z.string().optional(),
    root_fields: QLiteTableRootFields.default(() => ({})),
    comments: z.string().optional(),
    columns: z.record(QLiteColumnConfig),
    relations: z.record(QLiteRelationConfig).default(() => ({})),
    insert_permissions: z
      .record(QLiteInsertPermissionConfig)
      .default(() => ({})),
    select_permissions: z
      .record(QLiteSelectPermissionConfig)
      .default(() => ({})),
    update_permissions: z
      .record(QLiteUpdatePermissionConfig)
      .default(() => ({})),
    delete_permissions: z
      .record(QLiteDeletePermissionConfig)
      .default(() => ({})),
  })
  .strict();
export type QLiteTableConfig = z.infer<typeof QLiteTableConfig>;

export const QLiteConfig = z
  .object({
    tables: z.record(QLiteTableConfig),
  })
  .strict();
export type QLiteConfig = z.infer<typeof QLiteConfig>;
