import {
  GraphQLBoolean,
  GraphQLInputFieldConfig,
  GraphQLString,
} from 'graphql';
import { GraphQLEnumType } from 'graphql';
import { GraphQLInputObjectType } from 'graphql';
import {
  GraphQLArgumentConfig,
  GraphQLFieldConfig,
  GraphQLInt,
  GraphQLObjectType,
} from 'graphql';
import { GraphQLJSON } from 'graphql-scalars';
import {
  QLiteConfig,
  QLitePrimitiveTypeName,
  QLiteRelationConfig,
  QLiteTableConfig,
} from '../config.js';
import { SchemaGeneratorContext } from './context.js';
import {
  ListNonNull,
  mapPrimitiveType,
  maybeNonNull,
  NonNull,
  NonNullListNonNull,
} from './types.js';
import {
  mapNonNullObject,
  mapObject,
  notEmptyObject,
  tableColumnsInfo,
} from './utils.js';

export function generateSchema(config: QLiteConfig) {
  const context = new SchemaGeneratorContext();
  generateTables(context, config.tables);
  return context.toSchema();
}

function generateTables(
  ctx: SchemaGeneratorContext,
  tables: Record<string, QLiteTableConfig>
) {
  ctx.addType(
    new GraphQLEnumType({
      name: 'order_by',
      values: {
        asc: { description: 'in ascending order, nulls last' },
        asc_nulls_first: { description: 'in ascending order, nulls first' },
        asc_nulls_last: { description: 'in ascending order, nulls last' },
        desc: { description: 'in descending order, nulls last' },
        desc_nulls_first: { description: 'in descending order, nulls first' },
        desc_nulls_last: { description: 'in descending order, nulls last' },
      },
    })
  );
  ctx.addType(
    new GraphQLInputObjectType({
      name: 'json_mutation_by_path_input',
      fields: {
        path: {
          type: NonNull(GraphQLString),
        },
        value: {
          type: NonNull(GraphQLJSON),
        },
      },
    })
  );
  for (const [key, table] of Object.entries(tables)) {
    const { columns, relations } = table;
    ctx.addType(
      new GraphQLObjectType({
        name: key,
        fields: () => ({
          ...mapObject(
            columns,
            ({ type, not_null, primary_key, comments }) => ({
              type: maybeNonNull(
                mapPrimitiveType(type),
                not_null || primary_key
              ),
              args:
                type === 'json'
                  ? {
                      path: {
                        type: GraphQLString,
                      },
                    }
                  : undefined,
              description: comments,
            })
          ),
          ...mapObject(relations, (value) => generateRelationField(ctx, value)),
        }),
      })
    );
    generateAuxiliary(ctx, key, table);
    generateQuery(ctx, key, table);
    generateMutation(ctx, key, table);
  }
}

