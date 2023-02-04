/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDirective, MaybePromise } from '@graphql-tools/utils';
import {
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLResolveInfo,
  GraphQLSchema,
  GraphQLString,
} from 'graphql';
import { getRelations } from './internals/utils.js';
import { parseResolveInfo } from './selection-utils.js';
import {
  generateQueryByPk,
  generateQueryAggregate,
  generateQuery,
  generateInsertOne,
  generateInsert,
  generateDelete,
} from './sql-helper.js';

export type SQLiteTrait = {
  one(sql: string, parameters: any[]): any;
  all(sql: string, parameters: any[]): any;
  mutate(
    sql: string,
    parameters: any[],
    returning: boolean
  ): MaybePromise<{ affected_rows: number; returning: Array<any> }>;
};

type ResolverType = (
  obj: any,
  args: Record<string, any>,
  ctx: any,
  info: GraphQLResolveInfo
) => any;

export function generateResolver(schema: GraphQLSchema, trait: SQLiteTrait) {
  const Query: Record<string, ResolverType> = {};
  const Mutation: Record<string, ResolverType> = {};
  const Root: Record<string, Record<string, ResolverType>> = {
    Query,
    Mutation,
  };
  const ctx = {
    trait,
    Query,
    Mutation,
    Root,
  };
  for (const item of Object.values(schema.getTypeMap())) {
    if (item instanceof GraphQLObjectType) {
      const entity = getDirective(schema, item, 'entity')?.[0] as
        | { exported: boolean }
        | undefined;
      if (entity) {
        generateFieldResolver(entity, item, schema, ctx);
      }
    }
  }
  return Root;
}

function populateType(schema: GraphQLSchema, name: string) {
  const type = schema.getType(name);
  if (!type || !(type instanceof GraphQLObjectType))
    throw new Error('invalid type ' + name);
  return {
    [name]: Object.fromEntries(
      Object.keys(type.getFields()).map((x) => {
        const key = name + '.' + x;
        return [
          x,
          {
            [key](obj: any, _args: any, _ctx: any, info: GraphQLResolveInfo) {
              return resolveJSON(obj['$' + info.path.key], info.returnType);
            },
          }[key] as ResolverType,
        ];
      })
    ),
  };
}

function generateFieldResolver(
  entity: { exported: boolean },
  item: GraphQLObjectType,
  schema: GraphQLSchema,
  {
    trait,
    Query,
    Mutation,
    Root,
  }: {
    trait: SQLiteTrait;
    Query: Record<string, ResolverType>;
    Mutation: Record<string, ResolverType>;
    Root: Record<string, Record<string, ResolverType>>;
  }
) {
  if (entity.exported) {
    Object.assign(Query, {
      [item.name + '_by_pk'](
        _obj: any,
        args: any,
        _ctx: any,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const sql = generateQueryByPk(schema, parsed, item.name);
        return trait.one(sql.raw, sql.parameters);
      },
      [item.name + '_aggregate'](
        _obj: any,
        args: any,
        _ctx: any,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const sql = generateQueryAggregate(schema, parsed, item.name);
        return trait.one(sql.raw, sql.parameters);
      },
      [item.name](_obj: any, args: any, _ctx: any, info: GraphQLResolveInfo) {
        const parsed = parseResolveInfo(args, info);
        const sql = generateQuery(schema, parsed, item.name);
        return trait.all(sql.raw, sql.parameters);
      },
    });
    Object.assign(Root, {
      ...populateType(schema, item.name + '_aggregate'),
      ...populateType(schema, item.name + '_aggregate_fields'),
    });
    Object.assign(Mutation, {
      ['insert_' + item.name + '_one'](
        _obj: any,
        args: any,
        _ctx: any,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const sql = generateInsertOne(schema, parsed, item.name);
        return trait.one(sql.raw, sql.parameters);
      },
      ['insert_' + item.name](
        _obj: any,
        args: any,
        _ctx: any,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const sql = generateInsert(schema, parsed, item.name);
        if (sql) return trait.mutate(sql.raw, sql.parameters, sql.returning);
        else return { affected_rows: 0, returning: [] };
      },
      ['delete_' + item.name](
        _obj: any,
        args: any,
        _ctx: any,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const sql = generateDelete(schema, parsed, item.name);
        if (sql) return trait.mutate(sql.raw, sql.parameters, sql.returning);
        else return { affected_rows: 0, returning: [] };
      },
    });
  }
  const relations = getRelations(item, schema);
  if (relations) {
    const names = relations.map((x) => x.name ?? x.target);
    Object.assign(Root, {
      [item.name]: Object.fromEntries(
        names.map((x) => {
          const key = item.name + '.' + x;
          return [
            x,
            {
              [key](obj: any, _args: any, _ctx: any, info: GraphQLResolveInfo) {
                return resolveJSON(obj['$' + info.path.key], info.returnType);
              },
            }[key] as ResolverType,
          ];
        })
      ),
    });
  }
}

function resolveJSON(o: any, type: GraphQLOutputType): Record<string, unknown> {
  if (
    typeof o === 'string' &&
    !(type === GraphQLString) &&
    !(type instanceof GraphQLNonNull && type.ofType === GraphQLString)
  )
    return JSON.parse(o) as Record<string, unknown>;
  return o;
}
