/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDirective } from '@graphql-tools/utils';
import { GraphQLObjectType, GraphQLSchema } from 'graphql';
import {
  fmt,
  trueMap,
  SQLSelections,
  generateOrderBy,
  generateWhere,
} from './internals/sql.js';
import { getRelations, Relation } from './internals/utils.js';
import { FieldInfo } from './selection-utils.js';

export type SQLQuery = {
  raw: string;
  parameters: unknown[];
};

function generateSubQuery(
  schema: GraphQLSchema,
  root: FieldInfo,
  parent: string,
  relation: Relation
): string {
  const basename = fmt`%s.%s`(parent, root.alias);
  const mapper = new SQLMapper(schema, relation.target, basename);
  const selections = mapper.selections(root.subfields);
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
    if (arg.where) where.push(...mapper.where(arg.where));
    const query = [
      fmt`SELECT json_group_array(json_object(%s)) FROM %q AS %q`(
        selections.asJSON(),
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
      selections.asJSON(),
      relation.target,
      basename,
      where.join(' AND ')
    );
    return query;
  }
  throw new Error('Not implemented');
}

const QUERY_BY_PK = /^(.+)_by_pk$/;
const QUERY_AGGREGATE = /^(.+)_aggregate$/;

class SQLMapper {
  tablename: string;
  type: GraphQLObjectType;
  #namemap: Record<string, string> = {};
  #relations: Record<string, Relation> = {};
  constructor(
    public schema: GraphQLSchema,
    public name: string,
    public alias: string
  ) {
    const type = schema.getType(name);
    if (!type || !(type instanceof GraphQLObjectType))
      throw new Error('invalid type ' + name);
    this.type = type;
    const entity = getDirective(schema, type, 'entity')?.[0];
    if (!entity) throw new Error('invalid entity ' + name);
    this.tablename = entity['name'] ?? name;
    for (const [key, value] of Object.entries(this.fields)) {
      const column = getDirective(this.schema, value, 'column')?.[0];
      if (column) {
        this.#namemap[key] = column['name'] ?? key;
      }
    }
    const relations = getRelations(type, schema);
    if (relations) {
      for (const rel of relations) {
        this.#relations[rel.name ?? rel.target] = rel;
      }
    }
  }

  get fields() {
    return this.type.getFields();
  }

  get from() {
    return fmt`%q AS %q`(this.tablename, this.alias);
  }

  selections(queryfields: readonly FieldInfo[]) {
    const selections = new SQLSelections();
    for (const subfield of queryfields) {
      let resolved;
      if ((resolved = this.#namemap[subfield.name])) {
        selections.add(subfield.name, fmt`%q.%q`(this.alias, resolved));
      } else if ((resolved = this.#relations[subfield.name])) {
        const subquery = generateSubQuery(
          this.schema,
          subfield,
          this.alias,
          resolved
        );
        selections.add$(subfield.alias, subquery, true);
      }
    }
    return selections;
  }

  aggregate(queryfields: readonly FieldInfo[]) {
    const selections = new SQLSelections();
    for (const subfield of queryfields) {
      if (subfield.name === 'count') {
        let count_arg = trueMap(
          subfield.arguments['columns'] as string[],
          (columns) =>
            columns
              .map((x) => fmt`%q`(fmt`%s.%s`(this.alias, this.#namemap[x])))
              .join(', ')
        );
        if (subfield.arguments['distinct'] && count_arg)
          count_arg = 'DISTINCT ' + count_arg;
        selections.add$(
          subfield.alias,
          count_arg ? fmt`count(%s)`(count_arg) : `count(*)`
        );
      }
    }
  }

  where(arg: Record<string, unknown>) {
    return generateWhere(arg, this.alias, this.#namemap).filter(Boolean);
  }
}

export function generateSQL(schema: GraphQLSchema, root: FieldInfo): SQLQuery {
  let matched;
  if ((matched = root.name.match(QUERY_BY_PK))) {
    const name = matched[1];
    const mapper = new SQLMapper(schema, name, '@' + root.alias);
    const selections = mapper.selections(root.subfields);
    const where: string[] = [];
    const parameters: unknown[] = [];
    for (const [key, value] of Object.entries(root.arguments)) {
      const resolved = mapper.fields[key];
      if (!resolved) throw new Error(`Cannot find "${key}" in type "${name}"`);
      const column = getDirective(schema, resolved, 'column')?.[0];
      if (!column) throw new Error('invalid primary key');
      where.push(fmt`%q.%q = ?`(mapper.alias, column['name'] ?? key));
      parameters.push(value);
    }
    const raw = fmt`SELECT %s FROM %s WHERE %s`(
      selections.asSelect(),
      mapper.from,
      where.join(', ')
    );
    console.log(raw);
    return { raw, parameters };
  } else if ((matched = root.name.match(QUERY_AGGREGATE))) {
    const name = matched[1];
    const mapper = new SQLMapper(schema, name, '@' + root.alias);
    const selections = new SQLSelections();
    for (const field of root.subfields) {
      if (field.name === 'nodes') {
        const subsel = mapper.selections(field.subfields);
        selections.add$(
          field.alias,
          fmt`json_group_array(json_object(%s))`(subsel.asJSON())
        );
      }
    }
    const arg = root.arguments as {
      limit?: number;
      offset?: number;
      where?: Record<string, unknown>;
      order_by?: Record<string, string>;
    };
    const where: string[] = [];
    if (arg.where) where.push(...mapper.where(arg.where));
    const raw = [
      fmt`SELECT %s`(selections.asSelect()),
      fmt`FROM %s`(mapper.from),
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
    return { raw, parameters: [] };
  } else {
    const name = root.name;
    const mapper = new SQLMapper(schema, name, '@' + root.alias);
    const selections = mapper.selections(root.subfields);
    const arg = root.arguments as {
      limit?: number;
      offset?: number;
      where?: Record<string, unknown>;
      order_by?: Record<string, string>;
    };
    const where: string[] = [];
    if (arg.where) where.push(...mapper.where(arg.where));
    const raw = [
      fmt`SELECT %s`(selections.asSelect()),
      fmt`FROM %s`(mapper.from),
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
    return { raw, parameters: [] };
  }
}
