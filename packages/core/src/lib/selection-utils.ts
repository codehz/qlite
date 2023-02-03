import { Path } from '@graphql-tools/utils';
import {
  DirectiveNode,
  GraphQLResolveInfo,
  getDirectiveValues,
  GraphQLSkipDirective,
  GraphQLIncludeDirective,
  SelectionNode,
  FieldNode,
  Kind,
  SelectionSetNode,
  ValueNode,
  FragmentDefinitionNode,
} from 'graphql';

type SelectionInfo = {
  fragments: Record<string, FragmentDefinitionNode>;
  variableValues: Record<string, unknown>;
};

function shouldIncludeNode(
  node: { readonly directives?: ReadonlyArray<DirectiveNode> },
  info: SelectionInfo
): boolean {
  const skip = getDirectiveValues(
    GraphQLSkipDirective,
    node,
    info.variableValues
  ) as { if: boolean } | undefined;
  if (skip?.if === true) {
    return false;
  }
  const include = getDirectiveValues(
    GraphQLIncludeDirective,
    node,
    info.variableValues
  ) as { if: boolean } | undefined;
  if (include?.if === false) {
    return false;
  }
  return true;
}

function expandSelection(
  node: SelectionNode,
  info: SelectionInfo
): FieldNode[] {
  switch (node.kind) {
    case Kind.FIELD:
      return [node];
    case Kind.INLINE_FRAGMENT:
      return node.selectionSet.selections.flatMap((x) =>
        expandSelection(x, info)
      );
    case Kind.FRAGMENT_SPREAD:
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return info.fragments[node.name.value]!.selectionSet.selections.flatMap(
        (x) => expandSelection(x, info)
      );
  }
}

function resolveValue(value: ValueNode, info: SelectionInfo): unknown {
  switch (value.kind) {
    case Kind.VARIABLE:
      return info.variableValues[value.name.value];
    case Kind.NULL:
      return null;
    case Kind.LIST:
      return value.values.map((x) => resolveValue(x, info));
    case Kind.OBJECT:
      return Object.fromEntries(
        value.fields.map((x) => [x.name.value, resolveValue(x.value, info)])
      );
    case Kind.INT:
    case Kind.FLOAT:
      return +value.value;
    default:
      return value.value;
  }
}

export interface FieldInfo {
  name: string;
  alias: string;
  arguments: Record<string, unknown>;
  subfields: readonly FieldInfo[];
  typename?: string;
}

export function resolveSelectionSet(
  set: SelectionSetNode | undefined,
  info: SelectionInfo
): FieldInfo[] {
  return (
    set?.selections
      .filter((x) => shouldIncludeNode(x, info))
      .flatMap((x) => expandSelection(x, info))
      .map((x) => ({
        name: x.name.value,
        alias: x.alias?.value ?? x.name.value,
        arguments: Object.fromEntries(
          x.arguments?.map((x) => [
            x.name.value,
            resolveValue(x.value, info),
          ]) ?? []
        ),
        subfields: resolveSelectionSet(x.selectionSet, info),
      })) ?? []
  );
}

function getAliasFromPath(path?: Path): string | undefined {
  if (!path) return undefined;
  const prev = getAliasFromPath(path.prev);
  if (prev) return typeof path.key === 'string' ? prev + '.' + path.key : prev;
  return path.key + '';
}

export function parseResolveAlias(info: GraphQLResolveInfo) {
  return getAliasFromPath(info.path) ?? info.fieldName;
}

export function parseResolveInfo(
  args: Record<string, unknown>,
  info: GraphQLResolveInfo
): FieldInfo {
  const fields = info.fieldNodes.flatMap((x) =>
    resolveSelectionSet(x.selectionSet, info)
  );
  return {
    name: info.fieldName,
    alias: getAliasFromPath(info.path) ?? info.fieldName,
    arguments: args,
    subfields: fields,
    typename: info.path.typename,
  };
}