function generateAuxiliary(
  ctx: SchemaGeneratorContext,
  typename: string,
  table: QLiteTableConfig
) {
  const {
    columns,
    integer_columns,
    real_columns,
    json_columns,
    sortable_columns,
    pk_fields,
  } = tableColumnsInfo(table);
  ctx.addType(
    new GraphQLInputObjectType({
      name: `${typename}_bool_exp`,
      fields: () => ({
        _and: {
          type: ListNonNull(ctx.getInputType(`${typename}_bool_exp`)),
        },
        _or: {
          type: ListNonNull(ctx.getInputType(`${typename}_bool_exp`)),
        },
        _not: {
          type: ctx.getInputType(`${typename}_bool_exp`),
        },
        ...mapObject(columns, ({ type }) => ({
          type: generateComparisonType(ctx, type),
        })),
        ...mapObject(table.relations, ({ remote_table }) => ({
          type: ctx.getInputType(`${remote_table}_bool_exp`),
        })),
      }),
      description: `Boolean expression to filter rows from the table ${typename}. All fields are combined with a logical 'AND'.`,
    })
  );
  ctx.addType(
    new GraphQLInputObjectType({
      name: `${typename}_order_by`,
      fields: () => ({
        ...mapObject(columns, { type: ctx.getInputType('order_by') }),
        ...mapNonNullObject(table.relations, ({ type, remote_table }) =>
          type === 'array'
            ? null
            : { type: ctx.getInputType(`${remote_table}_order_by`) }
        ),
      }),
      description: `Ordering options when selecting data from table: ${typename}`,
    })
  );
  ctx.addType(
    new GraphQLInputObjectType({
      name: `${typename}_insert_input`,
      fields: () => ({
        ...mapObject(columns, ({ type }) => ({
          type: mapPrimitiveType(type),
        })),
      }),
      description: `input type for inserting data into table: ${typename}`,
    })
  );
  ctx.addType(
    new GraphQLEnumType({
      name: `${typename}_select_column`,
      values: {
        ...mapObject(columns, {}),
      },
    })
  );
  ctx.addType(
    new GraphQLInputObjectType({
      name: `${typename}_conflict_target`,
      fields: () => ({
        columns: {
          type: ListNonNull(ctx.getInputType(`${typename}_select_column`)),
        },
        where: {
          type: ctx.getInputType(`${typename}_bool_exp`),
        },
      }),
      description: `conflict target for table: ${typename}`,
    })
  );
  ctx.addType(
    new GraphQLInputObjectType({
      name: `${typename}_on_conflict`,
      fields: () => ({
        target: {
          type: ctx.getInputType(`${typename}_conflict_target`),
        },
        updated_columns: {
          type: ListNonNull(ctx.getInputType(`${typename}_select_column`)),
        },
        where: {
          type: ctx.getInputType(`${typename}_bool_exp`),
        },
      }),
      description: `on_conflict condition type for table: ${typename}`,
    })
  );
  ctx.addType(
    new GraphQLInputObjectType({
      name: `${typename}_set_input`,
      fields: mapObject(columns, ({ type }) => ({
        type: mapPrimitiveType(type),
      })),
      description: `input type for updating data in table: ${typename}`,
    })
  );
  if (notEmptyObject(integer_columns))
    ctx.addType(
      new GraphQLInputObjectType({
        name: `${typename}_inc_input`,
        fields: mapNonNullObject(columns, ({ type }) =>
          type !== 'integer' && type !== 'real'
            ? null
            : { type: mapPrimitiveType(type) }
        ),
      })
    );
  if (notEmptyObject(json_columns)) {
    for (const kind of ['prepend', 'append', 'patch']) {
      ctx.addType(
        new GraphQLInputObjectType({
          name: `${typename}_json_${kind}_input`,
          fields: mapObject(json_columns, { type: GraphQLJSON }),
        })
      );
    }
    for (const kind of ['insert', 'replace', 'set']) {
      ctx.addType(
        new GraphQLInputObjectType({
          name: `${typename}_json_${kind}_input`,
          fields: mapObject(json_columns, {
            type: ctx.getInputType('json_mutation_by_path_input'),
          }),
        })
      );
    }
    ctx.addType(
      new GraphQLInputObjectType({
        name: `${typename}_json_remove_input`,
        fields: mapObject(json_columns, {
          type: ListNonNull(GraphQLString),
        }),
      })
    );
  }
  ctx.addType(
    new GraphQLInputObjectType({
      name: `${typename}_updates`,
      fields: () => ({
        ...generateUpdateFields(ctx, typename, table),
        where: {
          type: ctx.getInputType(`${typename}_bool_exp`),
        },
      }),
    })
  );
  if (pk_fields)
    ctx.addType(
      new GraphQLInputObjectType({
        name: `${typename}_pk_columns`,
        fields: pk_fields,
        description: `primary key columns input for table: ${typename}`,
      })
    );
  ctx.addType(
    new GraphQLObjectType({
      name: `${typename}_mutation_response`,
      fields: () => ({
        affected_rows: {
          type: NonNull(GraphQLInt),
          description: `number of rows affected by the mutation`,
        },
        returning: {
          type: NonNullListNonNull(ctx.getOutputType(typename)),
          description: `data from the rows affected by the mutation`,
        },
      }),
    })
  );
  ctx.addType(
    new GraphQLObjectType({
      name: `${typename}_aggregate_fields`,
      fields: () => {
        const ret: Record<string, GraphQLFieldConfig<unknown, unknown>> = {
          count: {
            type: NonNull(GraphQLInt),
            args: {
              columns: {
                type: ListNonNull(
                  ctx.getInputType(`${typename}_select_column`)
                ),
              },
              distinct: {
                type: GraphQLBoolean,
              },
            },
          },
        };
        if (notEmptyObject(sortable_columns)) {
          const minmax = ctx.addType(
            new GraphQLObjectType({
              name: `${typename}_minmax_fields`,
              fields: mapObject(sortable_columns, ({ type }) => ({
                type: NonNull(mapPrimitiveType(type)),
              })),
            })
          );
          Object.assign(ret, {
            min: { type: minmax, description: `aggregate min on columns` },
            max: { type: minmax, description: `aggregate max on columns` },
          });
        }
        if (notEmptyObject(real_columns)) {
          const avgsum = ctx.addType(
            new GraphQLObjectType({
              name: `${typename}_avgsum_fields`,
              fields: mapObject(real_columns, ({ type }) => ({
                type: NonNull(mapPrimitiveType(type)),
              })),
            })
          );
          Object.assign(ret, {
            avg: { type: avgsum, description: `aggregate avg on columns` },
            sum: { type: avgsum, description: `aggregate sum on columns` },
          });
        }
        return ret;
      },
      description: `aggregate fields of table: ${typename}`,
    })
  );
  ctx.addType(
    new GraphQLObjectType({
      name: `${typename}_aggregate`,
      fields: () => ({
        aggregate: {
          type: NonNull(ctx.getOutputType(`${typename}_aggregate_fields`)),
        },
        nodes: {
          type: NonNullListNonNull(ctx.getOutputType(typename)),
        },
      }),
      description: `aggregated selection of table: ${typename}`,
    })
  );
}

