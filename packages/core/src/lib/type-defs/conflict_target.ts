/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphQLObjectType, Kind } from 'graphql';
import { generateBoolExp } from './bool_exp.js';
import { Context, mkfields, mkstr, SuffixMap, $ } from './utils.js';

export function generateConflictTarget(
  item: GraphQLObjectType<any, any>,
  ctx: Context
) {
  return ctx.types.add(SuffixMap.conflict_target(item.name), (name) => ({
    kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
    name,
    description: mkstr(`conflict target for table ${item.name}`),
    fields: mkfields({
      columns: {
        kind: Kind.INPUT_VALUE_DEFINITION,
        type: $.non_null($.non_null_list(generateBoolExp(item, ctx))),
      },
      where: {
        kind: Kind.INPUT_VALUE_DEFINITION,
        type: generateBoolExp(item, ctx),
      },
    }),
  }));
}
