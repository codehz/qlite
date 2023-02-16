/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  GraphQLFloat,
  GraphQLInt,
  GraphQLObjectType,
  InputValueDefinitionNode,
  Kind,
} from 'graphql';
import { getColumns } from '../internals/utils.js';
import { generateBoolExp } from './bool_exp.js';
import {
  Context,
  decodeToTypeNode,
  flatmap,
  isTypeOrNonNull,
  mkfields,
  mkname,
  mkstr,
  SuffixMap,
} from './utils.js';

export function generateSetInput(
  item: GraphQLObjectType<any, any>,
  ctx: Context
) {
  const columns = getColumns(item, ctx.schema);
  return ctx.types.add(SuffixMap.set_input(item.name))((name) => ({
    kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
    name,
    description: mkstr(`input type for updating data in table ${item.name}`),
    fields: columns.map((x) => ({
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: mkname(x.name),
      type: decodeToTypeNode(x.type),
    })),
  }));
}

export function generateIncInput(
  item: GraphQLObjectType<any, any>,
  ctx: Context
) {
  const columns = getColumns(item, ctx.schema);
  return ctx.types.add_not_empty(SuffixMap.set_input(item.name), (name) => ({
    kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
    name,
    description: mkstr(`input type for updating data in table ${item.name}`),
    fields: columns
      .filter(
        (x) =>
          isTypeOrNonNull(x.type, GraphQLFloat) ||
          isTypeOrNonNull(x.type, GraphQLInt)
      )
      .map((x) => ({
        kind: Kind.INPUT_VALUE_DEFINITION as const,
        name: mkname(x.name),
        type: decodeToTypeNode(x.type),
      })),
  }));
}

export function _generateBaseUpdatesFields(
  item: GraphQLObjectType<any, any>,
  ctx: Context
): Record<string, Omit<InputValueDefinitionNode, 'name'> | undefined> {
  return {
    _set: {
      kind: Kind.INPUT_VALUE_DEFINITION,
      type: generateSetInput(item, ctx),
    },
    _inc: flatmap(generateIncInput(item, ctx), (type) => ({
      kind: Kind.INPUT_VALUE_DEFINITION,
      type,
    })),
  };
}
export function _generateUpdatesFields(
  item: GraphQLObjectType<any, any>,
  ctx: Context
): Record<string, Omit<InputValueDefinitionNode, 'name'> | undefined> {
  return {
    ..._generateBaseUpdatesFields(item, ctx),
    where: {
      kind: Kind.INPUT_VALUE_DEFINITION,
      type: generateBoolExp(item, ctx),
    },
  };
}

export function generateUpdates(
  item: GraphQLObjectType<any, any>,
  ctx: Context
) {
  return ctx.types.add(SuffixMap.updates(item.name))((name) => ({
    kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
    name,
    fields: mkfields(_generateUpdatesFields(item, ctx)),
  }));
}
