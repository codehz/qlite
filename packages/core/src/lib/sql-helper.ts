/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDirective } from '@graphql-tools/utils';
import { GraphQLObjectType, GraphQLSchema } from 'graphql';
import { fmt, trueMap, SQLSelections, generateOrderBy, generateWhere } from './internals/sql.js';
import { getRelations } from './internals/utils.js';
import { FieldInfo } from './selection-utils.js';

export type SQLQuery = {
  raw: string;
  parameters: unknown[];
};

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
  const json_fields = new SQLSelections();
  for (const subfield of root.subfields) {
    const resolved = fields[subfield.name];
    if (resolved) {
      const column = getDirective(schema, resolved, 'column')?.[0];
      if (!column) continue;
      json_fields.add(
        subfield.name,
        fmt`%q.%q`(basename, column['name'] ?? subfield.name)
      );
    } else {
      const relation = findRelation(schema, type, subfield.name);
      if (relation) {
        const subquery = generateSubQuery(schema, subfield, basename, relation);
        json_fields.add$(subfield.alias, subquery);
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
        json_fields.asJSON(),
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
      json_fields.asJSON(),
      relation.target,
      basename,
      where.join(' AND ')
    );
    return query;
  }
  throw new Error('Not implemented');
}

const QUERY_BY_PK = /^(.+)_by_pk$/;

class SQLMapper {
  tablename: string;
  type: GraphQLObjectType;
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
  }

  get fields() {
    return this.type.getFields();
  }

  get from() {
    return fmt`%q AS %q`(this.tablename, this.alias);
  }

  selections(queryfields: readonly FieldInfo[]) {
    const fields = this.type.getFields();
    const selections = new SQLSelections();
    for (const subfield of queryfields) {
      const resolved = fields[subfield.name];
      if (resolved) {
        const column = getDirective(this.schema, resolved, 'column')?.[0];
        if (!column) continue;
        selections.add(
          subfield.name,
          fmt`%q.%q`(this.alias, column['name'] ?? subfield.name)
        );
      } else {
        const relation = findRelation(this.schema, this.type, subfield.name);
        if (relation) {
          const subquery = generateSubQuery(
            this.schema,
            subfield,
            this.alias,
            relation
          );
          selections.add$(subfield.alias, subquery);
        }
      }
    }
    return selections;
  }

  where(arg: Record<string, unknown>) {
    return generateWhere(arg, this.alias).filter(Boolean);
  }
}

export function generateSQL(schema: GraphQLSchema, root: FieldInfo): SQLQuery {
  let matched;
  if ((matched = root.name.match(QUERY_BY_PK))) {
    const name = matched[1];
    const mapper = new SQLMapper(schema, name, root.alias);
    const selections = mapper.selections(root.subfields);
    const where: string[] = [];
    const parameters: unknown[] = [];
    for (const [key, value] of Object.entries(root.arguments)) {
      const resolved = mapper.fields[key];
      if (!resolved) throw new Error(`Cannot find "${key}" in type "${name}"`);
      const column = getDirective(schema, resolved, 'column')?.[0];
      if (!column) throw new Error('invalid primary key');
      where.push(fmt`%q.%q = ?`(root.alias, column['name'] ?? key));
      parameters.push(value);
    }
    const raw = fmt`SELECT %s FROM %s WHERE %s`(
      selections.asSelect(),
      mapper.from,
      where.join(', ')
    );
    console.log(raw);
    return { raw, parameters };
  } else {
    const name = root.name;
    const mapper = new SQLMapper(schema, name, root.alias);
    const selections = mapper.selections(root.subfields);
    const arg = root.arguments as {
      limit?: number;
      offset?: number;
      where?: Record<string, unknown>;
      order_by?: Record<string, string>;
    };
    const where: string[] = [];
    if (arg.where)
      where.push(...mapper.where(arg.where));
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
