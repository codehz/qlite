/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphQLObjectType, Kind } from 'graphql';
import { getRelations } from '../internals/utils.js';
import { _generateQueryParams } from './query.js';
import { $, Context, mkname } from './utils.js';

export function generateRelationFields(
  item: GraphQLObjectType<any, any>,
  ctx: Context
) {
  const relations = getRelations(item, ctx.schema);
  if (!relations) return void 0;
  return ctx.types.add(item.name)((name) => ({
    kind: Kind.OBJECT_TYPE_EXTENSION,
    name,
    fields: relations.map((x) =>
      x.type === 'object'
        ? {
            kind: Kind.FIELD_DEFINITION,
            name: mkname(x.name ?? x.target),
            type: $.named(x.target),
          }
        : {
            kind: Kind.FIELD_DEFINITION,
            name: mkname(x.name ?? x.target),
            arguments: _generateQueryParams(
              ctx.schema.getType(x.target) as GraphQLObjectType,
              ctx
            ),
            type: $.non_null($.non_null_list($.named(x.target))),
          }
    ),
  }));
}
