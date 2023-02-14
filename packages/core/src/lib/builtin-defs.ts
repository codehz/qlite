import { parse, GraphQLSchema } from 'graphql';
import { mapSchema, MapperKind } from '@graphql-tools/utils';

const DIRECTIVES = [
  'entity',
  'foreign_key',
  'column',
  'check',
  'relation',
  'computed',
];

const ENUMS = ['QLiteRelationType', 'QLiteForeignKeyBehavior'];

const INPUTS = ['QLiteRelationDefinition'];

export const filterOutBuiltinDefinitions = (input: GraphQLSchema) =>
  mapSchema(input, {
    [MapperKind.DIRECTIVE](item) {
      if (DIRECTIVES.includes(item.name)) return null;
      return item;
    },
    [MapperKind.ENUM_TYPE](item) {
      if (ENUMS.includes(item.name)) return null;
      return item;
    },
    [MapperKind.INPUT_OBJECT_TYPE](item) {
      if (INPUTS.includes(item.name)) return null;
      return item;
    },
  });

export const BuiltinDefinitions = parse(
  `
directive @entity(
  exported: Boolean = true,
  name: String,
  without_rowid: Boolean,
  strict: Boolean,
) on OBJECT
directive @foreign_key(
  table: String!,
  from: [String!]!,
  to: [String!]!,
  on_delete: QLiteForeignKeyBehavior,
  on_update: QLiteForeignKeyBehavior,
  deferred: Boolean
) repeatable on OBJECT
directive @column(
  primary_key: Boolean,
  alias_rowid: Boolean,
  name: String,
  default: String
) on FIELD_DEFINITION
directive @check(expr: String!) repeatable on OBJECT | FIELD_DEFINITION
directive @relation(
  type: QLiteRelationType! = array,
  name: String,
  target: String!,
  defintions: [QLiteRelationDefinition!]!
) repeatable on OBJECT
directive @computed(sql: String!) on FIELD_DEFINITION

enum QLiteRelationType {
  object
  array
}

input QLiteRelationDefinition {
  from: String!
  to: String!
}

enum QLiteForeignKeyBehavior {
  SET_NULL
  SET_DEFAULT
  CASCADE
  RESTRICT
  NO_ACTION
}
`,
  { noLocation: true }
);
