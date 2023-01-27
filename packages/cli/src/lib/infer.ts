import {
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLOutputType,
  GraphQLString,
} from 'graphql';
import { Database } from 'better-sqlite3';

function resolveGraphQLType(
  input: string,
  notnull: boolean
): GraphQLOutputType {
  if (notnull) {
    return new GraphQLNonNull(resolveGraphQLType(input, false));
  } else {
    switch (input) {
      case 'TEXT':
        return GraphQLString;
      case 'INTEGER':
        return GraphQLInt;
      case 'FLOAT':
        return GraphQLFloat;
      case 'BOOLEAN':
        return GraphQLBoolean;
      default:
        return GraphQLString;
    }
  }
}

function wrapFlag<T>(name: string, value: T, def?: T) {
  if (value === def) return '';
  return `${name}: ${JSON.stringify(value)}`;
}

function wrapBrace(list: string[], braces = '()'): string {
  const filtered = list.filter(Boolean);
  if (filtered.length) return `${braces[0]}${filtered.join(', ')}${braces[1]}`;
  return '';
}

export function inferSchemaFromDatabase(db: Database) {
  const tablelist = db
    .prepare(
      `select * from pragma_table_list where schema = 'main' and type = 'table' and name != 'sqlite_schema'`
    )
    .all() as { name: string; wr: 0 | 1; strict: 0 | 1 }[];
  const query_table_info = db.prepare<[string]>(
    `select * from pragma_table_xinfo(?) where hidden = 0`
  );
  const query_foreign_key_list = db.prepare<[string]>(
    `select "table", json_group_array("from") "from", json_group_array("to") "to", on_update, on_delete from pragma_foreign_key_list(?) group by id`
  );
  const output = [] as string[];
  for (const table of tablelist) {
    const entityflags = wrapBrace([
      wrapFlag('without_rowid', !!table.wr, false),
      wrapFlag('strict', !!table.strict, false),
    ]);
    output.push(`type ${table.name} @entity${entityflags} {`);
    const columns = query_table_info.all(table.name) as {
      cid: number;
      name: string;
      type: string;
      notnull: 0 | 1;
      dflt_value: null | string;
      pk: 0 | 1;
      hidden: 0 | 1;
    }[];
    for (const column of columns) {
      const type = resolveGraphQLType(column.type, !!column.notnull).toString();
      const columnflags = wrapBrace([
        wrapFlag('primary_key', !!column.pk, false),
        wrapFlag(
          'alias_rowid',
          column.type === 'INTEGER' && !!column.pk,
          false
        ),
        wrapFlag('default', column.dflt_value, null),
      ]);
      output.push(`  ${column.name}: ${type} @column${columnflags}`);
    }
    output.push(`}`);
    const foreign_keys = query_foreign_key_list.all(table.name) as {
      table: string;
      from: string;
      to: string;
      on_update: string;
      on_delete: string;
    }[];
    for (const foreign_key of foreign_keys) {
      const flags = wrapBrace([
        wrapFlag('table', foreign_key.table),
        wrapFlag('from', JSON.parse(foreign_key.from)),
        wrapFlag('to', JSON.parse(foreign_key.to)),
        wrapFlag('on_update', foreign_key.on_update, 'NO ACTION'),
        wrapFlag('on_delete', foreign_key.on_delete, 'NO ACTION'),
      ]);
      output.push(`extend type ${table.name} @foreign_key${flags}`);
    }
  }
  return output.join('\n');
}
