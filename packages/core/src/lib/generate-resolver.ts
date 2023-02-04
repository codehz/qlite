/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDirective } from '@graphql-tools/utils';
import { GraphQLObjectType, GraphQLResolveInfo, GraphQLSchema } from 'graphql';
import { getRelations } from './internals/utils.js';
import { parseResolveInfo } from './selection-utils.js';
import { generateSQL } from './sql-helper.js';

export type SQLiteTrait = {
  one(sql: string, parameters: any[]): any;
  all(sql: string, parameters: any[]): any;
};

type ResolverType = (
  obj: any,
  args: Record<string, any>,
  ctx: any,
  info: GraphQLResolveInfo
) => any;

export function generateResolver(schema: GraphQLSchema, trait: SQLiteTrait) {
  const Query: Record<string, ResolverType> = {};
  const Root: Record<string, Record<string, ResolverType>> = { Query };
  const ctx = {
    trait,
    Query,
    Root,
  };
  for (const item of Object.values(schema.getTypeMap())) {
    if (item instanceof GraphQLObjectType) {
      const entity = getDirective(schema, item, 'entity')?.[0] as
        | { exported: boolean }
        | undefined;
      if (entity) {
        generateQuery(entity, item, schema, ctx);
      }
    }
  }
  return Root;
}

function generateQuery(
  entity: { exported: boolean },
  item: GraphQLObjectType,
  schema: GraphQLSchema,
  {
    trait,
    Query,
    Root,
  }: {
    trait: SQLiteTrait;
    Query: Record<string, ResolverType>;
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
        const sql = generateSQL(schema, parsed);
        return trait.one(sql.raw, sql.parameters);
      },
      [item.name](_obj: any, args: any, _ctx: any, info: GraphQLResolveInfo) {
        const parsed = parseResolveInfo(args, info);
        const sql = generateSQL(schema, parsed);
        return trait.all(sql.raw, sql.parameters);
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
                return resolveJSON(
                  obj['$' + info.path.key],
                  !info.path.prev?.prev
                );
              },
            }[key] as ResolverType,
          ];
        })
      ),
    });
  }
}

function resolveJSON(o: any, convert: boolean): Record<string, unknown> {
  if (convert) return JSON.parse(o) as Record<string, unknown>;
  return o;
}
