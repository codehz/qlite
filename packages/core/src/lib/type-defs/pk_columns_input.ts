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

export function generatePkColumnsInput(
  item: GraphQLObjectType<any, any>,
  ctx: Context
) {
  const columns = getColumns(item, ctx.schema);
  return ctx.types.add(SuffixMap.pk_columns_input(item.name), (name) => ({
    kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
    name,
    description: mkstr(`primary key columns input for table: ${item.name}`),
    fields: columns
      .filter((x) => x.primary_key)
      .map((x) => ({
        kind: Kind.INPUT_VALUE_DEFINITION as const,
        name: mkname(x.name),
        type: decodeToTypeNode(x.type),
      })),
  }));
}
