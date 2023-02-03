/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDirective } from '@graphql-tools/utils';
import { GraphQLObjectType, GraphQLSchema } from 'graphql';
import { getRelations } from './internals/utils.js';
import { FieldInfo } from './selection-utils.js';

const QUERY_BY_PK = /^(.+)_by_pk$/;

export type SQLQuery = {
  raw: string;
  parameters: unknown[];
};

function quoteStr(str: string, quote = '"') {
  return quote + str.replaceAll(quote, quote + quote) + quote;
}
function smartQuote(input: unknown): string {
  if (Array.isArray(input)) return '(' + input.map(smartQuote) + ')';
  if (typeof input === 'string') return quoteStr(input);
  return input + '';
}
function fmt(
  template: { raw: readonly string[] | ArrayLike<string> },
  ...substitutions: any[]
) {
  const tmp = String.raw(template, ...substitutions);
  return (...args: any[]) =>
    tmp.replace(/%([sqta])/g, (_, a) => {
      if (a === 's') return args.shift();
      if (a === 'q') return quoteStr(args.shift());
      if (a === 't') return quoteStr(args.shift(), "'");
      if (a === 'a') return smartQuote(args.shift());
    });
}

function trueMap<T>(f: T | null | undefined, cb: (input: T) => string): string {
  if (f == null) return '';
  if (Array.isArray(f) && f.length === 0) return '';
  return cb(f);
}

type Relation = {
  name: string;
  type: 'object' | 'array';
  target: string;
  defintions: {
    from: string;
    to: string;
  }[];
};

function findRelation(
  schema: GraphQLSchema,
  type: GraphQLObjectType,
  name: string
) {
  const relations = getRelations(type, schema) ?? [];
  return relations.find((x) => x.name === name) as Relation | undefined;
}

function cond(key: string): (l: string, r: unknown) => string {
  switch (key) {
    case '_eq':
      return fmt`%s = %a`;
    case '_neq':
      return fmt`%s != %a`;
    case '_gt':
      return fmt`%s > %a`;
    case '_gte':
      return fmt`%s >= %a`;
    case '_lt':
      return fmt`%s < %a`;
    case '_lte':
      return fmt`%s <= %a`;
    case '_in':
      return fmt`%s IN %a`;
    case '_nin':
      return fmt`%s NOT IN %a`;
    case '_is_null':
      return (left, right) =>
        right ? fmt`%s IS NULL`(left) : fmt`%s IS NOT NULL`(left);
  }
  throw new Error('invalid cond ' + key);
}

function generateWhereCond(
  key: string,
  input: Record<string, unknown>,
  self: string
): string {
  const first = Object.entries(input)?.[0];
  if (first) {
    const [type, value] = first;
    const left = fmt`%q.%q`(self, key);
    return cond(type)(left, value);
  }
  return '';
}

function generateWhere(input: Record<string, unknown>, self: string): string[] {
  const conds: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case '_and':
        conds.push(...generateWhere(value as Record<string, unknown>, self));
        break;
      case '_or':
        conds.push(
          trueMap(generateWhere(value as Record<string, unknown>, self), (x) =>
            fmt`(%s)`(x.join(' OR '))
          )
        );
        break;
      case '_not':
        conds.push(
          trueMap(generateWhere(value as Record<string, unknown>, self), (x) =>
            fmt`NOT (%s)`(x.join(' AND '))
          )
        );
        break;
      default:
        conds.push(
          generateWhereCond(key, value as Record<string, unknown>, self)
        );
    }
  }
  return conds.filter(Boolean);
}

function generateOrderBy(
  input: Record<string, string>,
  self: string
): string[] {
  return Object.entries(input).map(([k, v]) =>
    fmt`%q.%q %s`(self, k, v.replaceAll('_', ' ').toUpperCase())
  );
}

