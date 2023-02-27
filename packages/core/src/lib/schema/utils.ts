import { GraphQLArgumentConfig, GraphQLInputFieldConfig } from 'graphql';
import { QLiteColumnConfig, QLiteTableConfig } from '../config.js';
import { mapPrimitiveType, NonNull } from './types.js';

export function mapObject<I, O>(
  input: Record<string, I> | undefined,
  fn: O | ((input: I) => O)
): Record<string, O> {
  return input
    ? Object.fromEntries(
        Object.entries(input).map(([k, v]) => [
          k,
          typeof fn === 'function' ? (fn as (input: I) => O)(v) : fn,
        ])
      )
    : {};
}

export function mapNonNullObject<I, O>(
  input: Record<string, I> | undefined,
  fn: (input: I) => O | undefined | null
): Record<string, O> {
  return input
    ? Object.fromEntries(
        Object.entries(input)
          .map(([k, v]) => [k, fn(v)])
          .filter((x) => x[1] != null)
      )
    : {};
}

export function filterObject<I>(
  input: Record<string, I> | undefined,
  fn: (input: I) => boolean
): Record<string, I> {
  return input
    ? Object.fromEntries(Object.entries(input).filter(([, v]) => fn(v)))
    : {};
}

export function trimObject<I>(
  input: Record<string, I | undefined | null> | undefined
): Record<string, I> {
  return input
    ? (Object.fromEntries(
        Object.entries(input).filter(([, v]) => v != null)
      ) as Record<string, I>)
    : {};
}

export function mapMap<I, O>(
  input: Map<string, I> | undefined,
  fn: (input: I) => O
): Record<string, O> {
  return input
    ? Object.fromEntries([...input.entries()].map(([k, v]) => [k, fn(v)]))
    : {};
}

export function notEmptyObject(i: {}): boolean {
  return !!Object.keys(i).length;
}

type TableColumnsInfo = Record<
  | 'columns'
  | 'pk_columns'
  | 'integer_columns'
  | 'real_columns'
  | 'json_columns'
  | 'sortable_columns',
  Record<string, QLiteColumnConfig>
> & {
  pk_fields?: Record<string, GraphQLArgumentConfig & GraphQLInputFieldConfig>;
};

const TableColumnsInfoCache = new WeakMap<QLiteTableConfig, TableColumnsInfo>();

export function tableColumnsInfo(config: QLiteTableConfig): TableColumnsInfo {
  let res;
  if ((res = TableColumnsInfoCache.get(config))) {
    return res;
  }
  const pk_columns = filterObject(
    config.columns,
    ({ primary_key }) => !!primary_key
  );
  res = {
    columns: config.columns,
    pk_columns,
    integer_columns: filterObject(
      config.columns,
      ({ type }) => type === 'integer'
    ),
    real_columns: filterObject(
      config.columns,
      ({ type }) => type === 'real'
    ),
    json_columns: filterObject(config.columns, ({ type }) => type === 'json'),
    sortable_columns: filterObject(
      config.columns,
      ({ type }) => type !== 'json'
    ),
    pk_fields: notEmptyObject(pk_columns)
      ? mapObject(pk_columns, ({ type, comments }) => ({
          type: NonNull(mapPrimitiveType(type)),
          description: comments,
        }))
      : undefined,
  };
  TableColumnsInfoCache.set(config, res);
  return res;
}
