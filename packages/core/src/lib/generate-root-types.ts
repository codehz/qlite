/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDirective } from '@graphql-tools/utils';
import {
  DefinitionNode,
  FieldDefinitionNode,
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFieldConfig,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLInt,
  GraphQLList,
  GraphQLNamedType,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLScalarType,
  GraphQLSchema,
  Kind,
  NameNode,
} from 'graphql';

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
  types: Record<string, GraphQLNamedType>;
  extended: DefinitionNode[];
};

export function generateRootTypes(schema: GraphQLSchema) {
  const queries: [string, GraphQLFieldConfig<any, any>][] = [];
  const types: Record<string, GraphQLNamedType> = {};
  const extended: DefinitionNode[] = [];
  const ctx = {
    queries,
    types,
    extended,
  };
  for (const item of Object.values(schema.getTypeMap())) {
    if (item instanceof GraphQLObjectType) {
      const entity = getDirective(schema, item, 'entity')?.[0] as
        | { exported: boolean }
        | undefined;
      if (entity) {
        generateQuery(entity, item, schema, ctx);
      }
    }
  }
  const Query = new GraphQLObjectType({
    name: 'Query',
    fields: Object.fromEntries(queries),
  });
  const output = new GraphQLSchema({ types: [Query, ...Object.values(types)] });
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

function generateQuery(
  entity: { exported: boolean },
  item: GraphQLObjectType,
  schema: GraphQLSchema,
  { queries, types, extended }: GeneratorContext
) {
  const columns = getColumns(item, schema);
  const bool_exp: GraphQLInputObjectType = new GraphQLInputObjectType({
    name: item.name + '_bool_exp',
    fields: () => ({
      _and: { type: new GraphQLList(new GraphQLNonNull(bool_exp)) },
      _or: { type: new GraphQLList(new GraphQLNonNull(bool_exp)) },
      _not: { type: bool_exp },
      ...Object.fromEntries(
        columns.map((x) => [x.name, { type: getComparisonExp(x.type, types) }])
      ),
    }),
  });
  addTypes(types, bool_exp);
  const order_by: GraphQLInputObjectType = new GraphQLInputObjectType({
    name: item.name + '_order_by',
    fields: Object.fromEntries(columns.map((x) => [x.name, { type: OrderBy }])),
  });
  addTypes(types, order_by);
  const select_column: GraphQLEnumType = new GraphQLEnumType({
    name: item.name + '_select_column',
    values: Object.fromEntries(columns.map((x) => [x.name, {}])),
  });
  addTypes(types, select_column);
  if (entity.exported) {
    queries.push([
      item.name,
      {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(item))),
        args: {
          limit: { type: GraphQLInt },
          offset: { type: GraphQLInt },
          where: { type: bool_exp },
          order_by: { type: order_by },
          distinct_on: {
            type: new GraphQLList(new GraphQLNonNull(select_column)),
          },
        },
      },
    ]);
    const pks = columns.filter((x) => !!x.primary_key);
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
          type: {
            kind: Kind.NAMED_TYPE,
            name: mkname(relation.target),
          },
        });
      } else if (relation.type === 'array') {
        fields.push({
          kind: Kind.FIELD_DEFINITION,
          name: mkname(name),
          arguments: [
            {
              kind: Kind.INPUT_VALUE_DEFINITION,
              name: mkname('limit'),
              type: {
                kind: Kind.NAMED_TYPE,
                name: mkname('Int'),
              },
            },
            {
              kind: Kind.INPUT_VALUE_DEFINITION,
              name: mkname('offset'),
              type: {
                kind: Kind.NAMED_TYPE,
                name: mkname('Int'),
              },
            },
            {
              kind: Kind.INPUT_VALUE_DEFINITION,
              name: mkname('where'),
              type: {
                kind: Kind.NAMED_TYPE,
                name: mkname(relation.target + '_bool_exp'),
              },
            },
            {
              kind: Kind.INPUT_VALUE_DEFINITION,
              name: mkname('order_by'),
              type: {
                kind: Kind.NAMED_TYPE,
                name: mkname(relation.target + '_order_by'),
              },
            },
            {
              kind: Kind.INPUT_VALUE_DEFINITION,
              name: mkname('distinct_on'),
              type: {
                kind: Kind.LIST_TYPE,
                type: {
                  kind: Kind.NON_NULL_TYPE,
                  type: {
                    kind: Kind.NAMED_TYPE,
                    name: mkname(relation.target + '_select_column'),
                  },
                },
              },
            },
          ],
          type: {
            kind: Kind.NON_NULL_TYPE,
            type: {
              kind: Kind.LIST_TYPE,
              type: {
                kind: Kind.NON_NULL_TYPE,
                type: {
                  kind: Kind.NAMED_TYPE,
                  name: mkname(relation.target),
                },
              },
            },
          },
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

function getColumns(item: GraphQLObjectType, schema: GraphQLSchema) {
  return Object.entries(item.getFields()).map(([k, v]) => {
    const dir = getDirective(schema, v, 'column')?.[0];
    return { name: k, type: v.type, ...(dir as { primary_key?: boolean }) };
  });
}

function getRelations(item: GraphQLObjectType, schema: GraphQLSchema) {
  return getDirective(schema, item, 'relation') as
    | undefined
    | {
        type: 'array' | 'object';
        name?: string;
        target: string;
        defintions: { from: string; to: string }[];
      }[];
}
