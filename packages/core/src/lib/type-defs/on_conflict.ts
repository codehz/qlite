/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphQLObjectType, Kind } from 'graphql';
import { generateBoolExp } from './bool_exp.js';
import { generateConflictTarget } from './conflict_target.js';
import { generateSelectColumn } from './select_column.js';
import { Context, mkfields, mkstr, SuffixMap, $ } from './utils.js';

export function generateOnConflict(
  item: GraphQLObjectType<any, any>,
  ctx: Context
) {
  return ctx.types.add(SuffixMap.on_conflict(item.name), (name) => ({
    kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
    name,
    description: mkstr(`on_conflict condition type for table ${item.name}`),
    fields: mkfields({
      target: {
        kind: Kind.INPUT_VALUE_DEFINITION,
        type: generateConflictTarget(item, ctx),
      },
      updated_columns: {
        kind: Kind.INPUT_VALUE_DEFINITION,
        type: $.non_null($.non_null_list(generateSelectColumn(item, ctx))),
        defaultValue: {
          kind: Kind.LIST,
          values: [],
        },
      },
      where: {
        kind: Kind.INPUT_VALUE_DEFINITION,
        type: generateBoolExp(item, ctx),
      },
    }),
  }));
}
