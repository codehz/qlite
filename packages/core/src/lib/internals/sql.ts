/* eslint-disable @typescript-eslint/no-explicit-any */

export function quoteStr(str: string, quote = '"') {
  return quote + str.replaceAll(quote, quote + quote) + quote;
}
export function smartQuote(input: unknown): string {
  if (Array.isArray(input)) return '(' + input.map(smartQuote) + ')';
  if (typeof input === 'string') return quoteStr(input);
  return input + '';
}
export function fmt(
  template: { raw: readonly string[] | ArrayLike<string> },
  ...substitutions: any[]
) {
  const tmp = String.raw(template, ...substitutions);
  return (...args: any[]) =>
    tmp.replace(/%([sqta])/g, (_, a) => {
      if (a === 's') return args.shift();
      if (a === 'q') return quoteStr(args.shift());
      if (a === 't') return quoteStr(args.shift(), "'");
      if (a === 'a') return smartQuote(args.shift());
    });
}

export function trueMap<T>(
  f: T | null | undefined,
  cb: (input: T) => string
): string {
  if (f == null) return '';
  if (Array.isArray(f) && f.length === 0) return '';
  return cb(f);
}

function cond(key: string): (l: string, r: unknown) => string {
  switch (key) {
    case '_eq':
      return fmt`%s = %a`;
    case '_neq':
      return fmt`%s != %a`;
    case '_gt':
      return fmt`%s > %a`;
    case '_gte':
      return fmt`%s >= %a`;
    case '_lt':
      return fmt`%s < %a`;
    case '_lte':
      return fmt`%s <= %a`;
    case '_in':
      return fmt`%s IN %a`;
    case '_nin':
      return fmt`%s NOT IN %a`;
    case '_is_null':
      return (left, right) =>
        right ? fmt`%s IS NULL`(left) : fmt`%s IS NOT NULL`(left);
  }
  throw new Error('invalid cond ' + key);
}

function generateWhereCond(
  key: string,
  input: Record<string, unknown>,
  self: string
): string {
  const first = Object.entries(input)?.[0];
  if (first) {
    const [type, value] = first;
    const left = fmt`%q.%q`(self, key);
    return cond(type)(left, value);
  }
  return '';
}

export function generateWhere(
  input: Record<string, unknown>,
  self: string
): string[] {
  const conds: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    switch (key) {
      case '_and':
        conds.push(...generateWhere(value as Record<string, unknown>, self));
        break;
      case '_or':
        conds.push(
          trueMap(generateWhere(value as Record<string, unknown>, self), (x) =>
            fmt`(%s)`(x.join(' OR '))
          )
        );
        break;
      case '_not':
        conds.push(
          trueMap(generateWhere(value as Record<string, unknown>, self), (x) =>
            fmt`NOT (%s)`(x.join(' AND '))
          )
        );
        break;
      default:
        conds.push(
          generateWhereCond(key, value as Record<string, unknown>, self)
        );
    }
  }
  return conds.filter(Boolean);
}

export function generateOrderBy(
  input: Record<string, string>,
  self: string
): string[] {
  return Object.entries(input).map(([k, v]) =>
    fmt`%q.%q %s`(self, k, v.replaceAll('_', ' ').toUpperCase())
  );
}

export class SQLSelections {
  #selections = new Map<string, string>();

  add(key: string, value: string) {
    this.#selections.set(key, value);
  }
  add$(key: string, value: string) {
    this.#selections.set('$' + key, value);
  }
  asJSON() {
    return [...this.#selections.entries()]
      .map(([key, value]) => fmt`%t, (%s)`(key, value))
      .join(', ');
  }
  asSelect() {
    return [...this.#selections.entries()]
      .map(([key, value]) => fmt`(%s) AS %q`(value, key))
      .join(', ');
  }
}