function generateSubQuery(
  schema: GraphQLSchema,
  root: FieldInfo,
  parent: string,
  relation: Relation
): string {
  const basename = fmt`%s.%s`(parent, root.alias);
  const type = schema.getType(relation.target);
  if (!type || !(type instanceof GraphQLObjectType))
    throw new Error('invalid type ' + relation.target);
  const fields = type.getFields();
  const json_fields: string[] = [];
  for (const subfield of root.subfields) {
    const resolved = fields[subfield.name];
    if (resolved) {
      const column = getDirective(schema, resolved, 'column')?.[0];
      if (!column) continue;
      json_fields.push(
        fmt`%t, %q.%q`(subfield.name, basename, column['name'] ?? subfield.name)
      );
    } else {
      const relation = findRelation(schema, type, subfield.name);
      if (relation) {
        const subquery = generateSubQuery(schema, subfield, basename, relation);
        json_fields.push(fmt`%t, (%s)`('$' + subfield.alias, subquery));
      }
    }
  }
  const where: string[] = [];
  for (const { from, to } of relation.defintions) {
    where.push(fmt`%q.%q = %q.%q`(parent, from, basename, to));
  }
  if (relation.type === 'array') {
    const arg = root.arguments as {
      limit?: number;
      offset?: number;
      where?: Record<string, unknown>;
      order_by?: Record<string, string>;
    };
    if (arg.where)
      where.push(...generateWhere(arg.where, basename).filter(Boolean));
    const query = [
      fmt`SELECT json_group_array(json_object(%s)) FROM %q AS %q`(
        json_fields.join(', '),
        relation.target,
        basename
      ),
      trueMap(where, (x) => fmt`WHERE %s`(x.join(' AND '))),
      trueMap(arg.order_by, (x) =>
        trueMap(generateOrderBy(x, basename), (x) =>
          fmt`ORDER BY %s`(x.join(', '))
        )
      ),
      trueMap(arg.limit, (x) => fmt`LIMIT %s`(x)),
      trueMap(arg.offset, (x) => fmt`OFFSET %s`(x)),
    ]
      .filter(Boolean)
      .join(' ');
    return fmt`coalesce((%s), %t)`(query, '[]');
  } else if (relation.type === 'object') {
    const query = fmt`SELECT json_object(%s) FROM %q AS %q WHERE %s LIMIT 1`(
      json_fields.join(', '),
      relation.target,
      basename,
      where.join(' AND ')
    );
    return query;
  }
  throw new Error('Not implemented');
}

export function generateSQL(schema: GraphQLSchema, root: FieldInfo): SQLQuery {
  let matched;
  if ((matched = root.name.match(QUERY_BY_PK))) {
    const name = matched[1];
    const { fields, where, parameters, selections, tablename } = analyzeType(
      schema,
      name,
      root
    );
    for (const [key, value] of Object.entries(root.arguments)) {
      const resolved = fields[key];
      if (!resolved) throw new Error(`Cannot find "${key}" in type "${name}"`);
      const column = getDirective(schema, resolved, 'column')?.[0];
      if (!column) throw new Error('invalid primary key');
      where.push(fmt`%q.%q = ?`(root.alias, column['name'] ?? key));
      parameters.push(value);
    }
    const raw = fmt`SELECT %s FROM %s WHERE %s`(
      selections.join(', '),
      fmt`%q AS %q`(tablename, root.alias),
      where.join(', ')
    );
    console.log(raw);
    return { raw, parameters };
  } else {
    const name = root.name;
    const { where, parameters, selections, tablename } = analyzeType(
      schema,
      name,
      root
    );
    const arg = root.arguments as {
      limit?: number;
      offset?: number;
      where?: Record<string, unknown>;
      order_by?: Record<string, string>;
    };
    if (arg.where)
      where.push(...generateWhere(arg.where, name).filter(Boolean));
    const raw = [
      fmt`SELECT %s`(selections.join(', ')),
      fmt`FROM %q AS %q`(tablename, root.alias),
      trueMap(where, (x) => fmt`WHERE %s`(x.join(' AND '))),
      trueMap(arg.order_by, (x) =>
        trueMap(generateOrderBy(x, name), (x) => fmt`ORDER BY %s`(x.join(', ')))
      ),
      trueMap(arg.limit, (x) => fmt`LIMIT %s`(x)),
      trueMap(arg.offset, (x) => fmt`OFFSET %s`(x)),
    ]
      .filter(Boolean)
      .join(' ');
    console.log(raw);
    return { raw, parameters };
  }
}

function analyzeType(
  schema: GraphQLSchema,
  name: string,
  root: FieldInfo
): {
  fields: Record<string, unknown>;
  where: string[];
  parameters: unknown[];
  selections: string[];
  tablename: any;
} {
  const type = schema.getType(name);
  if (!type || !(type instanceof GraphQLObjectType))
    throw new Error('invalid type ' + name);
  const entity = getDirective(schema, type, 'entity')?.[0];
  if (!entity) throw new Error('invalid entity ' + name);
  const tablename = entity['name'] ?? name;
  const fields = type.getFields();
  const selections: string[] = [];
  const where: string[] = [];
  const parameters: unknown[] = [];
  for (const subfield of root.subfields) {
    const resolved = fields[subfield.name];
    if (resolved) {
      const column = getDirective(schema, resolved, 'column')?.[0];
      if (!column) continue;
      selections.push(
        fmt`%q.%q AS %q`(
          root.alias,
          column['name'] ?? subfield.name,
          subfield.name
        )
      );
    } else {
      const relation = findRelation(schema, type, subfield.name);
      if (relation) {
        const subquery = generateSubQuery(
          schema,
          subfield,
          root.alias,
          relation
        );
        selections.push(fmt`(%s) AS %q`(subquery, '$' + subfield.alias));
      }
    }
  }
  return { fields, where, parameters, selections, tablename };
}
