import {
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLScalarType,
  GraphQLSchema,
} from 'graphql';
import { getDirective } from '@graphql-tools/utils';

function resolveSqlType(input: GraphQLOutputType): string {
  if (input instanceof GraphQLNonNull) {
    return resolveSqlType(input.ofType) + ' NOT NULL';
  } else if (input instanceof GraphQLScalarType) {
    switch (input.name) {
      case 'String':
      case 'ID':
        return 'TEXT';
      case 'Int':
        return 'INTEGER';
      case 'Float':
        return 'FLOAT';
      case 'Boolean':
        return 'BOOLEAN';
    }
    return input.name;
  }
  throw new Error('invalid type for column');
}

export function generateSqlInitialMigration(schema: GraphQLSchema) {
  const output = [] as string[];
  for (const item of Object.values(schema.getTypeMap())) {
    if (item instanceof GraphQLObjectType) {
      const entity = getDirective(schema, item, 'entity')?.[0] as {
        name?: string;
        without_rowid?: boolean;
      };
      if (entity) {
        const defs: string[] = [];
        const primaryKeys: string[] = [];
        const tableOptions: string[] = [')'];
        if (entity.without_rowid) {
          tableOptions.push('WITHOUT ROWID');
        }
        for (const field of Object.values(item.getFields())) {
          const column =
            (getDirective(schema, field, 'column')?.[0] as {
              name?: string;
              primary_key?: boolean;
              alias_rowid?: boolean;
              default?: string;
            }) ?? {};
          const column_name: string = column.name ?? field.name;
          let base_def = `${column_name} ${resolveSqlType(field.type)}`;
          if (column.primary_key) {
            if (column.alias_rowid) {
              base_def = `${column_name} INTEGER PRIMARY KEY`;
            } else {
              primaryKeys.push(column_name);
            }
          }
          if (column.default) {
            base_def += ` DEFAULT (${column.default})`;
          }
          const check = getDirective(schema, field, 'check')?.[0] as {
            expr: string;
          };
          if (check) {
            base_def += ` CHECK (${check.expr})`;
          }
          defs.push(base_def);
        }
        if (primaryKeys.length) {
          defs.push(`PRIMARY KEY (${primaryKeys.join(', ')})`);
        }
        const check = getDirective(schema, item, 'check')?.[0] as {
          expr: string;
        };
        if (check) {
          defs.push(`CHECK (${check.expr})`);
        }
        const foreign_keys =
          (getDirective(schema, item, 'foreign_key') as {
            from: string[];
            to: string[];
            table: string;
            deferred?: boolean;
          }[]) ?? [];
        defs.push(
          ...foreign_keys.map((x) => {
            const keys = x.from.join(', ');
            const references = x.to.join(', ');
            const base = `FOREIGN KEY (${keys}) REFERENCES ${x.table}(${references})`;
            if (x.deferred) {
              return base + ' DEFERRABLE INITIALLY DEFERRED';
            }
            return base;
          })
        );
        output.push(`CREATE TABLE IF NOT EXISTS ${entity.name ?? item.name} (`);
        output.push(defs.map((x) => '  ' + x).join(',\n'));
        output.push(tableOptions.join(' ') + ';');
      }
    }
  }
  return output.join('\n');
}
