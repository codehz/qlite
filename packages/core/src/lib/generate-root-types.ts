/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDirective } from '@graphql-tools/utils';
import {
  DefinitionNode,
  FieldDefinitionNode,
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFieldConfig,
  GraphQLFloat,
  GraphQLInputFieldConfig,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLInt,
  GraphQLList,
  GraphQLNamedType,
  GraphQLNonNull,
  GraphQLNullableType,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLScalarType,
  GraphQLSchema,
  InputValueDefinitionNode,
  Kind,
  ListTypeNode,
  NamedTypeNode,
  NameNode,
  NonNullTypeNode,
  TypeNode,
} from 'graphql';
import { getColumns, getRelations } from './internals/utils.js';

const OrderBy = new GraphQLEnumType({
  name: 'order_by',
  values: {
    asc: { description: 'in ascending order, nulls last' },
    asc_nulls_first: { description: 'in ascending order, nulls first' },
    asc_nulls_last: { description: 'in ascending order, nulls last' },
    desc: { description: 'in descending order, nulls last' },
    desc_nulls_first: { description: 'in descending order, nulls first' },
    desc_nulls_last: { description: 'in descending order, nulls last' },
  },
});

type GeneratorContext = {
  queries: [string, GraphQLFieldConfig<any, any>][];
  mutations: [string, GraphQLFieldConfig<any, any>][];
  types: Record<string, GraphQLNamedType>;
  extended: DefinitionNode[];
};

export function generateRootTypes(schema: GraphQLSchema) {
  const queries: [string, GraphQLFieldConfig<any, any>][] = [];
  const mutations: [string, GraphQLFieldConfig<any, any>][] = [];
  const types: Record<string, GraphQLNamedType> = {};
  const extended: DefinitionNode[] = [];
  const ctx = {
    queries,
    mutations,
    types,
    extended,
  };
  for (const item of Object.values(schema.getTypeMap())) {
    if (item instanceof GraphQLObjectType) {
      const entity = getDirective(schema, item, 'entity')?.[0] as
        | { exported: boolean }
        | undefined;
      if (entity) {
        generateRootType(entity, item, schema, ctx);
      }
    }
  }
  const Query = new GraphQLObjectType({
    name: 'Query',
    fields: Object.fromEntries(queries),
  });
  const Mutation = new GraphQLObjectType({
    name: 'Mutation',
    fields: Object.fromEntries(mutations),
  });
  const output = new GraphQLSchema({
    directives: schema.getDirectives(),
    types: [
      ...Object.values(schema.getTypeMap()),
      Query,
      Mutation,
      ...Object.values(types),
    ],
  });
  return [output, extended] as const;
}

function getComparisonExp(
  type: GraphQLOutputType,
  types: Record<string, GraphQLNamedType>
): GraphQLInputObjectType {
  if (type instanceof GraphQLNonNull) {
    const inner = type.ofType;
    return getComparisonExp(inner, types);
  }
  if (type instanceof GraphQLScalarType) {
    const name = type.name + '_comparison_exp';
    if (name in types) return types[name] as GraphQLInputObjectType;
    return (types[name] = new GraphQLInputObjectType({
      name,
      fields: {
        _eq: { type },
        _neq: { type },
        _gt: { type },
        _gte: { type },
        _lt: { type },
        _lte: { type },
        _in: { type: new GraphQLList(new GraphQLNonNull(type)) },
        _nin: { type: new GraphQLList(new GraphQLNonNull(type)) },
        _is_null: { type: GraphQLBoolean },
      },
    }));
  }
  throw new Error('invalid comparison exp');
}

function mkname(name: string): NameNode {
  return { kind: Kind.NAME, value: name };
}

function addTypes(
  types: Record<string, GraphQLNamedType>,
  value: GraphQLNamedType
) {
  types[value.name] = value;
}

type NameMapType<T extends string> = {
  [input in T]: <S extends string>(name: S) => `${S}_${T}`;
};

const NameMap = new Proxy(
  {},
  {
    get(_, p: string) {
      return (name: string) => name + '_' + p;
    },
  }
) as NameMapType<
  | 'bool_exp'
  | 'order_by'
  | 'select_column'
  | 'mutation_response'
  | 'insert_input'
  | 'on_conflict'
  | 'conflict_target'
  | 'set_input'
  | 'pk_columns_input'
  | 'updates'
  | 'min_fields'
  | 'max_fields'
  | 'avg_fields'
  | 'sum_fields'
  | 'aggregate_fields'
  | 'aggregate'
