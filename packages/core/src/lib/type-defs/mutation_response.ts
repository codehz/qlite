/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphQLObjectType, Kind } from 'graphql';
import { $, Context, mkfields, mkstr, SuffixMap } from './utils.js';

export function generateMutationResponse(
  item: GraphQLObjectType<any, any>,
  ctx: Context
) {
  return ctx.types.add(SuffixMap.aggregate(item.name), (name) => ({
    kind: Kind.OBJECT_TYPE_DEFINITION,
    name,
    fields: mkfields({
      affected_rows: {
        kind: Kind.FIELD_DEFINITION,
        description: mkstr(`number of rows affected by the mutation`),
        type: $.non_null($.named('Int')),
      },
      returning: {
        kind: Kind.FIELD_DEFINITION,
        description: mkstr(`data from the rows affected by the mutation`),
        type: $.non_null($.non_null_list($.named(item.name))),
      },
    }),
  }));
}