function generateUpdateFields(
  ctx: SchemaGeneratorContext,
  typename: string,
  table: QLiteTableConfig
): Record<string, GraphQLArgumentConfig & GraphQLInputFieldConfig> {
  const { integer_columns, json_columns } = tableColumnsInfo(table);
  return {
    _set: {
      type: ctx.getInputType(`${typename}_set_input`),
    },
    ...(notEmptyObject(integer_columns)
      ? { _inc: { type: ctx.getInputType(`${typename}_inc_input`) } }
      : {}),
    ...(notEmptyObject(json_columns)
      ? {
          ...Object.fromEntries(
            ['prepend', 'append', 'patch', 'remove'].map((kind) => [
              `_${kind}`,
              { type: ctx.getInputType(`${typename}_json_${kind}_input`) },
            ])
          ),
          ...Object.fromEntries(
            ['set', 'insert', 'replace'].map((kind) => [
              `_${kind}_path`,
              { type: ctx.getInputType(`${typename}_json_${kind}_input`) },
            ])
          ),
        }
      : {}),
  };
}

function generateComparisonType(
  ctx: SchemaGeneratorContext,
  typename: QLitePrimitiveTypeName
): GraphQLInputObjectType {
  const type = mapPrimitiveType(typename);
  const comparison_exp = `${type.name}_comparison_exp`;
  return ctx.addTypeIfNotExists(comparison_exp, () => {
    return new GraphQLInputObjectType({
      name: comparison_exp,
      fields: {
        _eq: { type },
        _neq: { type },
        _gt: { type },
        _gte: { type },
        _lt: { type },
        _lte: { type },
        _in: { type: ListNonNull(type) },
        _nin: { type: ListNonNull(type) },
        _is_null: { type: GraphQLBoolean },
        ...(typename === 'text'
          ? {
              _like: { type: GraphQLString },
              _nlike: { type: GraphQLString },
              _glob: { type: GraphQLString },
              _nglob: { type: GraphQLString },
              _regexp: { type: GraphQLString },
              _nregexp: { type: GraphQLString },
            }
          : {}),
        ...(typename === 'json'
          ? {
              path: {
                type: GraphQLString,
              },
              _cast: {
                type: new GraphQLInputObjectType({
                  name: `JSON_cast_exp`,
                  fields: {
                    _integer: {
                      type: generateComparisonType(ctx, 'integer'),
                    },
                    _real: {
                      type: generateComparisonType(ctx, 'real'),
                    },
                    _text: {
                      type: generateComparisonType(ctx, 'text'),
                    },
                  },
                }),
              },
              _length: {
                type: generateComparisonType(ctx, 'integer'),
              },
              _has_key: {
                type: GraphQLString,
                description:
                  'does the string exist as a top-level key in the column',
              },
              _has_keys_all: {
                type: ListNonNull(GraphQLString),
                description:
                  'do all of these strings exist as top-level keys in the column',
              },
              _has_keys_any: {
                type: ListNonNull(GraphQLString),
                description:
                  'do any of these strings exist as top-level keys in the column',
              },
              _contains: {
                type: GraphQLJSON,
                description:
                  'does the column contain the given json value at the top level',
              },
              _contained_in: {
                type: GraphQLJSON,
                description: 'is the column contained in the given json value',
              },
            }
          : {}),
      },
    });
  });
}

