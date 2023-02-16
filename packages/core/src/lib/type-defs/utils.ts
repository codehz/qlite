import {
  FieldDefinitionNode,
  GraphQLNonNull,
  GraphQLNullableType,
  GraphQLOutputType,
  GraphQLScalarType,
  GraphQLSchema,
  TypeExtensionNode,
} from 'graphql';
import { GraphQLType } from 'graphql';
import {
  InputObjectTypeDefinitionNode,
  Kind,
  ListTypeNode,
  NamedTypeNode,
  NameNode,
  NonNullTypeNode,
  ObjectTypeDefinitionNode,
  StringValueNode,
  TypeDefinitionNode,
  TypeNode,
} from 'graphql';

export class DefinitionMap<T> {
  #map = new Map<string, T>();
  #pending = new Set<string>();
  add(name: string): (lazy: (name: NameNode) => T) => NamedTypeNode {
    if (this.#map.has(name)) {
      return () => $.named(name);
    }
    this.#pending.add(name);
    return (lazy: (name: NameNode) => T) => {
      this.#pending.delete(name);
      this.#map.set(name, lazy(mkname(name)));
      return $.named(name);
    };
  }

  add_not_empty(
    name: string,
    lazy: (
      name: NameNode
    ) => ObjectTypeDefinitionNode | InputObjectTypeDefinitionNode
  ): NamedTypeNode | null {
    if (this.#map.has(name)) {
      return $.named(name);
    }
    const ret = lazy(mkname(name));
    if (ret.fields?.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.#map.set(name, ret as any);
      return $.named(name);
    }
    return null;
  }

  get(name: string) {
    return (
      this.#map.get(name) ??
      (() => {
        throw new Error('invalid name: ' + name);
      })()
    );
  }

  dump() {
    return [...this.#map.values()];
  }
}

export type Context = {
  types: DefinitionMap<TypeDefinitionNode | TypeExtensionNode>;
  queries: DefinitionMap<FieldDefinitionNode>;
  mutations: DefinitionMap<FieldDefinitionNode>;
  schema: GraphQLSchema;
};

type SuffixMapType<T extends string> = {
  [input in T]: <S extends string>(name: S) => `${S}_${T}`;
};

export const SuffixMap = new Proxy(
  {},
  {
    get(_, p: string) {
      return (name: string) => name + '_' + p;
    },
  }
) as SuffixMapType<
  | 'bool_exp'
  | 'comparison_exp'
  | 'order_by'
  | 'select_column'
  | 'mutation_response'
  | 'insert_input'
  | 'on_conflict'
  | 'conflict_target'
  | 'inc_input'
  | 'set_input'
  | 'pk_columns_input'
  | 'updates'
  | 'min_fields'
  | 'max_fields'
  | 'avg_fields'
  | 'sum_fields'
  | 'aggregate_fields'
  | 'aggregate'
>;

export function mapvalue<T extends { name: string }, R>(
  input: T[],
  fn: (input: T, key: string) => R
): Record<string, R> {
  return Object.fromEntries(
    input.map((value) => [value.name, fn(value, value.name)])
  );
}

export function mkfields<T extends { name: NameNode }>(
  input: Record<string, Omit<T, 'name'> | undefined | null>
): T[] {
  return Object.entries(input).flatMap(([name, value]) =>
    value
      ? ({
          name: mkname(name),
          ...value,
        } as T)
      : []
  );
}

export function mkname(name: string): NameNode {
  return { kind: Kind.NAME, value: name };
}

export function mkstr(str: string): StringValueNode {
  return { kind: Kind.STRING, value: str };
}

export function flatmap<T extends {}, R>(
  input: T | undefined | null,
  mapper: (input: T) => R
): R | undefined {
  if (input == null) return undefined;
  return mapper(input);
}

export type MaybeDescription = { description?: string };

export const $ = {
  named(name: string, description?: string): NamedTypeNode & MaybeDescription {
    return {
      kind: Kind.NAMED_TYPE,
      name: mkname(name),
      description,
    };
  },
  non_null(
    type: NamedTypeNode | ListTypeNode,
    description?: string
  ): NonNullTypeNode & MaybeDescription {
    return {
      kind: Kind.NON_NULL_TYPE,
      type,
      description,
    };
  },
  list(type: TypeNode, description?: string): ListTypeNode & MaybeDescription {
    return {
      kind: Kind.LIST_TYPE,
      type,
      description,
    };
  },
  non_null_list(
    type: NamedTypeNode | ListTypeNode,
    description?: string
  ): ListTypeNode & MaybeDescription {
    return $.list($.non_null(type), description);
  },
};

export function decodeToTypeNode(input: GraphQLType): NamedTypeNode {
  if (input instanceof GraphQLNonNull) {
    return decodeToTypeNode(input.ofType);
  } else if (input instanceof GraphQLScalarType) {
    return $.named(input.name);
  }
  throw new Error('Invalid type');
}

export function isTypeOrNonNull(x: GraphQLOutputType, y: GraphQLNullableType) {
  if (x === y) return true;
  else if (x instanceof GraphQLNonNull) return x.ofType === y;
  return false;
}
