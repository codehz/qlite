import { QLiteConfig } from './config.js';
import { resolveSqlType } from './schema/sql/utils.js';

export function generateSqlInitialMigration(config: QLiteConfig) {
  const output: string[] = [];
  for (const [typename, table] of Object.entries(config.tables)) {
    const tablename = table.dbname ?? typename;
    const defs: string[] = [];
    const pks: string[] = [];
    for (const [fieldname, column] of Object.entries(table.columns)) {
      const columnname = column.dbname ?? fieldname;
      const txt: string[] = [
        columnname,
        resolveSqlType(column.type, column.not_null),
      ];
      if (column.primary_key) {
        pks.push(columnname);
      }
      if (column.default) {
        txt.push(`DEFAULT (${column.default})`);
      }
      defs.push(txt.join(' '));
    }
    if (pks.length) defs.push(`PRIMARY KEY (${pks.join(', ')})`);
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
