/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphQLObjectType, NamedTypeNode, Kind } from 'graphql';
import { getColumns, getRelations } from '../internals/utils.js';
import { generateComparisonType } from './comparison.js';
import {
  Context,
  SuffixMap,
  mkfields,
  mapvalue,
  $,
  flatmap,
  mkstr,
} from './utils.js';

export function generateBoolExp(
  item: GraphQLObjectType<any, any>,
  ctx: Context
): NamedTypeNode {
  return ctx.types.add(SuffixMap.bool_exp(item.name), (name) => {
    const columns = getColumns(item, ctx.schema);
    const relations = getRelations(item, ctx.schema);
    return {
      kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
      name,
      description: mkstr(
        `Boolean expression to filter rows from the table ${item.name}. All fields are combined with a logical 'AND'.`
      ),
      fields: mkfields({
        _and: {
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: $.non_null_list($.named(name.value)),
        },
        _or: {
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: $.non_null_list($.named(name.value)),
        },
        _not: {
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: $.named(name.value),
        },
        ...mapvalue(columns, (value) => ({
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: generateComparisonType(value.type, ctx),
        })),
        ...flatmap(relations, (it) =>
          Object.fromEntries(
            it.map((x) => [
              x.name ?? x.target,
              {
                kind: Kind.INPUT_VALUE_DEFINITION,
                type: $.named(SuffixMap.bool_exp(x.target)),
              },
            ])
          )
        ),
      }),
    };
  });
}
