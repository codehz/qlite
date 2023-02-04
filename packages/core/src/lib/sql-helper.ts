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
  sql: string;
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
    if (arg.where) where.push(mapper.where(arg.where));
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

const SIMPLE_AGGREGATE_FUNCTIONS = ['min', 'max', 'avg', 'sum'];

interface SQLMapperBase {
  readonly type: GraphQLObjectType<any, any>;
  readonly tablename: string;
  readonly namemap: Record<string, string>;
  readonly relations: Record<string, Relation>;
  readonly schema: GraphQLSchema;
  readonly name: string;
}

class SQLMapperInfo implements SQLMapperBase {
  type: GraphQLObjectType<any, any>;
  tablename: string;
  namemap: Record<string, string> = {};
  relations: Record<string, Relation> = {};
  constructor(public schema: GraphQLSchema, public name: string) {
    const type = schema.getType(name);
    if (!type || !(type instanceof GraphQLObjectType))
      throw new Error('invalid type ' + name);
    this.type = type;
    const entity = getDirective(schema, type, 'entity')?.[0];
    if (!entity) throw new Error('invalid entity ' + name);
    this.tablename = entity['name'] ?? name;
    const fields = this.type.getFields();
    for (const [key, value] of Object.entries(fields)) {
      const column = getDirective(this.schema, value, 'column')?.[0];
      if (column) {
        this.namemap[key] = column['name'] ?? key;
      }
    }
    const relations = getRelations(type, schema);
    if (relations) {
      for (const rel of relations) {
        this.relations[rel.name ?? rel.target] = rel;
      }
    }
  }
  static cache = new WeakMap<GraphQLSchema, Record<string, SQLMapperBase>>();
  static getCached(schema: GraphQLSchema, name: string) {
    let storage = SQLMapperInfo.cache.get(schema);
    if (!storage) SQLMapperInfo.cache.set(schema, (storage = {}));
    return storage[name] ?? (storage[name] = new SQLMapperInfo(schema, name));
  }
}

