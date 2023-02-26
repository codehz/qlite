/* eslint-disable @typescript-eslint/no-explicit-any */
import { MaybePromise } from '@graphql-tools/utils';
import {
  GraphQLFieldConfig,
  GraphQLNamedInputType,
  GraphQLNamedOutputType,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLSchema,
} from 'graphql';
import { QLiteConfig } from '../config.js';
import { mapMap } from './utils.js';

export type SQLiteTrait<Context> = {
  one(ctx: Context, sql: string, parameters: any[]): MaybePromise<any>;
  all(ctx: Context, sql: string, parameters: any[]): MaybePromise<any>;
  mutate(
    ctx: Context,
    sql: string,
    parameters: any[],
    returning: boolean
  ): MaybePromise<{ affected_rows: number; returning: Array<any> }>;
  mutate_batch(
    ctx: Context,
    tasks: ({
      sql: string;
      parameters: any[];
    })[],
    returning: boolean
  ): MaybePromise<{ affected_rows: number; returning: Array<any> }[]>;
};

export class SchemaGeneratorContext<Context> {
  typesmap = new Map<string, GraphQLNamedType>();
  queries = new Map<string, () => GraphQLFieldConfig<unknown, Context, any>>();
  mutations = new Map<
    string,
    () => GraphQLFieldConfig<unknown, Context, any>
  >();
  constructor(public trait: SQLiteTrait<Context>, public config: QLiteConfig) {}

  addType<T extends GraphQLNamedType>(type: T) {
    this.typesmap.set(type.name, type);
    return type;
  }

  addTypeIfNotExists<T extends GraphQLNamedType>(name: string, gen: () => T) {
    let ret;
    if ((ret = this.typesmap.get(name))) {
      return ret as T;
    }
    ret = gen();
    this.typesmap.set(name, ret);
    return ret;
  }

  getType(name: string) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.typesmap.get(name)!;
  }

  getOutputType(name: string) {
    return this.typesmap.get(name) as GraphQLNamedOutputType;
  }

  getInputType(name: string) {
    return this.typesmap.get(name) as GraphQLNamedInputType;
  }

  addQuery(
    name: string,
    value: () => GraphQLFieldConfig<unknown, Context, any>
  ) {
    this.queries.set(name, value);
  }

  addMutation(
    name: string,
    value: () => GraphQLFieldConfig<unknown, Context, any>
  ) {
    this.mutations.set(name, value);
  }

  toSchema() {
    return new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: () => mapMap(this.queries, (f) => f()),
      }),
      mutation: new GraphQLObjectType({
        name: 'Mutation',
        fields: () => mapMap(this.mutations, (f) => f()),
      }),
    });
  }
}
