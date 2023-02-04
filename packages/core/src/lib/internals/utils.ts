import { getDirective } from '@graphql-tools/utils';
import { GraphQLObjectType, GraphQLSchema } from 'graphql';

export function getColumns(item: GraphQLObjectType, schema: GraphQLSchema) {
  return Object.entries(item.getFields()).map(([k, v]) => {
    const { name, ...dir } = getDirective(schema, v, 'column')?.[0] as {
      name?: string;
      primary_key?: boolean;
    };
    return { name: k, dbname: name, type: v.type, ...dir };
  });
}

export type Relation = {
  name?: string;
  type: 'object' | 'array';
  target: string;
  defintions: {
    from: string;
    to: string;
  }[];
};

export function getRelations(item: GraphQLObjectType, schema: GraphQLSchema) {
  return getDirective(schema, item, 'relation') as Relation[] | undefined;
}
