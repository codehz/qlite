/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphQLObjectType, Kind } from 'graphql';
import { getColumns } from '../internals/utils.js';
import {
  Context,
  decodeToTypeNode,
  mkname,
  mkstr,
  SuffixMap,
} from './utils.js';

export function generateInsertInput(
  item: GraphQLObjectType<any, any>,
  ctx: Context
) {
  const columns = getColumns(item, ctx.schema);
  return ctx.types.add(SuffixMap.insert_input(item.name), (name) => ({
    kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
    name,
    description: mkstr(`input type for inserting data into table ${item.name}`),
    fields: columns.map((x) => ({
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: mkname(x.name),
      type: decodeToTypeNode(x.type),
    })),
  }));
}