class SQLMapper implements SQLMapperBase {
  readonly tablename!: string;
  readonly type!: GraphQLObjectType;
  readonly namemap!: Record<string, string>;
  readonly relations!: Record<string, Relation>;
  constructor(
    public readonly schema: GraphQLSchema,
    public readonly name: string,
    public readonly alias: string
  ) {
    Object.assign(this, SQLMapperInfo.getCached(schema, name));
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
      if ((resolved = this.namemap[subfield.name])) {
        selections.add(subfield.name, fmt`%q.%q`(this.alias, resolved));
      } else if ((resolved = this.relations[subfield.name])) {
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
    for (const field of queryfields) {
      if (field.name === 'count') {
        let count_arg = trueMap(
          normalizeInputArray(field.arguments['columns'] as string),
          (columns) =>
            columns
              .map((x) => fmt`%q.%q`(this.alias, this.namemap[x]))
              .join(', ')
        );
        if (field.arguments['distinct'] && count_arg)
          count_arg = 'DISTINCT ' + count_arg;
        selections.add$(
          field.alias,
          count_arg ? fmt`count(%s)`(count_arg) : `count(*)`
        );
      } else if (SIMPLE_AGGREGATE_FUNCTIONS.includes(field.name)) {
        const jsonsel = new SQLSelections();
        for (const subfield of field.subfields) {
          const dbname = this.namemap[subfield.name];
          jsonsel.add(subfield.name, fmt`%s(%q)`(field.name, dbname));
        }
        selections.add$(field.alias, fmt`json_object(%s)`(jsonsel.asJSON()));
      }
    }
    return selections;
  }

  where(arg: Record<string, unknown>) {
    return generateWhere(arg, this.alias, this.namemap)
      .filter(Boolean)
      .join(' AND ');
  }
}

export function generateQueryByPk(
  schema: GraphQLSchema,
  root: FieldInfo,
  name: string
): SQLQuery {
  const mapper = new SQLMapper(schema, name, '@' + root.alias);
  const selections = mapper.selections(root.subfields);
  const where: string[] = [];
  const parameters: unknown[] = [];
  for (const [key, value] of Object.entries(root.arguments)) {
    const mapped = mapper.namemap[key];
    where.push(fmt`%q.%q = ?`(mapper.alias, mapped));
    parameters.push(value);
  }
  const sql = fmt`SELECT %s FROM %s WHERE %s`(
    selections.asSelect(),
    mapper.from,
    where.join(', ')
  );
  return { sql, parameters };
}

export function generateQueryAggregate(
  schema: GraphQLSchema,
  root: FieldInfo,
  name: string
): SQLQuery {
  const mapper = new SQLMapper(schema, name, '@' + root.alias);
  const selections = new SQLSelections();
  for (const field of root.subfields) {
    if (field.name === 'nodes') {
      const subsel = mapper.selections(field.subfields);
      selections.add$(
        field.alias,
        fmt`json_group_array(json_object(%s))`(subsel.asJSON())
      );
    } else if (field.name === 'aggregate') {
      const subsel = mapper.aggregate(field.subfields);
      selections.add$(field.alias, fmt`json_object(%s)`(subsel.asJSON()));
    }
  }
  const arg = root.arguments as {
    limit?: number;
    offset?: number;
    where?: Record<string, unknown>;
    order_by?: Record<string, string>;
  };
  let where: string | undefined;
  if (arg.where) where = mapper.where(arg.where);
  const sql = [
    fmt`SELECT %s`(selections.asSelect()),
    fmt`FROM %s`(mapper.from),
    trueMap(where, fmt`WHERE %s`),
    trueMap(arg.order_by, (x) =>
      trueMap(generateOrderBy(x, name), (x) => fmt`ORDER BY %s`(x.join(', ')))
    ),
    trueMap(arg.limit, (x) => fmt`LIMIT %s`(x)),
    trueMap(arg.offset, (x) => fmt`OFFSET %s`(x)),
  ]
    .filter(Boolean)
    .join(' ');
  return { sql, parameters: [] };
}

export function generateQuery(
  schema: GraphQLSchema,
  root: FieldInfo,
  name: string
): SQLQuery {
  const mapper = new SQLMapper(schema, name, '@' + root.alias);
  const selections = mapper.selections(root.subfields);
  const arg = root.arguments as {
    limit?: number;
    offset?: number;
    where?: Record<string, unknown>;
    order_by?: Record<string, string>;
  };
  let where: string | undefined;
  if (arg.where) where = mapper.where(arg.where);
  const sql = [
    fmt`SELECT %s`(selections.asSelect()),
    fmt`FROM %s`(mapper.from),
    trueMap(where, fmt`WHERE %s`),
    trueMap(arg.order_by, (x) =>
      trueMap(generateOrderBy(x, name), (x) => fmt`ORDER BY %s`(x.join(', ')))
    ),
    trueMap(arg.limit, fmt`LIMIT %s`),
    trueMap(arg.offset, fmt`OFFSET %s`),
  ]
    .filter(Boolean)
    .join(' ');
  return { sql, parameters: [] };
}

export function generateInsertOne(
  schema: GraphQLSchema,
  root: FieldInfo,
  name: string
): SQLQuery {
  const mapper = new SQLMapper(schema, name, name);
  const selections = mapper.selections(root.subfields);
  const args = root.arguments as {
    object: Record<string, unknown>;
    on_conflict: MaybeArray<{
      target?: {
        columns: MaybeArray<string>;
        where?: Record<string, unknown>;
      };
      update_columns: MaybeArray<string>;
      where?: Record<string, unknown>;
    }>;
  };
  const column_template: string[] = [];
  const parameters: unknown[] = [];
  for (const [key, value] of Object.entries(args.object)) {
    column_template.push(mapper.namemap[key]);
    parameters.push(value);
  }
  const queue: string[] = [];
  queue.push(fmt`INSERT INTO %q`(name));
  if (column_template.length) {
    queue.push(
      fmt`(%s) VALUES (%s)`(
        column_template.join(', '),
        column_template.map(() => '?').join(', ')
      )
    );
    queue.push(gneerateOnConflict(args.on_conflict, mapper));
  } else {
    queue.push('DEFAULT VALUES');
  }
  queue.push(fmt`RETURNING %s`(selections.asSelect()));
  const sql = queue.filter(Boolean).join(' ');
  return { sql, parameters };
}

export function generateInsert(
  schema: GraphQLSchema,
  root: FieldInfo,
  name: string
): (SQLQuery & { returning: boolean }) | undefined {
  const mapper = new SQLMapper(schema, name, name);
  const args = root.arguments as {
    objects: MaybeArray<Record<string, unknown>>;
    on_conflict: MaybeArray<OnConflict>;
  };
  const objects = normalizeInputArray(args.objects);
  if (!objects) return void 0;
  const column_set = new Set<string>();
  for (const object of objects) {
    for (const key of Object.keys(object)) {
      column_set.add(key);
    }
  }
  const insert_columns: string[] = [];
  const select_columns: string[] = [];
  for (const key of column_set) {
    insert_columns.push(fmt`%q`(mapper.namemap[key]));
    select_columns.push(fmt`value ->> %t`(key));
  }
  const selections = new SQLSelections();
  for (const field of root.subfields) {
    if (field.name === 'returning') {
      selections.merge(mapper.selections(field.subfields));
    }
  }
  const queue: string[] = [];
  queue.push(fmt`INSERT INTO %q`(name));
  queue.push(fmt`(%s)`(insert_columns.join(', ')));
  queue.push(fmt`SELECT %s FROM json_each(?)`(select_columns.join(', ')));
  queue.push(
    trueMap(gneerateOnConflict(args.on_conflict, mapper), fmt`WHERE true %s`)
  );
  if (!selections.empty) {
    queue.push(fmt`RETURNING %s`(selections.asSelect()));
  }
  const sql = queue.filter(Boolean).join(' ');

  return {
    sql,
    parameters: [JSON.stringify(objects)],
    returning: !selections.empty,
  };
}

export function generateDeleteByPk(
  schema: GraphQLSchema,
  root: FieldInfo,
  name: string
): SQLQuery {
  const mapper = new SQLMapper(schema, name, name);
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
  const queue: string[] = [];
  queue.push(fmt`DELETE FROM %q`(name));
  queue.push(fmt`WHERE %s`(where.join(', ')));
  queue.push(fmt`RETURNING %s`(selections.asSelect()));
  const sql = queue.filter(Boolean).join(' ');
  return { sql, parameters };
}

export function generateDelete(
  schema: GraphQLSchema,
  root: FieldInfo,
  name: string
): SQLQuery & { returning: boolean } {
  const mapper = new SQLMapper(schema, name, name);
  const arg = root.arguments as {
    where?: Record<string, unknown>;
  };
  let where: string | undefined;
  if (arg.where) where = mapper.where(arg.where);
  const selections = new SQLSelections();
  for (const field of root.subfields) {
    if (field.name === 'returning') {
      selections.merge(mapper.selections(field.subfields));
    }
  }
  const queue: string[] = [];
  queue.push(fmt`DELETE FROM %q`(name));
  queue.push(trueMap(where, fmt`WHERE %s`));
  if (!selections.empty) {
    queue.push(fmt`RETURNING %s`(selections.asSelect()));
  }
  const sql = queue.filter(Boolean).join(' ');
  return {
    sql,
    parameters: [],
    returning: !selections.empty,
  };
}

export function generateUpdate(
  schema: GraphQLSchema,
  root: FieldInfo,
  name: string
): (SQLQuery & { returning: boolean }) | undefined {
  const mapper = new SQLMapper(schema, name, name);
  const arg = root.arguments as GenericUpdates & {
    _set?: Record<string, unknown>;
    where?: Record<string, unknown>;
  };
  const { setters, parameters } = getUpdates(arg, mapper);
  if (!setters.length) return void 0;
  let where: string | undefined;
  if (arg.where) where = mapper.where(arg.where);
  const selections = new SQLSelections();
  for (const field of root.subfields) {
    if (field.name === 'returning') {
      selections.merge(mapper.selections(field.subfields));
    }
  }
  const queue: string[] = [];
  queue.push(fmt`UPDATE %q SET`(name));
  queue.push(setters.join(', '));
  queue.push(trueMap(where, fmt`WHERE %s`));
  if (!selections.empty) {
    queue.push(fmt`RETURNING %s`(selections.asSelect()));
  }
  const sql = queue.filter(Boolean).join(' ');
  return {
    sql,
    parameters,
    returning: !selections.empty,
  };
}

export function generateUpdateByPk(
  schema: GraphQLSchema,
  root: FieldInfo,
  name: string
): SQLQuery {
  const mapper = new SQLMapper(schema, name, name);
  const arg = root.arguments as GenericUpdates & {
    pk_columns: Record<string, unknown>;
  };
  const { setters, parameters } = getUpdates(arg, mapper);
  const where: string[] = [];
  for (const [key, value] of Object.entries(arg.pk_columns)) {
    const mapped = mapper.namemap[key];
    where.push(fmt`%q.%q = ?`(mapper.alias, mapped));
    parameters.push(value);
  }
  const selections = mapper.selections(root.subfields);
  const queue: string[] = [];
  queue.push(fmt`UPDATE %q SET`(name));
  queue.push(setters.join(', '));
  queue.push(trueMap(where, (x) => fmt`WHERE %s`(x.join(' AND '))));
  queue.push(fmt`RETURNING %s`(selections.asSelect()));
  const sql = queue.filter(Boolean).join(' ');
  return {
    sql,
    parameters,
  };
}

export function generateUpdateMany(
  schema: GraphQLSchema,
  root: FieldInfo,
  name: string
): { tasks: (SQLQuery | undefined)[]; returning: boolean } | undefined {
  const mapper = new SQLMapper(schema, name, name);
  const arg = root.arguments as {
    updates: MaybeArray<
      GenericUpdates & {
        where?: Record<string, unknown>;
      }
    >;
  };
  const updates = normalizeInputArray(arg.updates);
  if (!updates) return undefined;
  const selections = new SQLSelections();
  for (const field of root.subfields) {
    if (field.name === 'returning') {
      selections.merge(mapper.selections(field.subfields));
    }
  }
  return {
    tasks: updates.map((arg) => {
      const { setters, parameters } = getUpdates(arg, mapper);
      if (!setters.length) return void 0;
      let where: string | undefined;
      if (arg.where) where = mapper.where(arg.where);
      const selections = new SQLSelections();
      for (const field of root.subfields) {
        if (field.name === 'returning') {
          selections.merge(mapper.selections(field.subfields));
        }
      }
      const queue: string[] = [];
      queue.push(fmt`UPDATE %q SET`(name));
      queue.push(setters.join(', '));
      queue.push(trueMap(where, fmt`WHERE %s`));
      if (!selections.empty) {
        queue.push(fmt`RETURNING %s`(selections.asSelect()));
      }
      const sql = queue.filter(Boolean).join(' ');
      return { sql, parameters };
    }),
    returning: !selections.empty,
  };
}

type GenericUpdates = Record<'_set' | '_inc', Record<string, unknown>>;

function getUpdates(arg: GenericUpdates, mapper: SQLMapper) {
  const setters: string[] = [];
  const parameters: unknown[] = [];
  if (arg._set)
    for (const [key, value] of Object.entries(arg._set)) {
      setters.push(fmt`%q = ?`(mapper.namemap[key]));
      parameters.push(value);
    }
  if (arg._inc)
    for (const [key, value] of Object.entries(arg._inc)) {
      setters.push(fmt`%q = %q + ?`(mapper.namemap[key], mapper.namemap[key]));
      parameters.push(value);
    }
  return { setters, parameters };
}

type OnConflict = {
  target?: {
    columns: MaybeArray<string>;
    where?: Record<string, unknown>;
  };
  update_columns: MaybeArray<string>;
  where?: Record<string, unknown>;
};

function gneerateOnConflict(input: MaybeArray<OnConflict>, mapper: SQLMapper) {
  const on_conflicts = normalizeInputArray(input);
  const queue: string[] = [];
  if (on_conflicts) {
    for (const cond of on_conflicts) {
      queue.push('ON CONFLICT');
      if (cond.target) {
        const columns = normalizeInputArray(cond.target.columns);
        if (columns) {
          queue.push(fmt`(%s)`(columns.map((x) => fmt`%q`(x)).join(', ')));
          if (cond.where) {
            queue.push(fmt`WHERE %s`(mapper.where(cond.where)));
          }
        }
      }
      queue.push('DO');
      const updates = normalizeInputArray(cond.update_columns);
      if (updates) {
        queue.push('UPDATE SET');
        queue.push(
          updates
            .map((column) => {
              const mapped_name = mapper.namemap[column];
              return fmt`%q = excluded.%q`(mapped_name, mapped_name);
            })
            .join(', ')
        );
        if (cond.where) {
          queue.push(fmt`WHERE %s`(mapper.where(cond.where)));
        }
      } else {
        queue.push('NOTHING');
      }
    }
  }
  return queue.join(' ');
}

type MaybeArray<T> = T | T[];

function normalizeInputArray<T>(x: MaybeArray<T> | undefined): T[] | undefined {
  if (x == null) return void 0;
  if (Array.isArray(x)) return x.length ? x : void 0;
  return [x];
}
