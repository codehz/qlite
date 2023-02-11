/* eslint-disable @typescript-eslint/no-explicit-any */
import { GraphQLObjectType, Kind } from 'graphql';
import { getColumns } from '../internals/utils.js';
import { generateBoolExp } from './bool_exp.js';
import { generateInsertInput } from './insert_input.js';
import { generateMutationResponse } from './mutation_response.js';
import { generateOnConflict } from './on_conflict.js';
import { generatePkColumnsInput } from './pk_columns_input.js';
import {
  generateUpdates,
  _generateBaseUpdatesFields,
  _generateUpdatesFields,
} from './updates.js';
import {
  $,
  Context,
  decodeToTypeNode,
  mkfields,
  mkname,
  mkstr,
} from './utils.js';

export function generateMutation(
  item: GraphQLObjectType<any, any>,
  ctx: Context
) {
  const mutation_response = generateMutationResponse(item, ctx);
  ctx.mutations.add(`insert_${item.name}`, (name) => ({
    kind: Kind.FIELD_DEFINITION,
    name,
    type: mutation_response,
    arguments: mkfields({
      objects: {
        kind: Kind.INPUT_VALUE_DEFINITION,
        type: $.non_null($.non_null_list(generateInsertInput(item, ctx))),
        description: mkstr(`the rows to be inserted`),
      },
      on_conflict: {
        kind: Kind.INPUT_VALUE_DEFINITION,
        type: $.non_null_list(generateOnConflict(item, ctx)),
        description: mkstr(`upsert condition`),
      },
    }),
    description: mkstr(`insert data into the table: ${item.name}`),
  }));
  ctx.mutations.add(`insert_${item.name}_one`, (name) => ({
    kind: Kind.FIELD_DEFINITION,
    name,
    type: $.named(item.name),
    arguments: mkfields({
      object: {
        kind: Kind.INPUT_VALUE_DEFINITION,
        type: $.non_null(generateInsertInput(item, ctx)),
        description: mkstr(`the row to be inserted`),
      },
      on_conflict: {
        kind: Kind.INPUT_VALUE_DEFINITION,
        type: $.non_null_list(generateOnConflict(item, ctx)),
        description: mkstr(`upsert condition`),
      },
    }),
    description: mkstr(`insert a single row into the table: ${item.name}`),
  }));
  ctx.mutations.add(`delete_${item.name}`, (name) => ({
    kind: Kind.FIELD_DEFINITION,
    name,
    type: mutation_response,
    arguments: mkfields({
      where: {
        kind: Kind.INPUT_VALUE_DEFINITION,
        type: generateBoolExp(item, ctx),
        description: mkstr(`filter the rows which have to be deleted`),
      },
    }),
    description: mkstr(`delete data from the table: ${item.name}`),
  }));
  ctx.mutations.add(`update_${item.name}`, (name) => ({
    kind: Kind.FIELD_DEFINITION,
    name,
    type: mutation_response,
    arguments: mkfields(_generateUpdatesFields(item, ctx)),
    description: mkstr(`update data of the table: ${item.name}`),
  }));
  ctx.mutations.add(`update_${item.name}_many`, (name) => ({
    kind: Kind.FIELD_DEFINITION,
    name,
    type: $.list(mutation_response),
    arguments: mkfields({
      updates: {
        kind: Kind.INPUT_VALUE_DEFINITION,
        type: $.non_null($.non_null_list(generateUpdates(item, ctx))),
      },
    }),
    description: mkstr(`update multiples rows of table: ${item.name}`),
  }));
  const columns = getColumns(item, ctx.schema);
  const pks = columns.filter((x) => x.primary_key);
  if (pks.length) {
    ctx.mutations.add(`delete_${item.name}_by_pk`, (name) => ({
      kind: Kind.FIELD_DEFINITION,
      name,
      type: $.named(item.name),
      arguments: pks.map((x) => ({
        kind: Kind.INPUT_VALUE_DEFINITION as const,
        name: mkname(x.name),
        type: decodeToTypeNode(x.type),
      })),
      description: mkstr(`delete single row from the table: ${item.name}`),
    }));
    ctx.mutations.add(`update_${item.name}_by_pk`, (name) => ({
      kind: Kind.FIELD_DEFINITION,
      name,
      type: $.named(item.name),
      arguments: mkfields({
        ..._generateBaseUpdatesFields(item, ctx),
        pk_columns: {
          kind: Kind.INPUT_VALUE_DEFINITION,
          type: generatePkColumnsInput(item, ctx),
        },
      }),
      description: mkstr(`update single row of the table: ${item.name}`),
    }));
  }
}