>;

function isTypeOrNonNull(x: GraphQLOutputType, y: GraphQLNullableType) {
  if (x === y) return true;
  else if (x instanceof GraphQLNonNull) return x.ofType === y;
  return false;
}

function isNotEmptyObject(x: GraphQLObjectType) {
  return !!Object.keys(x.getFields()).length;
}

function generateRootType(
  entity: { exported: boolean },
  item: GraphQLObjectType,
  schema: GraphQLSchema,
  { queries, mutations, types, extended }: GeneratorContext
) {
  const columns = getColumns(item, schema);
  const bool_exp: GraphQLInputObjectType = new GraphQLInputObjectType({
    name: NameMap.bool_exp(item.name),
    fields: () => ({
      _and: { type: new GraphQLList(new GraphQLNonNull(bool_exp)) },
      _or: { type: new GraphQLList(new GraphQLNonNull(bool_exp)) },
      _not: { type: bool_exp },
      ...Object.fromEntries(
        columns.map((x) => [x.name, { type: getComparisonExp(x.type, types) }])
      ),
    }),
    description: `Boolean expression to filter rows from the table ${item.name}. All fields are combined with a logical 'AND'.`,
  });
  addTypes(types, bool_exp);
  const order_by: GraphQLInputObjectType = new GraphQLInputObjectType({
    name: NameMap.order_by(item.name),
    fields: Object.fromEntries(columns.map((x) => [x.name, { type: OrderBy }])),
    description: `Ordering options when selecting data from ${item.name}`,
  });
  addTypes(types, order_by);
  const select_column: GraphQLEnumType = new GraphQLEnumType({
    name: NameMap.select_column(item.name),
    values: Object.fromEntries(columns.map((x) => [x.name, {}])),
    description: `select columns of table ${item.name}`,
  });
  addTypes(types, select_column);
  const minmaxfields = Object.fromEntries(
    columns.map((x) => [
      x.name,
      {
        type: x.type,
      },
    ])
  );
  const min_fields = new GraphQLObjectType({
    name: NameMap.min_fields(item.name),
    fields: minmaxfields,
    description: `aggregate min on columns`,
  });
  addTypes(types, min_fields);
  const max_fields = new GraphQLObjectType({
    name: NameMap.max_fields(item.name),
    fields: minmaxfields,
    description: `aggregate max on columns`,
  });
  addTypes(types, max_fields);
  const avgsumfields = Object.fromEntries(
    columns
      .filter((x) => isTypeOrNonNull(x.type, GraphQLFloat))
      .map((x) => [
        x.name,
        {
          type: x.type,
        },
      ])
  );
  const avg_fields = new GraphQLObjectType({
    name: NameMap.avg_fields(item.name),
    fields: avgsumfields,
    description: `aggregate avg on columns`,
  });
  if (isNotEmptyObject(avg_fields)) addTypes(types, avg_fields);
  const sum_fields = new GraphQLObjectType({
    name: NameMap.sum_fields(item.name),
    fields: avgsumfields,
    description: `aggregate sum on columns`,
  });
  if (isNotEmptyObject(sum_fields)) addTypes(types, sum_fields);
  const aggregate_fields = new GraphQLObjectType({
    name: NameMap.aggregate_fields(item.name),
    fields: {
      count: {
        type: GraphQLInt,
        args: {
          columns: {
            type: TypeGen.non_null_list(select_column),
          },
          distinct: {
            type: GraphQLBoolean,
          },
        },
      },
      min: {
        type: new GraphQLNonNull(min_fields),
      },
      max: {
        type: new GraphQLNonNull(max_fields),
      },
      ...(isNotEmptyObject(avg_fields)
        ? { avg: { type: new GraphQLNonNull(avg_fields) } }
        : {}),
      ...(isNotEmptyObject(sum_fields)
        ? { sum: { type: new GraphQLNonNull(sum_fields) } }
        : {}),
    },
    description: `aggregate fields of ${item.name}`,
  });
  addTypes(types, aggregate_fields);
  const aggregate = new GraphQLObjectType({
    name: NameMap.aggregate(item.name),
    fields: {
      aggregate: {
        type: aggregate_fields,
      },
      nodes: {
        type: TypeGen.non_null_non_null_list(item),
      },
    },
    description: `aggregate fields of ${item.name}`,
  });
  addTypes(types, aggregate);
  const mutation_response: GraphQLObjectType = new GraphQLObjectType({
    name: NameMap.mutation_response(item.name),
    fields: {
      affected_rows: {
        type: new GraphQLNonNull(GraphQLInt),
        description: 'number of rows affected by the mutation',
      },
      returning: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(item))),
        description: 'data from the rows affected by the mutation',
      },
    },
    description: `response of any mutation on the table ${item.name}`,
  });
  addTypes(types, mutation_response);
  const insert_input = new GraphQLInputObjectType({
    name: NameMap.insert_input(item.name),
    fields: Object.fromEntries(
      columns.map((x) => [
        x.name,
        {
          type: x.type as any as GraphQLInputType,
        } as GraphQLInputFieldConfig,
      ])
    ),
    description: `input type for inserting data into table ${item.name}`,
  });
  addTypes(types, insert_input);
  const conflict_target = new GraphQLInputObjectType({
    name: NameMap.conflict_target(item.name),
    fields: {
      columns: {
        type: TypeGen.non_null_non_null_list(select_column),
      },
      where: {
        type: bool_exp,
      },
    },
    description: `conflict target for table ${item.name}`,
  });
  addTypes(types, conflict_target);
  const on_conflict = new GraphQLInputObjectType({
    name: NameMap.on_conflict(item.name),
    fields: {
      target: {
        type: conflict_target,
      },
      update_columns: {
        type: TypeGen.non_null_non_null_list(select_column),
        defaultValue: [],
      },
      where: {
        type: bool_exp,
      },
    },
    description: `on_conflict condition type for table ${item.name}`,
  });
  addTypes(types, on_conflict);
  const set_input = new GraphQLInputObjectType({
    name: NameMap.set_input(item.name),
    fields: Object.fromEntries(
      columns.map((x) => [
        x.name,
        {
          type: x.type as any as GraphQLInputType,
        } as GraphQLInputFieldConfig,
      ])
    ),
    description: `input type for updating data in table ${item.name}`,
  });
  addTypes(types, set_input);
  const updates_fields = {
    _set: {
      type: set_input,
      description: 'sets the columns of the filtered rows to the given values',
    },
    where: {
      type: bool_exp,
      description: 'filter the rows which have to be updated',
    },
  };
  const updates = new GraphQLInputObjectType({
    name: NameMap.updates(item.name),
    fields: updates_fields,
  });
  addTypes(types, updates);
  const pks = columns.filter((x) => !!x.primary_key);
  let pk_columns_input: GraphQLInputObjectType;
  if (pks.length) {
    pk_columns_input = new GraphQLInputObjectType({
      name: NameMap.pk_columns_input(item.name),
      fields: Object.fromEntries(
        pks.map((x) => [
          x.name,
          {
            type: x.type as any as GraphQLInputType,
          } as GraphQLInputFieldConfig,
        ])
      ),
      description: `primary key columns input for table: ${item.name}`,
    });
    addTypes(types, pk_columns_input);
  }
  if (entity.exported) {
    const query_args = {
      limit: {
        type: GraphQLInt,
        description: 'limit the number of rows returned',
      },
      offset: {
        type: GraphQLInt,
        description: 'skip the first n rows. Use only with order_by',
      },
      where: {
        type: bool_exp,
        description: 'filter the rows returned',
      },
      order_by: {
        type: order_by,
        description: 'sort the rows by one or more columns',
      },
    };
    queries.push([
      item.name,
      {
        type: TypeGen.non_null_non_null_list(item),
        args: query_args,
        description: `fetch data from the table: ${item.name}`,
      },
    ]);
    queries.push([
      item.name + '_aggregate',
      {
        type: new GraphQLNonNull(aggregate),
        args: query_args,
        description: `fetch aggregated fields from the table: ${item.name}`,
      },
    ]);
    mutations.push([
      `insert_${item.name}`,
      {
        type: mutation_response,
        args: {
          objects: {
            type: TypeGen.non_null_non_null_list(insert_input),
            description: 'the rows to be inserted',
          },
          on_conflict: {
            type: on_conflict,
            description: 'upsert condition',
          },
        },
        description: `insert data into the table: ${item.name}`,
      },
    ]);
    mutations.push([
      `insert_${item.name}_one`,
      {
        type: item,
        args: {
          object: {
            type: new GraphQLNonNull(insert_input),
            description: 'the row to be inserted',
          },
          on_conflict: {
            type: on_conflict,
            description: 'upsert condition',
          },
        },
        description: `insert a single row into the table: ${item.name}`,
      },
    ]);
    mutations.push([
      `delete_${item.name}`,
      {
        type: mutation_response,
        args: {
          where: {
            type: bool_exp,
            description: 'filter the rows which have to be deleted',
          },
        },
        description: `delete data from the table: ${item.name}`,
      },
    ]);
    mutations.push([
      `update_${item.name}`,
      {
        type: mutation_response,
        args: updates_fields,
        description: `update data of the table: ${item.name}`,
      },
    ]);
    mutations.push([
      `update_${item.name}_many`,
      {
        type: new GraphQLList(mutation_response),
        args: {
          updates: {
            type: TypeGen.non_null_non_null_list(updates),
            description: 'updates to execute, in order',
          },
        },
        description: `update multiples rows of table: ${item.name}`,
      },
    ]);
    if (pks.length) {
      queries.push([
        item.name + '_by_pk',
        {
          type: item,
          args: {
            ...Object.fromEntries(
              pks.map((x) => [x.name, { type: x.type as GraphQLInputType }])
            ),
          },
          description: `fetch data from the table: ${item.name} using primary key columns`,
        },
      ]);
      mutations.push([
        `delete_${item.name}_by_pk`,
        {
          type: item,
          args: {
            ...Object.fromEntries(
              pks.map((x) => [x.name, { type: x.type as GraphQLInputType }])
            ),
          },
          description: `delete single row from the table: ${item.name}`,
        },
      ]);
      mutations.push([
        `update_${item.name}_by_pk`,
        {
          type: item,
          args: {
            _set: {
              type: set_input,
              description:
                'sets the columns of the filtered rows to the given values',
            },
            pk_columns: {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              type: pk_columns_input!,
              description: 'filter the rows which have to be updated',
            },
          },
          description: `update single row of the table: ${item.name}`,
        },
      ]);
    }
  }
  const relations = getRelations(item, schema);
  if (relations) {
    const fields: FieldDefinitionNode[] = [];
    for (const relation of relations) {
      const name = relation.name ?? relation.target;
      if (relation.type === 'object') {
        fields.push({
          kind: Kind.FIELD_DEFINITION,
          name: mkname(name),
          type: AstType.named(relation.target),
        });
      } else if (relation.type === 'array') {
        fields.push({
          kind: Kind.FIELD_DEFINITION,
          name: mkname(name),
          arguments: generateInputValueDefinitionsAst({
            limit: AstType.named('Int', 'limit the number of rows returned'),
            offset: AstType.named(
              'Int',
              'skip the first n rows. Use only with order_by'
            ),
            where: AstType.named(
              NameMap.bool_exp(relation.target),
              'filter the rows returned'
            ),
            order_by: AstType.named(
              NameMap.order_by(relation.target),
              'sort the rows by one or more columns'
            ),
          }),
          type: AstType.non_null(
            AstType.non_null_list(AstType.named(relation.target))
          ),
        });
      }
    }
    extended.push({
      name: { kind: Kind.NAME, value: item.name },
      kind: Kind.OBJECT_TYPE_EXTENSION,
      fields,
    });
  }
}

