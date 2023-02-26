import { QLiteConfig, QLiteTableConfig } from '../../config.js';
import { FieldInfo } from '../../selection-utils.js';
import {
  fmt,
  JsonSelections,
  normalizeInputArray,
  SQLParameters,
  trueMap,
  trueMap2,
} from './utils.js';

class SQLMapper {
  tablename: string;
  constructor(
    public config: QLiteConfig,
    public typename: string,
    public table: QLiteTableConfig,
    public alias: string = table.dbname ?? typename,
    public params: SQLParameters = new SQLParameters()
  ) {
    this.tablename = table.dbname ?? typename;
  }
  get from() {
    return this.alias === this.tablename
      ? fmt`FROM %q`(this.tablename)
      : fmt`FROM %q AS %q`(this.tablename, this.alias);
  }
  relation(
    name: string,
    relation = this.table.relations[name]
  ): readonly [SQLMapper, string] {
    const basename = fmt`%s.%s`(this.alias, name);
    const submapper = new SQLMapper(
      this.config,
      relation.remote_table,
      this.config.tables[relation.remote_table],
      basename,
      this.params
    );
    return [
      submapper,
      Object.entries(relation.mappings)
        .map(([from, to]) =>
          fmt`%q.%q = %q.%q`(this.alias, from, submapper.alias, to)
        )
        .filter(Boolean)
        .join(' AND '),
    ] as const;
  }
  selections(fields: readonly FieldInfo[]) {
    const json = new JsonSelections();
    for (const field of fields) {
      let resolved;
      if ((resolved = this.table.columns[field.name])) {
        json.add(
          field.name,
          fmt`%q.%q`(this.alias, resolved.dbname ?? field.name)
        );
      } else if ((resolved = this.table.relations[field.name])) {
        const [submapper, where] = this.relation(field.name, resolved);
        const selections = submapper.selections(field.subfields);
        if (resolved.type === 'object') {
          json.add(
            field.name,
            fmt`SELECT %s %s WHERE %s LIMIT 1`(
              selections,
              submapper.from,
              where
            ),
            true
          );
        } else {
          const arg = field.arguments as {
            limit?: number;
            offset?: number;
            where?: Record<string, unknown>;
            order_by?: Record<string, string>;
          };
          const sql = [
            fmt`SELECT json_group_array(%s) AS value`(selections),
            submapper.from,
            fmt`WHERE %s`(
              [where, trueMap(arg.where, (input) => submapper.where(input))]
                .filter(Boolean)
                .join(' AND ')
            ),
            trueMap2(
              arg.order_by,
              (arg) => submapper.order_by(arg),
              (input) => fmt`ORDER BY %s`(input)
            ),
            trueMap(arg.limit, (lim) => fmt`LIMIT %?`(this.params.add(lim))),
            trueMap(arg.offset, (off) => fmt`OFFSET %?`(this.params.add(off))),
          ]
            .filter(Boolean)
            .join(' ');
          json.add$(field.alias, sql, true);
        }
      }
    }
    return json;
  }
  aggregate(fields: readonly FieldInfo[]) {
    const json = new JsonSelections();
    for (const field of fields) {
      if (field.name === 'count') {
        let count_arg = trueMap(
          normalizeInputArray(field.arguments['columns'] as string),
          (columns) =>
            columns
              .map((x) =>
                fmt`%q.%q`(this.alias, this.table.columns[x].dbname ?? x)
              )
              .join(', ')
        );
        if (field.arguments['distinct'] && count_arg)
          count_arg = 'DISTINCT ' + count_arg;
        json.add$(
          field.alias,
          count_arg ? fmt`count(%s)`(count_arg) : `count(*)`
        );
      } else {
        throw new Error('not implemented');
      }
    }
    return json;
  }
  #where_cond(op: string): (l: string, r: unknown) => string {
    const bins = {
      _eq: '=',
      _neq: '!=',
      _gt: '>',
      _gte: '>=',
      _lt: '<',
      _lte: '<=',
      _like: 'LIKE',
      _nlike: 'NOT LIKE',
      _glob: 'GLOB',
      _nglob: 'NOT GLOB',
      _regex: 'REGEXP',
      _nregexp: 'NOT REGEXP',
    } as Record<string, string>;
    let resolved: string;
    if ((resolved = bins[op])) {
      return (l, r) => fmt`%s %s %?`(l, resolved, this.params.add(r));
    } else
      switch (op) {
        case '_in':
          return (l, r) =>
            fmt`EXISTS (SELECT 1 FROM json_each(%?) AS "$" WHERE "$".value = %s)`(
              this.params.add(r),
              l
            );
        case '_nin':
          return (l, r) =>
            fmt`NOT EXISTS (SELECT 1 FROM json_each(%?) AS "$" WHERE "$".value = %s)`(
              this.params.add(r),
              l
            );
        case '_is_null':
          return (l, r) => fmt`%s ISNULL = NOT NOT %?`(l, this.params.add(r));
      }
    throw new Error('invalid cond ' + op);
  }
  #where_exprs(name: string, value: Record<string, unknown>): string[] {
    return Object.entries(value).map(([type, value]) => {
      const left = fmt`%q.%q`(this.alias, name);
      return this.#where_cond(type)(left, value);
    });
  }
  #where(arg: Record<string, unknown>): string[] {
    const conds: string[] = [];
    for (const [key, value] of Object.entries(arg)) {
      switch (key) {
        case '_and':
          conds.push(...this.#where(value as Record<string, unknown>));
          break;
        case '_or':
          conds.push(
            trueMap(this.#where(value as Record<string, unknown>), (x) =>
              fmt`(%s)`(x.join(' OR '))
            )
          );
          break;
        case '_not':
          conds.push(
            trueMap(this.#where(value as Record<string, unknown>), (x) =>
              fmt`NOT (%s)`(x.join(' AND '))
            )
          );
          break;
        default: {
          const matched = this.table.columns[key];
          if (matched) {
            conds.push(
              ...this.#where_exprs(
                matched.dbname ?? key,
                value as Record<string, unknown>
              )
            );
          } else {
            const [submapper, where] = this.relation(key);
            conds.push(
              fmt`EXISTS (SELECT 1 FROM %q AS %q WHERE %s)`(
                submapper.tablename,
                submapper.alias,
                [where, submapper.where(value as Record<string, unknown>)]
                  .filter(Boolean)
                  .join(' AND ')
              )
            );
          }
        }
      }
    }
    return conds.filter(Boolean);
  }
  where(arg: Record<string, unknown>): string {
    return this.#where(arg).join(' AND ');
  }

  #sub_order_by(
    where: string,
    arg: Record<string, unknown>
  ): (readonly [string, string])[] {
    const queue = [] as (readonly [string, string])[];
    for (const [key, value] of Object.entries(arg)) {
      if (typeof value === 'string') {
        const found = this.table.columns[key];
        if (found) {
          const subquery = fmt`SELECT %q.%q FROM %q AS %q WHERE %s`(
            this.alias,
            found.dbname ?? key,
            this.tablename,
            this.alias,
            where
          );
          queue.push([
            fmt`(%s)`(subquery),
            value.replace('_', ' ').toUpperCase(),
          ]);
        }
      } else {
        const [submapper, where] = this.relation(key);
        const subquery_gen = (value: string) =>
          fmt`(SELECT %s %s WHERE %s)`(value, this.from, where);
        queue.push(
          ...submapper
            .#sub_order_by(where, value as Record<string, unknown>)
            .map(([k, v]) => [subquery_gen(k), v] as const)
        );
      }
    }
    return queue;
  }
  order_by(arg: Record<string, unknown>): string {
    const queue = [] as string[];
    for (const [key, value] of Object.entries(arg)) {
      if (typeof value === 'string') {
        const found = this.table.columns[key];
        if (found) {
          queue.push(
            fmt`%q.%q %s`(
              this.alias,
              found.dbname ?? key,
              value.replace('_', ' ').toUpperCase()
            )
          );
        }
      } else {
        const [submapper, where] = this.relation(key);
        queue.push(
          ...submapper
            .#sub_order_by(where, value as Record<string, unknown>)
            .map((x) => x.join(' '))
        );
      }
    }
    return queue.join(', ');
  }

  by_pks(arg: Record<string, unknown>): string {
    const where: string[] = [];
    for (const [key, value] of Object.entries(arg)) {
      const columnname = this.table.columns[key].dbname ?? key;
      where.push(
        fmt`%q.%q = %?`(this.alias, columnname, this.params.add(value))
      );
    }
    return where.join(' AND ');
  }
}

