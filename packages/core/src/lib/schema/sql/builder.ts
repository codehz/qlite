import {
  QLiteConfig,
  QLitePrimitiveTypeName,
  QLiteTableConfig,
} from '../../config.js';
import { FieldInfo } from '../../selection-utils.js';
import {
  fmt,
  JsonSelections,
  MaybeArray,
  normalizeInputArray,
  resolveSqlCastType,
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
  clone(): SQLMapper {
    return new SQLMapper(
      this.config,
      this.typename,
      this.table,
      this.alias,
      this.params.clone()
    );
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
        switch (resolved.type) {
          case 'boolean':
            json.add(
              field.name,
              fmt`json(iif(%q.%q, 'true', 'false'))`(
                this.alias,
                resolved.dbname ?? field.name
              )
            );
            break;
          case 'json':
            json.add(
              field.name,
              fmt`json(%q.%q)`(this.alias, resolved.dbname ?? field.name)
            );
            break;
          default:
            json.add(
              field.name,
              fmt`CAST(%q.%q AS %s)`(
                this.alias,
                resolved.dbname ?? field.name,
                resolveSqlCastType(resolved.type)
              )
            );
        }
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
    const handlers: Record<string, (l: string, r: unknown) => string> = {
      _in: (l, r) =>
        fmt`EXISTS (SELECT 1 FROM json_each(%?) WHERE value = %s)`(
          this.params.add(normalizeInputArray(r) ?? []),
          l
        ),
      _nin: (l, r) =>
        fmt`NOT EXISTS (SELECT 1 FROM json_each(%?) WHERE value = %s)`(
          this.params.add(normalizeInputArray(r) ?? []),
          l
        ),
      _is_null: (l, r) => fmt`%s ISNULL = NOT NOT %?`(l, this.params.add(r)),
      _at: (l, r) => {
        const { _path, ...rest } = r as { _path: string } & Record<
          QLitePrimitiveTypeName,
          Record<string, unknown>
        >;
        const queue: string[] = [];
        for (const [key, value] of Object.entries(rest)) {
          const exp =
            key === 'json'
              ? fmt`%s -> %t`(l, _path)
              : fmt`CAST(%s ->> %t AS %s)`(
                  l,
                  _path,
                  resolveSqlCastType(key as QLitePrimitiveTypeName)
                );
          queue.push(...this.#where_exprs(exp, value));
        }
        return queue.filter(Boolean).join(' AND ');
      },
      _length: (l, r) =>
        this.#where_exprs(
          fmt`json_array_length(%s)`(l),
          r as Record<string, unknown>
        ).join(' AND '),
      _has_key: (l, r) =>
        fmt`EXISTS (SELECT 1 FROM json_each(%s) WHERE key = %?)`(
          l,
          this.params.add(r)
        ),
      _has_keys_all: (l, r) =>
        fmt`NOT EXISTS (SELECT 1 FROM json_each(%?) AS "$inp" LEFT JOIN json_each(%s) AS "$src" ON "$src".key = "$inp".value WHERE "$src".key IS NULL)`(
          this.params.add(normalizeInputArray(r) ?? []),
          l
        ),
      _has_keys_any: (l, r) =>
        fmt`EXISTS (SELECT 1 FROM json_each(%s) AS "$src" WHERE EXISTS (SELECT 1 FROM json_each(%?) AS "$inp" WHERE "$src".key = "$inp".value))`(
          l,
          this.params.add(normalizeInputArray(r) ?? [])
        ),
      _contains: (l, r) =>
        fmt`NOT EXISTS (WITH %s, %s %s)`(
          fmt`"$src" AS (SELECT type,fullkey,(CASE type WHEN 'object' THEN '{}' WHEN 'array' THEN '[]' WHEN 'null' THEN 'null' ELSE value END) AS value FROM json_tree(%s))`(
            l
          ),
          fmt`"$inp" AS (SELECT type,fullkey,(CASE type WHEN 'object' THEN '{}' WHEN 'array' THEN '[]' WHEN 'null' THEN 'null' ELSE value END) AS value FROM json_tree(%?))`(
            this.params.add(r)
          ),
          `SELECT 1 FROM "$inp" LEFT JOIN "$src" ON "$src".fullkey = "$inp".fullkey WHERE "$src".type IS NULL OR "$src".type != "$inp".type OR "$src".value != "$inp".value`
        ),
      _contained_in: (l, r) =>
        fmt`NOT EXISTS (WITH %s, %s %s)`(
          fmt`"$src" AS (SELECT type,fullkey,(CASE type WHEN 'object' THEN '{}' WHEN 'array' THEN '[]' WHEN 'null' THEN 'null' ELSE value END) AS value FROM json_tree(%s))`(
            l
          ),
          fmt`"$inp" AS (SELECT type,fullkey,(CASE type WHEN 'object' THEN '{}' WHEN 'array' THEN '[]' WHEN 'null' THEN 'null' ELSE value END) AS value FROM json_tree(%?))`(
            this.params.add(r)
          ),
          `SELECT 1 FROM "$src" LEFT JOIN "$inp" ON "$src".fullkey = "$inp".fullkey WHERE "$inp".type IS NULL OR "$src".type != "$inp".type OR "$src".value != "$inp".value`
        ),
    };
    let bin: string;
    let handler;
    if ((bin = bins[op])) {
      return (l, r) => fmt`%s %s %?`(l, bin, this.params.add(r));
    } else if ((handler = handlers[op])) return handler;
    throw new Error('invalid cond ' + op);
  }
  #where_exprs(left: string, value: Record<string, unknown>): string[] {
    return Object.entries(value).map(([type, value]) => {
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
                fmt`%q.%q`(this.alias, matched.dbname ?? key),
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

  update(arg: Record<string, unknown>) {
    const updates: string[] = [];
    for (const [method, obj] of Object.entries(arg)) {
      if (!method.startsWith('_')) continue;
      switch (method) {
        case '_set':
          for (const [key, value] of Object.entries(
            obj as Record<string, unknown>
          )) {
            const columnname = this.table.columns[key].dbname ?? key;
            updates.push(fmt`%q = %?`(columnname, this.params.add(value)));
          }
          break;
        case '_inc':
          for (const [key, value] of Object.entries(
            obj as Record<string, unknown>
          )) {
            const columnname = this.table.columns[key].dbname ?? key;
            updates.push(
              fmt`%q = %q.%q + %?`(
                columnname,
                this.tablename,
                columnname,
                this.params.add(value)
              )
            );
          }
          break;
        case '_remove':
        case '_patch':
          for (const [key, value] of Object.entries(
            obj as Record<string, unknown>
          )) {
            const columnname = this.table.columns[key].dbname ?? key;
            updates.push(
              fmt`%q = json${method}(%q.%q, %?)`(
                columnname,
                this.tablename,
                columnname,
                this.params.add(value)
              )
            );
          }
          break;
        case '_insert_path':
        case '_replce_path':
        case '_set_path':
          for (const [key, value] of Object.entries(
            obj as Record<string, unknown>
          )) {
            const columnname = this.table.columns[key].dbname ?? key;
            updates.push(
              fmt`%q = json${method.replace(
                /_path$/,
                ''
              )}(%q.%q, %?, json(%?))`(
                columnname,
                this.tablename,
                columnname,
                this.params.add((value as { path: string }).path),
                this.params.add(
                  JSON.stringify((value as { value: unknown }).value)
                )
              )
            );
          }
          break;
      }
    }
    return updates.join(', ');
  }

  on_conflict(
    conflicts: {
      target?: {
        columns: MaybeArray<string>;
        where?: Record<string, unknown>;
      };
      update_columns: MaybeArray<string>;
      where?: Record<string, unknown>;
    }[]
  ) {
    const queue: string[] = [];
    for (const { target, update_columns, where } of conflicts) {
      queue.push('ON CONFLICT');
      if (target) {
        const columns = (normalizeInputArray(target.columns) ?? [])
          .map((x) => this.table.columns[x].dbname ?? x)
          .join(', ');
        queue.push(fmt`(%s)`(columns));
        if (target.where) {
          queue.push(fmt`WHERE %s`(this.where(target.where)));
        }
      }
      queue.push('DO');
      const columns = normalizeInputArray(update_columns);
      if (columns) {
        queue.push('UPDATE SET');
        queue.push(
          columns
            .map((x) => this.table.columns[x].dbname ?? x)
            .map((x) => fmt`%q = excluded.%q`(x, x))
            .join(', ')
        );
        if (where) queue.push(fmt`WHERE %s`(this.where(where)));
      } else {
        queue.push('NOTHING');
      }
    }
    return queue.filter(Boolean).join(' ');
  }
}

export type SQLQuery = [
  sql: string,
  parameters: unknown[],
  returning?: boolean
];
export type SQLQueryMany = [
  tasks: [sql: string, parameters: unknown[]][],
  returning?: boolean
];

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

export function buildDelete(
  config: QLiteConfig,
  typename: string,
  table: QLiteTableConfig,
  root: FieldInfo
): SQLQuery {
  const mapper = new SQLMapper(config, typename, table);
  let returning;
  for (const field of root.subfields) {
    if (field.name === 'returning') {
      returning = mapper.selections(field.subfields);
    }
  }
  const sql = [
    fmt`DELETE %s`(mapper.from),
    fmt`WHERE %s`(
      mapper.where((root.arguments as { where: Record<string, unknown> }).where)
    ),
    trueMap(returning, fmt`RETURNING %s AS value`),
  ]
    .filter(Boolean)
    .join(' ');
  return [sql, mapper.params.array, !!returning];
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

export function buildInsertOne(
  config: QLiteConfig,
  typename: string,
  table: QLiteTableConfig,
  root: FieldInfo
): SQLQuery {
  const mapper = new SQLMapper(config, typename, table);
  const json = mapper.selections(root.subfields);
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
  const column_template = [];
  const values = [];
  for (const [key, value] of Object.entries(args.object)) {
    let resolved;
    if ((resolved = mapper.table.columns[key])) {
      const columnname = resolved.dbname ?? key;
      column_template.push(columnname);
      values.push(fmt`%?`(mapper.params.add(value)));
    } else {
      throw new Error('not implemented');
    }
  }
  const sql = [
    fmt`INSERT INTO %q`(mapper.tablename),
    ...(column_template.length
      ? [
          fmt`(%s) VALUES (%s)`(column_template.join(', '), values.join(', ')),
          trueMap(normalizeInputArray(args.on_conflict), (conflicts) =>
            mapper.on_conflict(conflicts)
          ),
        ]
      : ['DEFAULT VALUES']),
    fmt`RETURNING %s AS value`(json),
  ]
    .filter(Boolean)
    .join(' ');
  return [sql, mapper.params.array];
}

export function buildInsert(
  config: QLiteConfig,
  typename: string,
  table: QLiteTableConfig,
  root: FieldInfo
): SQLQuery {
  const mapper = new SQLMapper(config, typename, table);
  const args = root.arguments as {
    objects: MaybeArray<Record<string, unknown>>;
    on_conflict: MaybeArray<{
      target?: {
        columns: MaybeArray<string>;
        where?: Record<string, unknown>;
      };
      update_columns: MaybeArray<string>;
      where?: Record<string, unknown>;
    }>;
  };
  const objects = normalizeInputArray(args.objects) ?? [];
  if (!objects) throw new Error('invalid insert');
  const column_set = new Set<string>();
  for (const object of objects) {
    for (const key of Object.keys(object)) {
      column_set.add(key);
    }
  }
  const insert_columns = [];
  const select_columns = [];
  for (const key of column_set) {
    insert_columns.push(fmt`%q`(mapper.table.columns[key].dbname ?? key));
    select_columns.push(fmt`value ->> %t`(key));
  }
  let returning;
  for (const field of root.subfields) {
    if (field.name === 'returning') {
      returning = mapper.selections(field.subfields);
    }
  }
  const sql = [
    fmt`INSERT INTO %q`(mapper.tablename),
    fmt`(%s)`(insert_columns.join(', ')),
    fmt`SELECT %s FROM json_each(%?)`(
      select_columns.join(', '),
      mapper.params.add(args.objects)
    ),
    trueMap(normalizeInputArray(args.on_conflict), (conflicts) =>
      mapper.on_conflict(conflicts)
    ),
    trueMap(returning, (json) => fmt`RETURNING %s AS value`(json)),
  ]
    .filter(Boolean)
    .join(' ');
  return [sql, mapper.params.array, !!returning];
}

export function buildUpdate(
  config: QLiteConfig,
  typename: string,
  table: QLiteTableConfig,
  root: FieldInfo
): SQLQuery {
  const mapper = new SQLMapper(config, typename, table);
  let returning, where;
  for (const field of root.subfields) {
    if (field.name === 'returning') {
      returning = mapper.selections(field.subfields);
    }
  }
  if ((where = (root.arguments as { where?: Record<string, unknown> }).where)) {
    where = mapper.where(where);
  }
  const setter = mapper.update(root.arguments);
  if (!setter) return ['SELECT 1 WHERE 0', []];
  const sql = [
    fmt`UPDATE %q`(mapper.tablename),
    fmt`SET %s`(setter),
    trueMap(where, fmt`WHERE %s`),
    trueMap(returning, fmt`RETURNING %s AS value`),
  ]
    .filter(Boolean)
    .join(' ');
  return [sql, mapper.params.array, !!returning];
}

export function buildUpdateMany(
  config: QLiteConfig,
  typename: string,
  table: QLiteTableConfig,
  root: FieldInfo
): SQLQueryMany {
  const mapper = new SQLMapper(config, typename, table);
  let returning: JsonSelections | undefined;
  for (const field of root.subfields) {
    if (field.name === 'returning') {
      returning = mapper.selections(field.subfields);
    }
  }
  const arg = root.arguments as {
    updates: MaybeArray<
      Record<string, unknown> & {
        where?: Record<string, unknown>;
      }
    >;
  };
  const updates = normalizeInputArray(arg.updates);
  return [
    updates?.map((update) => {
      const cloned = mapper.clone();
      let where;
      if ((where = update.where)) {
        where = cloned.where(where);
      }
      const setter = cloned.update(update);
      if (!setter) return ['SELECT 1 WHERE 0', []];
      const sql = [
        fmt`UPDATE %q`(cloned.tablename),
        fmt`SET %s`(setter),
        trueMap(where, fmt`WHERE %s`),
        trueMap(returning, fmt`RETURNING %s AS value`),
      ]
        .filter(Boolean)
        .join(' ');
      return [sql, cloned.params.array];
    }) ?? [],
    !!returning,
  ];
}

export function buildUpdateByPk(
  config: QLiteConfig,
  typename: string,
  table: QLiteTableConfig,
  root: FieldInfo
): SQLQuery {
  const mapper = new SQLMapper(config, typename, table);
  const json = mapper.selections(root.subfields);
  const sql = fmt`UPDATE %q SET %s WHERE %s RETURNING %s AS value`(
    mapper.tablename,
    mapper.update(root.arguments),
    mapper.by_pks(
      (root.arguments as { pk_columns: Record<string, unknown> }).pk_columns
    ),
    json
  );
  return [sql, mapper.params.array];
}
