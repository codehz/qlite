/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphQLFloat, GraphQLInt, GraphQLObjectType, Kind } from 'graphql';
import { getColumns } from '../internals/utils.js';
import { generateSelectColumn } from './select_column.js';
import {
  $,
  Context,
  decodeToTypeNode,
  flatmap,
  isTypeOrNonNull,
  mkfields,
  mkname,
  mkstr,
  SuffixMap,
} from './utils.js';

export function generateAggregateFields(
  item: GraphQLObjectType<any, any>,
  ctx: Context
) {
  return ctx.types.add(SuffixMap.aggregate_fields(item.name))((name) => {
    const columns = getColumns(item, ctx.schema);
    const minmaxfields = columns.map((x) => ({
      kind: Kind.FIELD_DEFINITION as const,
      name: mkname(x.name),
      type: decodeToTypeNode(x.type),
    }));
    const avgsumfields = columns
      .filter(
        (x) =>
          isTypeOrNonNull(x.type, GraphQLFloat) ||
          isTypeOrNonNull(x.type, GraphQLInt)
      )
      .map((x) => ({
        kind: Kind.FIELD_DEFINITION as const,
        name: mkname(x.name),
        type: decodeToTypeNode(x.type),
      }));
    return {
      kind: Kind.OBJECT_TYPE_DEFINITION,
      name,
      description: mkstr(`aggregate fields of ${item.name}`),
      fields: mkfields({
        count: {
          kind: Kind.FIELD_DEFINITION,
          type: $.named('Int'),
          arguments: mkfields({
            columns: {
              kind: Kind.INPUT_VALUE_DEFINITION,
              type: $.non_null_list(generateSelectColumn(item, ctx)),
            },
            distinct: {
              kind: Kind.INPUT_VALUE_DEFINITION,
              type: $.named('Boolean'),
            },
          }),
        },
        min: {
          kind: Kind.FIELD_DEFINITION,
          type: ctx.types.add(SuffixMap.min_fields(item.name))((name) => ({
            kind: Kind.OBJECT_TYPE_DEFINITION,
            name,
            fields: minmaxfields,
            description: mkstr(`aggregate min on columns`),
          })),
        },
        max: {
          kind: Kind.FIELD_DEFINITION,
          type: ctx.types.add(SuffixMap.max_fields(item.name))((name) => ({
            kind: Kind.OBJECT_TYPE_DEFINITION,
            name,
            fields: minmaxfields,
            description: mkstr(`aggregate max on columns`),
          })),
        },
        avg: flatmap(
          ctx.types.add_not_empty(SuffixMap.avg_fields(item.name), (name) => ({
            kind: Kind.OBJECT_TYPE_DEFINITION,
            name,
            fields: avgsumfields,
            description: mkstr(`aggregate avg on columns`),
          })),
          (type) => ({
            kind: Kind.FIELD_DEFINITION,
            type,
          })
        ),
        sum: flatmap(
          ctx.types.add_not_empty(SuffixMap.sum_fields(item.name), (name) => ({
            kind: Kind.OBJECT_TYPE_DEFINITION,
            name,
            fields: avgsumfields,
            description: mkstr(`aggregate sum on columns`),
          })),
          (type) => ({
            kind: Kind.FIELD_DEFINITION,
            type,
          })
        ),
      }),
    };
  });
}
