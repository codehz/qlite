/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphQLObjectType, InputValueDefinitionNode, Kind } from 'graphql';
import { getColumns } from '../internals/utils.js';
import { generateAggregate } from './aggregate.js';
import { generateBoolExp } from './bool_exp.js';
import { generateOrderBy } from './order_by.js';
import {
  $,
  Context,
  decodeToTypeNode,
  mkfields,
  mkname,
  mkstr,
} from './utils.js';

export function _generateQueryParams(
  item: GraphQLObjectType<any, any>,
  ctx: Context
) {
  return mkfields<InputValueDefinitionNode>({
    limit: {
      kind: Kind.INPUT_VALUE_DEFINITION,
      type: $.named('Int'),
      description: mkstr(`limit the number of rows returned`),
    },
    offset: {
      kind: Kind.INPUT_VALUE_DEFINITION,
      type: $.named('Int'),
      description: mkstr(`skip the first n rows. Use only with order_by`),
    },
    where: {
      kind: Kind.INPUT_VALUE_DEFINITION,
      type: generateBoolExp(item, ctx),
      description: mkstr(`filter the rows returned`),
    },
    order_by: {
      kind: Kind.INPUT_VALUE_DEFINITION,
      type: generateOrderBy(item, ctx),
      description: mkstr(`sort the rows by one or more columns`),
    },
  });
}

export function generateQuery(item: GraphQLObjectType<any, any>, ctx: Context) {
  ctx.queries.add(item.name, (name) => ({
    kind: Kind.FIELD_DEFINITION,
    name,
    type: $.non_null($.non_null_list($.named(item.name))),
    arguments: _generateQueryParams(item, ctx),
    description: mkstr(`fetch data from the table: ${item.name}`),
  }));
  ctx.queries.add(item.name + '_aggregate', (name) => ({
    kind: Kind.FIELD_DEFINITION,
    name,
    type: $.non_null(generateAggregate(item, ctx)),
    arguments: _generateQueryParams(item, ctx),
    description: mkstr(`fetch aggregated fields from the table: ${item.name}`),
  }));
  const columns = getColumns(item, ctx.schema);
  const pks = columns.filter((x) => x.primary_key);
  if (pks.length) {
    ctx.queries.add(item.name + '_by_pk', (name) => ({
      kind: Kind.FIELD_DEFINITION,
      name,
      type: $.named(item.name),
      arguments: pks.map((x) => ({
        kind: Kind.INPUT_VALUE_DEFINITION as const,
        name: mkname(x.name),
        type: decodeToTypeNode(x.type),
      })),
      description: mkstr(
        `fetch data from the table: ${item.name} using primary key columns`
      ),
    }));
  }
}
