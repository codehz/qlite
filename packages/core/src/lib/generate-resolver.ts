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

export type SQLiteTrait = {
  one(sql: string, parameters: any[]): any;
  all(sql: string, parameters: any[]): any;
  mutate(
    sql: string,
    parameters: any[],
    returning: boolean
  ): MaybePromise<{ affected_rows: number; returning: Array<any> }>;
  mutate_batch(
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
              return obj['$' + info.path.key];
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
        return trait.one(sql.sql, sql.parameters);
      },
      [item.name + '_aggregate'](
        _obj: any,
        args: any,
        _ctx: any,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateQueryAggregate(schema, parsed, item.name);
        return trait.one(query.sql, query.parameters);
      },
      [item.name](_obj: any, args: any, _ctx: any, info: GraphQLResolveInfo) {
        const parsed = parseResolveInfo(args, info);
        const sql = generateQuery(schema, parsed, item.name);
        return trait.all(sql.sql, sql.parameters);
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
        const query = generateInsertOne(schema, parsed, item.name);
        return trait.one(query.sql, query.parameters);
      },
      ['insert_' + item.name](
        _obj: any,
        args: any,
        _ctx: any,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateInsert(schema, parsed, item.name);
        if (query)
          return trait.mutate(query.sql, query.parameters, query.returning);
        else return { affected_rows: 0, returning: [] };
      },
      ['delete_' + item.name + '_by_pk'](
        _obj: any,
        args: any,
        _ctx: any,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateDeleteByPk(schema, parsed, item.name);
        return trait.one(query.sql, query.parameters);
      },
      ['delete_' + item.name](
        _obj: any,
        args: any,
        _ctx: any,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateDelete(schema, parsed, item.name);
        if (query)
          return trait.mutate(query.sql, query.parameters, query.returning);
        else return { affected_rows: 0, returning: [] };
      },
      ['update_' + item.name](
        _obj: any,
        args: any,
        _ctx: any,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateUpdate(schema, parsed, item.name);
        if (query)
          return trait.mutate(query.sql, query.parameters, query.returning);
        else return { affected_rows: 0, returning: [] };
      },
      ['update_' + item.name + '_by_pk'](
        _obj: any,
        args: any,
        _ctx: any,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateUpdateByPk(schema, parsed, item.name);
        return trait.one(query.sql, query.parameters);
      },
      ['update_' + item.name + '_many'](
        _obj: any,
        args: any,
        _ctx: any,
        info: GraphQLResolveInfo
      ) {
        const parsed = parseResolveInfo(args, info);
        const query = generateUpdateMany(schema, parsed, item.name);
        if (query) return trait.mutate_batch(query.tasks, query.returning);
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
              [key](obj: any, _args: any, _ctx: any, info: GraphQLResolveInfo) {
                return obj['$' + info.path.key];
              },
            }[key] as ResolverType,
          ];
        })
      ),
    });
  }
}
