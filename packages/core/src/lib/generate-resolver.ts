/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDirective, MaybePromise } from '@graphql-tools/utils';
import { GraphQLObjectType, GraphQLResolveInfo, GraphQLSchema } from 'graphql';
import { getRelations } from './internals/utils.js';
import { parseResolveInfo } from './selection-utils.js';
import {
  generateQueryByPk,
  generateQueryAggregate,
  generateQuery,
  generateInsertOne,
  generateInsert,
  generateDelete,
  generateDeleteByPk,
  generateUpdate,
  generateUpdateByPk,
  generateUpdateMany,
} from './sql-helper.js';

export type SQLiteTrait<T> = {
  one(ctx: T, sql: string, parameters: any[]): any;
  all(ctx: T, sql: string, parameters: any[]): any;
  mutate(
    ctx: T,
    sql: string,
    parameters: any[],
    returning: boolean
  ): MaybePromise<{ affected_rows: number; returning: Array<any> }>;
  mutate_batch(
    ctx: T,
    tasks: (
      | {
          sql: string;
          parameters: any[];
        }
      | undefined
    )[],
    returning: boolean
  ): MaybePromise<{ affected_rows: number; returning: Array<any> }[]>;
};

export function fixupResult(o: Record<string, unknown>) {
  for (const key in o) {
    if (key.startsWith('$')) {
      o[key] = JSON.parse(o[key] as string);
    }
  }
  return o;
}

type ResolverType<T> = (
  obj: any,
  args: Record<string, any>,
  ctx: T,
  info: GraphQLResolveInfo
) => any;

export function generateResolver<T = never>(
  schema: GraphQLSchema,
  trait: SQLiteTrait<T>
) {
  const Query: Record<string, ResolverType<T>> = {};
  const Mutation: Record<string, ResolverType<T>> = {};
  const Root: Record<string, Record<string, ResolverType<T>>> = {
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
              return obj['$' + info.path.key];
            },
          }[key] as ResolverType<never>,
        ];
      })
    ),
  };
}

function generateFieldResolver<T>(
  entity: { exported: boolean },
  item: GraphQLObjectType,
  schema: GraphQLSchema,
  {
    trait,
    Query,
    Mutation,
    Root,
  }: {
    trait: SQLiteTrait<T>;
    Query: Record<string, ResolverType<T>>;
    Mutation: Record<string, ResolverType<T>>;
    Root: Record<string, Record<string, ResolverType<T>>>;
  }
) {
  if (entity.exported) {
    Object.assign(Query, {
      [item.name + '_by_pk'](
        _obj: any,
        args: any,
        ctx: T,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const sql = generateQueryByPk(schema, parsed, item.name);
        return trait.one(ctx, sql.sql, sql.parameters);
      },
      [item.name + '_aggregate'](
        _obj: any,
        args: any,
        ctx: T,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateQueryAggregate(schema, parsed, item.name);
        return trait.one(ctx, query.sql, query.parameters);
      },
      [item.name](_obj: any, args: any, ctx: T, info: GraphQLResolveInfo) {
        const parsed = parseResolveInfo(args, info);
        const sql = generateQuery(schema, parsed, item.name);
        return trait.all(ctx, sql.sql, sql.parameters);
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
        ctx: T,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateInsertOne(schema, parsed, item.name);
        return trait.one(ctx, query.sql, query.parameters);
      },
      ['insert_' + item.name](
        _obj: any,
        args: any,
        ctx: T,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateInsert(schema, parsed, item.name);
        if (query)
          return trait.mutate(
            ctx,
            query.sql,
            query.parameters,
            query.returning
          );
        else return { affected_rows: 0, returning: [] };
      },
      ['delete_' + item.name + '_by_pk'](
        _obj: any,
        args: any,
        ctx: T,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateDeleteByPk(schema, parsed, item.name);
        return trait.one(ctx, query.sql, query.parameters);
      },
      ['delete_' + item.name](
        _obj: any,
        args: any,
        ctx: T,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateDelete(schema, parsed, item.name);
        if (query)
          return trait.mutate(
            ctx,
            query.sql,
            query.parameters,
            query.returning
          );
        else return { affected_rows: 0, returning: [] };
      },
      ['update_' + item.name](
        _obj: any,
        args: any,
        ctx: T,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateUpdate(schema, parsed, item.name);
        if (query)
          return trait.mutate(
            ctx,
            query.sql,
            query.parameters,
            query.returning
          );
        else return { affected_rows: 0, returning: [] };
      },
      ['update_' + item.name + '_by_pk'](
        _obj: any,
        args: any,
        ctx: T,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateUpdateByPk(schema, parsed, item.name);
        return trait.one(ctx, query.sql, query.parameters);
      },
      ['update_' + item.name + '_many'](
        _obj: any,
        args: any,
        ctx: T,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateUpdateMany(schema, parsed, item.name);
        if (query) return trait.mutate_batch(ctx, query.tasks, query.returning);
        else return [];
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
              [key](
                obj: any,
                _args: any,
                _ctx: never,
                info: GraphQLResolveInfo
              ) {
                return obj['$' + info.path.key];
              },
            }[key] as ResolverType<never>,
          ];
        })
      ),
    });
  }
}