function generateMutation(
  ctx: SchemaGeneratorContext,
  typename: string,
  table: QLiteTableConfig
) {
  const { pk_fields } = tableColumnsInfo(table);
  ctx.addMutation(table.root_fields?.insert ?? `insert_${typename}`, () => ({
    type: ctx.getOutputType(`${typename}_mutation_response`),
    args: {
      objects: {
        type: NonNullListNonNull(ctx.getInputType(`${typename}_insert_input`)),
        description: `the rows to be inserted`,
      },
      on_conflict: {
        type: ListNonNull(ctx.getInputType(`${typename}_on_conflict`)),
        description: `upsert condition`,
      },
    },
    description: `insert data into the table: ${typename}`,
  }));
  ctx.addMutation(
    table.root_fields?.insert_one ?? `insert_${typename}_one`,
    () => ({
      type: ctx.getOutputType(typename),
      args: {
        object: {
          type: NonNull(ctx.getInputType(`${typename}_insert_input`)),
          description: `the row to be inserted`,
        },
        on_conflict: {
          type: ListNonNull(ctx.getInputType(`${typename}_on_conflict`)),
          description: `upsert condition`,
        },
      },
      description: `insert a single row into the table: ${typename}`,
    })
  );
  ctx.addMutation(table.root_fields?.delete ?? `delete_${typename}`, () => ({
    type: ctx.getOutputType(`${typename}_mutation_response`),
    args: {
      where: {
        type: ctx.getInputType(`${typename}_bool_exp`),
        description: `filter the rows which have to be deleted`,
      },
    },
    description: `delete data from the table: ${typename}`,
  }));
  ctx.addMutation(table.root_fields?.update ?? `update_${typename}`, () => ({
    type: ctx.getOutputType(`${typename}_mutation_response`),
    args: {
      // TODO: update fields
    },
    description: `update data of the table: ${typename}`,
  }));
  ctx.addMutation(
    table.root_fields?.update_many ?? `update_${typename}_many`,
    () => ({
      type: NonNullListNonNull(
        ctx.getOutputType(`${typename}_mutation_response`)
      ),
      args: {
        updates: {
          type: NonNullListNonNull(ctx.getInputType(`${typename}_updates`)),
        },
      },
      description: `update multiples rows of table: ${typename}`,
    })
  );
  if (pk_fields) {
    ctx.addMutation(
      table.root_fields?.delete_by_pk ?? `delete_${typename}_by_pk`,
      () => ({
        type: ctx.getOutputType(typename),
        args: pk_fields,
        description: `delete single row from the table: ${typename}`,
      })
    );
    ctx.addMutation(
      table.root_fields?.update_by_pk ?? `update_${typename}_by_pk`,
      () => ({
        type: ctx.getOutputType(typename),
        args: {
          ...generateUpdateFields(ctx, typename, table),
          pk_columns: {
            type: ctx.getInputType(`${typename}_pk_columns`),
          },
        },
        description: `update single row of the table: ${typename}`,
      })
    );
  }
}

function generateQuery(
  ctx: SchemaGeneratorContext,
  typename: string,
  table: QLiteTableConfig
) {
  const { pk_fields } = tableColumnsInfo(table);
  ctx.addQuery(table.root_fields?.select ?? typename, () => ({
    type: NonNullListNonNull(ctx.getOutputType(typename)),
    description: `fetch data from the table: ${typename}`,
    args: generateQueryParams(ctx, typename),
  }));
  ctx.addQuery(
    table.root_fields?.select_aggregate ?? `${typename}_aggregate`,
    () => ({
      type: ctx.getOutputType(`${typename}_aggregate`),
      description: `fetch data from the table: ${typename}`,
      args: generateQueryParams(ctx, typename),
    })
  );
  if (pk_fields)
    ctx.addQuery(
      table.root_fields?.select_by_pk ?? `${typename}_by_pk`,
      () => ({
        type: ctx.getOutputType(typename),
        description: `fetch data from the table: ${typename} using primary key columns`,
        args: pk_fields,
      })
    );
}

function generateRelationField(
  ctx: SchemaGeneratorContext,
  { type, remote_table, comments }: QLiteRelationConfig
): GraphQLFieldConfig<unknown, unknown, unknown> {
  if (type === 'object')
    return {
      type: ctx.getOutputType(remote_table),
      description: comments,
    };
  return {
    type: NonNullListNonNull(ctx.getOutputType(remote_table)),
    description: comments,
    args: generateQueryParams(ctx, remote_table),
  };
}

function generateQueryParams(
  ctx: SchemaGeneratorContext,
  name: string
): Record<string, GraphQLArgumentConfig> {
  return {
    limit: {
      type: GraphQLInt,
      description: 'limit the number of rows returned',
    },
    offset: {
      type: GraphQLInt,
      description: 'skip the first n rows. Use only with order_by',
    },
    where: {
      type: ctx.getInputType(`${name}_bool_exp`),
      description: 'filter the rows returned',
    },
    order_by: {
      type: ctx.getInputType(`${name}_order_by`),
      description: 'sort the rows by one or more columns',
    },
  };
}
