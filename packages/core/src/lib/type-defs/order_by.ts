/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphQLObjectType, NamedTypeNode, Kind } from 'graphql';
import { getColumns, getRelations } from '../internals/utils.js';
import {
  Context,
  SuffixMap,
  mkfields,
  mapvalue,
  flatmap,
  $,
  mkstr,
} from './utils.js';

function genENUM(ctx: Context) {
  return ctx.types.add('order_by', (name) => ({
    kind: Kind.ENUM_TYPE_DEFINITION,
    name,
    values: mkfields({
      asc: {
        kind: Kind.ENUM_VALUE_DEFINITION,
        description: mkstr('in ascending order, nulls last'),
      },
      asc_nulls_first: {
        kind: Kind.ENUM_VALUE_DEFINITION,
        description: mkstr('in ascending order, nulls first'),
      },
      asc_nulls_last: {
        kind: Kind.ENUM_VALUE_DEFINITION,
        description: mkstr('in ascending order, nulls last'),
      },
      desc: {
        kind: Kind.ENUM_VALUE_DEFINITION,
        description: mkstr('in descending order, nulls last'),
      },
      desc_nulls_first: {
        kind: Kind.ENUM_VALUE_DEFINITION,
        description: mkstr('in descending order, nulls first'),
      },
      desc_nulls_last: {
        kind: Kind.ENUM_VALUE_DEFINITION,
        description: mkstr('in descending order, nulls last'),
      },
    }),
  }));
}

export function generateOrderBy(
  item: GraphQLObjectType<any, any>,
  ctx: Context
): NamedTypeNode {
  return ctx.types.add(SuffixMap.order_by(item.name), (name) => {
    const columns = getColumns(item, ctx.schema);
    const relations = getRelations(item, ctx.schema);
    return {
      kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
      name,
      description: mkstr(
        `Ordering options when selecting data from ${item.name}`
      ),
      fields: mkfields({
        ...mapvalue(columns, () => ({
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: genENUM(ctx),
        })),
        ...flatmap(relations, (it) =>
          Object.fromEntries(
            it
              .filter((x) => x.type === 'object')
              .map((x) => [
                x.name ?? x.target,
                {
                  kind: Kind.INPUT_VALUE_DEFINITION,
                  type: $.named(SuffixMap.order_by(x.target)),
                },
              ])
          )
        ),
      }),
    };
  });
}
