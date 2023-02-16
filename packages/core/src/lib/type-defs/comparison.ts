import {
  GraphQLOutputType,
  TypeNode,
  GraphQLNonNull,
  GraphQLScalarType,
  Kind,
} from 'graphql';
import { Context, SuffixMap, mkfields, $ } from './utils.js';

export function generateComparisonType(
  type: GraphQLOutputType,
  ctx: Context
): TypeNode {
  if (type instanceof GraphQLNonNull) {
    const inner = type.ofType;
    return generateComparisonType(inner, ctx);
  }
  if (type instanceof GraphQLScalarType) {
    return ctx.types.add(SuffixMap.comparison_exp(type.name))((name) => ({
      kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
      name,
      fields: mkfields({
        _eq: {
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: $.named(type.name),
        },
        _neq: {
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: $.named(type.name),
        },
        _gt: {
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: $.named(type.name),
        },
        _gte: {
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: $.named(type.name),
        },
        _lt: {
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: $.named(type.name),
        },
        _lte: {
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: $.named(type.name),
        },
        _in: {
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: $.non_null_list($.named(type.name)),
        },
        _nin: {
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: $.non_null_list($.named(type.name)),
        },
        _is_null: {
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: $.named('Boolean'),
        },
      }),
    }));
  }
  throw new Error('invalid type for comparison: ' + type);
}
