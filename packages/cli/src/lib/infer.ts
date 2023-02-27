import { stringify } from 'yaml';
import { Database } from 'better-sqlite3';
import {
  QLiteColumnConfig,
  QLitePrimitiveTypeName,
  QLiteRelationConfig,
} from '@qlite/core';

function resolveQLiteType(input: string): QLitePrimitiveTypeName {
  const raw: Record<string, QLitePrimitiveTypeName> = {
    BOOLEAN: 'boolean',
    INTEGER: 'integer',
    JSON: 'json',
    REAL: 'real',
    TEXT: 'text',
    TIMESTAMP: 'timestamp',
    UUID: 'uuid',
  };
  return raw[input] ?? 'text';
}

export function inferSchemaFromDatabase(db: Database): string {
  const raw = {
    tables: {} as Record<string, unknown>,
  };
  const tablenames = db
    .prepare(
      `select name from pragma_table_list where schema = 'main' and type = 'table' and name != 'sqlite_schema'`
    )
    .all()
    .map((x) => x.name as string);
  const query_table_info = db.prepare<[string]>(
    `select * from pragma_table_xinfo(?) where hidden = 0`
  );
  for (const name of tablenames) {
    const tabledef = {
      columns: {} as Record<string, Partial<QLiteColumnConfig>>,
      relations: {} as Record<string, Partial<QLiteRelationConfig>>,
    };
    const columns = query_table_info.all(name) as {
      name: string;
      type: string;
      notnull: 0 | 1;
      dflt_value: null | string;
      pk: 0 | 1;
    }[];
    for (const column of columns) {
      tabledef.columns[column.name] = {
        type: resolveQLiteType(column.type),
        not_null: column.notnull === 1 || undefined,
        default: column.dflt_value ?? undefined,
        primary_key: column.pk === 1 || undefined,
      };
    }
    raw.tables[name] = tabledef;
  }
  return stringify(raw);
}
