/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphQLObjectType, Kind } from 'graphql';
import { getColumns } from '../internals/utils.js';
import { Context, mkname, mkstr, SuffixMap } from './utils.js';

export function generateSelectColumn(
  item: GraphQLObjectType<any, any>,
  ctx: Context
) {
  const columns = getColumns(item, ctx.schema);
  return ctx.types.add(SuffixMap.select_column(item.name), (name) => ({
    kind: Kind.ENUM_TYPE_DEFINITION,
    name,
    description: mkstr(`select columns of table ${item.name}`),
    values: columns.map((x) => ({
      kind: Kind.ENUM_VALUE_DEFINITION,
      name: mkname(x.name),
    })),
  }));
}
