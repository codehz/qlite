import { getDirective } from '@graphql-tools/utils';
import { GraphQLObjectType, GraphQLOutputType, GraphQLSchema } from 'graphql';
import { CacheManager } from './cache.js';
import { quoteStr, smartQuote } from './sql.js';

const ColumnCache = new CacheManager<
  {
    primary_key?: boolean | undefined;
    alias_rowid?: boolean | undefined;
    default?: string | undefined;
    name: string;
    dbname: string | undefined;
    type: GraphQLOutputType;
  }[]
>();

export function getColumns(item: GraphQLObjectType, schema: GraphQLSchema) {
  return (ColumnCache.cache(schema, item).value ??= Object.entries(
    item.getFields()
  ).flatMap(([k, v]) => {
    const raw = getDirective(schema, v, 'column')?.[0];
    if (!raw) return [];
    const { name, ...dir } = raw as {
      name?: string;
      primary_key?: boolean;
      alias_rowid?: boolean;
      default?: string;
    };
    return { name: k, dbname: name, type: v.type, ...dir };
  }));
}

export type Relation = {
  name?: string;
  type: 'object' | 'array';
  target: string;
  defintions: {
    from: string;
    to: string;
  }[];
};

export function getRelations(item: GraphQLObjectType, schema: GraphQLSchema) {
  return getDirective(schema, item, 'relation') as Relation[] | undefined;
}

export type ComputedSQLBuilder = (
  self: string,
  variables: Record<string, unknown>
) => string;

const ComputedCache = new CacheManager<
  {
    name: string;
    sql: string;
    builder: ComputedSQLBuilder;
  }[]
>();

function sqlTemplateToBuilder(template: string) {
  const tokens = [] as {
    type: 'literal' | 'variable';
    value: string;
  }[];
  let buffer = '';
  let mode: 'INITIAL' | 'VARIABLE' | '"' | "'" = 'INITIAL';
  for (const ch of template) {
    if (mode === 'INITIAL') {
      switch (ch) {
        case "'":
        case '"':
          mode = ch;
          buffer += ch;
          break;
        case '$':
          if (buffer) {
            tokens.push({ type: 'literal', value: buffer });
            buffer = '';
          }
          mode = 'VARIABLE';
          break;
        default:
          buffer += ch;
      }
    } else if (mode === 'VARIABLE') {
      if (ch.match(/[a-z0-9_]/i)) {
        buffer += ch;
      } else {
        tokens.push({ type: 'variable', value: buffer });
        buffer = ch;
        mode = 'INITIAL';
      }
    } else {
      buffer += ch;
      if (ch === mode) {
        mode = 'INITIAL';
      }
    }
  }
  if (buffer) {
    if (mode === 'INITIAL') {
      tokens.push({ type: 'literal', value: buffer });
    } else if (mode === 'VARIABLE') {
      tokens.push({ type: 'variable', value: buffer });
    } else {
      throw new Error('unclosed quote: ' + mode);
    }
  }
  return (self: string, variables: Record<string, unknown>) => {
    return tokens
      .map((input) => {
        switch (input.type) {
          case 'literal':
            return input.value;
          case 'variable':
            return input.value ? smartQuote(variables[input.value]) : quoteStr(self);
        }
        throw new Error('invalid state: ' + input.type);
      })
      .join('');
  };
}

export function getComputedColumns(
  item: GraphQLObjectType,
  schema: GraphQLSchema
) {
  return (ComputedCache.cache(schema, item).value ??= Object.entries(
    item.getFields()
  ).flatMap(([k, v]) => {
    const raw = getDirective(schema, v, 'computed')?.[0];
    if (!raw) return [];
    const { sql } = raw as {
      sql: string;
    };
    return { name: k, sql, builder: sqlTemplateToBuilder(sql) };
  }));
}
