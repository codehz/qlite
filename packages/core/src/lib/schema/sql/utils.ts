export function quoteStr(str: string, quote = '"') {
  return quote + str.replaceAll(quote, quote + quote) + quote;
}
export function smartQuote(input: unknown): string {
  if (Array.isArray(input)) return '(' + input.map(smartQuote) + ')';
  if (typeof input === 'string') return quoteStr(input, "'");
  return input + '';
}
export function fmt(
  template: { raw: readonly string[] | ArrayLike<string> },
  ...substitutions: unknown[]
) {
  const tmp = String.raw(template, ...substitutions);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (...args: any[]) =>
    tmp.replace(/%([sqta?])/g, (_, a) => {
      if (a === 's') return args.shift();
      if (a === 'q') return quoteStr(args.shift());
      if (a === 't') return quoteStr(args.shift(), "'");
      if (a === 'a') return smartQuote(args.shift());
      if (a === '?') return '?' + args.shift();
    });
}

export function trueMap<T>(
  f: T | null | undefined,
  cb: (input: T) => string
): string {
  if (f == null) return '';
  if (typeof f === 'string' && f === '') return '';
  if (Array.isArray(f) && f.length === 0) return '';
  return cb(f);
}

export function trueMap2<T1, T2>(
  f: T1 | null | undefined,
  cb1: (input: T1) => T2 | null | undefined,
  cb2: (input: T2) => string
): string {
  if (f == null) return '';
  if (typeof f === 'string' && f === '') return '';
  if (Array.isArray(f) && f.length === 0) return '';
  return trueMap(cb1(f), cb2);
}

export class JsonSelections {
  #selections = new Map<string, string>();

  add(key: string, value: string, wrap = false) {
    this.#selections.set(key, wrap ? fmt`(%s)`(value) : value);
  }
  add$(key: string, value: string, wrap = false) {
    this.#selections.set('$' + key, wrap ? fmt`(%s)`(value) : value);
  }
  merge(rhs: JsonSelections) {
    for (const [key, value] of rhs.#selections) {
      this.#selections.set(key, value);
    }
  }
  get empty() {
    return this.#selections.size === 0;
  }
  toString() {
    return fmt`json_object(%s)`(
      [...this.#selections.entries()]
        .map(([key, value]) => fmt`%t, %s`(key, value))
        .join(', ')
    );
  }
}

export class SQLParameters {
  readonly array: unknown[] = [];

  add(parameter: unknown) {
    return this.array.push(parameter);
  }
}