const TypeGen = {
  non_null_non_null_list<T extends GraphQLNullableType>(type: T) {
    return new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(type)));
  },
  non_null_list<T extends GraphQLNullableType>(type: T) {
    return new GraphQLList(new GraphQLNonNull(type));
  },
};

type MaybeDescription = { description?: string };

const AstType = {
  named(name: string, description?: string): NamedTypeNode & MaybeDescription {
    return {
      kind: Kind.NAMED_TYPE,
      name: mkname(name),
      description,
    };
  },
  non_null(
    type: NamedTypeNode | ListTypeNode,
    description?: string
  ): NonNullTypeNode & MaybeDescription {
    return {
      kind: Kind.NON_NULL_TYPE,
      type,
      description,
    };
  },
  list(type: TypeNode, description?: string): ListTypeNode & MaybeDescription {
    return {
      kind: Kind.LIST_TYPE,
      type,
      description,
    };
  },
  non_null_list(
    type: NamedTypeNode | ListTypeNode,
    description?: string
  ): ListTypeNode & MaybeDescription {
    return AstType.list(AstType.non_null(type), description);
  },
};

function generateInputValueDefinitionsAst(
  input: Record<string, TypeNode & MaybeDescription>
): InputValueDefinitionNode[] {
  return Object.entries(input).map(
    ([k, { description, ...type }]): InputValueDefinitionNode => ({
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: mkname(k),
      type,
      description: description
        ? {
            kind: Kind.STRING,
            value: description,
          }
        : undefined,
    })
  );
}
