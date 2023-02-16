import { getDirective } from '@graphql-tools/utils';
import {
  FieldDefinitionNode,
  GraphQLObjectType,
  GraphQLSchema,
  Kind,
  TypeDefinitionNode,
  TypeExtensionNode,
} from 'graphql';
import { generateMutation } from './mutation.js';
import { generateQuery } from './query.js';
import { generateRelationFields } from './relation_fields.js';
import { Context, DefinitionMap } from './utils.js';

export function generateRootTypeDefs(schema: GraphQLSchema) {
  const types = new DefinitionMap<TypeDefinitionNode | TypeExtensionNode>();
  const queries = new DefinitionMap<FieldDefinitionNode>();
  const mutations = new DefinitionMap<FieldDefinitionNode>();
  const ctx: Context = { types, queries, mutations, schema };
  for (const item of Object.values(schema.getTypeMap())) {
    if (item instanceof GraphQLObjectType) {
      const entity = getDirective(schema, item, 'entity')?.[0] as
        | { exported: boolean }
        | undefined;
      if (entity) {
        generateRelationFields(item, ctx);
        generateQuery(item, ctx);
        generateMutation(item, ctx);
      }
    }
  }
  types.add('Query')((name) => ({
    kind: schema.getQueryType()
      ? Kind.OBJECT_TYPE_EXTENSION
      : Kind.OBJECT_TYPE_DEFINITION,
    name,
    fields: queries.dump(),
  }));
  types.add('Mutation')((name) => ({
    kind: schema.getMutationType()
      ? Kind.OBJECT_TYPE_EXTENSION
      : Kind.OBJECT_TYPE_DEFINITION,
    name,
    fields: mutations.dump(),
  }));
  return types.dump();
}
