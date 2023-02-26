import { QLiteConfig, QLitePrimitiveTypeName } from './config.js';

function resolveSqlType(
  input: QLitePrimitiveTypeName,
  not_null: boolean
): string {
  const raw: Record<QLitePrimitiveTypeName, string> = {
    boolean: 'BOOLEAN',
    integer: 'INTEGER',
    json: 'JSON',
    real: 'REAL',
    text: 'TEXT',
    timestamp: 'TIMESTAMP',
    uuid: 'UUID',
  };
  return raw[input] + (not_null ? ' NOT NULL' : '');
}

export function generateSqlInitialMigration(config: QLiteConfig) {
  const output: string[] = [];
  for (const [typename, table] of Object.entries(config.tables)) {
    const tablename = table.dbname ?? typename;
    const defs: string[] = [];
    const primary_key_count = Object.values(table.columns).reduce(
      (o, x) => (x.primary_key ? o + 1 : o),
      0
    );
    const pks: string[] = [];
    for (const [fieldname, column] of Object.entries(table.columns)) {
      const columnname = column.dbname ?? fieldname;
      const txt: string[] = [
        columnname,
        resolveSqlType(column.type, column.not_null),
      ];
      if (column.primary_key) {
        if (primary_key_count === 1) txt.push('PRIMARY KEY');
        else pks.push(columnname);
      }
      if (column.default) {
        txt.push(`DEFAULT (${column.default})`);
      }
      defs.push(txt.join(' '));
    }
    output.push(`CREATE TABLE IF NOT EXISTS ${tablename} (`);
    output.push(
      defs
        .filter(Boolean)
        .map((x) => '  ' + x)
        .join(',\n')
    );
    output.push(`);`);
  }
  return output.join('\n');
}