export type SQLQuery = [sql: string, parameters: unknown[]];

export function buildQuery(
  config: QLiteConfig,
  typename: string,
  table: QLiteTableConfig,
  root: FieldInfo
): SQLQuery {
  const arg = root.arguments as {
    limit?: number;
    offset?: number;
    where?: Record<string, unknown>;
    order_by?: Record<string, string>;
  };
  const mapper = new SQLMapper(config, typename, table);
  const json = mapper.selections(root.subfields);
  const sql = [
    fmt`SELECT %s AS value`(json),
    mapper.from,
    trueMap2(
      arg.where,
      (arg) => mapper.where(arg),
      (input) => fmt`WHERE %s`(input)
    ),
    trueMap2(
      arg.order_by,
      (arg) => mapper.order_by(arg),
      (input) => fmt`ORDER BY %s`(input)
    ),
    trueMap(arg.limit, (lim) => fmt`LIMIT %?`(mapper.params.add(lim))),
    trueMap(arg.offset, (off) => fmt`OFFSET %?`(mapper.params.add(off))),
  ]
    .filter(Boolean)
    .join(' ');
  return [sql, mapper.params.array];
}

export function buildQueryAggregate(
  config: QLiteConfig,
  typename: string,
  table: QLiteTableConfig,
  root: FieldInfo
): SQLQuery {
  const arg = root.arguments as {
    limit?: number;
    offset?: number;
    where?: Record<string, unknown>;
    order_by?: Record<string, string>;
  };
  const mapper = new SQLMapper(config, typename, table);
  let nodes, aggregate;
  for (const field of root.subfields) {
    if (field.name === 'nodes') {
      nodes = mapper.selections(field.subfields);
    } else if (field.name === 'aggregate') {
      aggregate = mapper.aggregate(field.subfields);
    }
  }
  const sql = [
    'SELECT',
    [
      trueMap(nodes, fmt`json_group_array(%s) AS nodes`),
      trueMap(aggregate, fmt`%s AS aggregate`),
    ]
      .filter(Boolean)
      .join(', '),
    mapper.from,
    trueMap2(
      arg.where,
      (arg) => mapper.where(arg),
      (input) => fmt`WHERE %s`(input)
    ),
    trueMap2(
      arg.order_by,
      (arg) => mapper.order_by(arg),
      (input) => fmt`ORDER BY %s`(input)
    ),
    trueMap(arg.limit, (lim) => fmt`LIMIT %?`(mapper.params.add(lim))),
    trueMap(arg.offset, (off) => fmt`OFFSET %?`(mapper.params.add(off))),
  ]
    .filter(Boolean)
    .join(' ');
  return [sql, mapper.params.array];
}

export function buildQueryByPk(
  config: QLiteConfig,
  typename: string,
  table: QLiteTableConfig,
  root: FieldInfo
): SQLQuery {
  const mapper = new SQLMapper(config, typename, table);
  const json = mapper.selections(root.subfields);
  const sql = fmt`SELECT %s AS value %s WHERE %s`(
    json,
    mapper.from,
    mapper.by_pks(root.arguments)
  );
  return [sql, mapper.params.array];
}

export function buildDeleteByPk(
  config: QLiteConfig,
  typename: string,
  table: QLiteTableConfig,
  root: FieldInfo
): SQLQuery {
  const mapper = new SQLMapper(config, typename, table);
  const json = mapper.selections(root.subfields);
  const sql = fmt`DELETE %s WHERE %s RETURNING %s`(
    mapper.from,
    mapper.by_pks(root.arguments),
    json
  );
  return [sql, mapper.params.array];
}
