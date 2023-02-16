/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphQLObjectType, Kind } from 'graphql';
import { generateAggregateFields } from './aggregate_fields.js';
import { $, Context, mkfields, mkstr, SuffixMap } from './utils.js';

export function generateAggregate(
  item: GraphQLObjectType<any, any>,
  ctx: Context
) {
  return ctx.types.add(SuffixMap.aggregate(item.name))((name) => ({
    kind: Kind.OBJECT_TYPE_DEFINITION,
    name,
    description: mkstr(`aggregated selection of ${item.name}`),
    fields: mkfields({
      aggregate: {
        kind: Kind.FIELD_DEFINITION,
        type: generateAggregateFields(item, ctx),
      },
      nodes: {
        kind: Kind.FIELD_DEFINITION,
        type: $.non_null($.non_null_list($.named(item.name))),
      },
    }),
  }));
}
