import {
  GraphQLFieldConfig,
  GraphQLNamedInputType,
  GraphQLNamedOutputType,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLSchema,
} from 'graphql';
import { mapMap } from './utils.js';

export class SchemaGeneratorContext {
  typesmap = new Map<string, GraphQLNamedType>();
  queries = new Map<
    string,
    () => GraphQLFieldConfig<unknown, unknown, unknown>
  >();
  mutations = new Map<
    string,
    () => GraphQLFieldConfig<unknown, unknown, unknown>
  >();

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
    value: () => GraphQLFieldConfig<unknown, unknown, unknown>
  ) {
    this.queries.set(name, value);
  }

  addMutation(
    name: string,
    value: () => GraphQLFieldConfig<unknown, unknown, unknown>
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
