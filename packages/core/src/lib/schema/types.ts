import { GraphQLList } from 'graphql';
import { GraphQLType } from 'graphql';
import {
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLNullableType,
  GraphQLScalarType,
  GraphQLString,
} from 'graphql';
import { GraphQLDateTime, GraphQLJSON, GraphQLUUID } from 'graphql-scalars';
import { QLitePrimitiveTypeName } from '../config.js';

export function mapPrimitiveType(
  name: QLitePrimitiveTypeName
): GraphQLScalarType {
  switch (name) {
    case 'boolean':
      return GraphQLBoolean;
    case 'integer':
      return GraphQLInt;
    case 'real':
      return GraphQLFloat;
    case 'text':
      return GraphQLString;
    case 'uuid':
      return GraphQLUUID;
    case 'timestamp':
      return GraphQLDateTime;
    case 'json':
      return GraphQLJSON;
  }
}

export function maybeNonNull<T extends GraphQLNullableType>(
  input: T,
  not_null: boolean
) {
  if (not_null) return new GraphQLNonNull(input);
  return input;
}

export function List<T extends GraphQLType>(input: T) {
  return new GraphQLList(input);
}

export function NonNull<T extends GraphQLNullableType>(input: T) {
  return new GraphQLNonNull(input);
}

export function ListNonNull<T extends GraphQLNullableType>(input: T) {
  return new GraphQLList(new GraphQLNonNull(input));
}

export function NonNullListNonNull<T extends GraphQLNullableType>(input: T) {
  return new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(input)));
}
