/* eslint-disable @typescript-eslint/no-explicit-any */
const keymapper = new WeakMap<object, number>();
let lastid = 0;

function objectid(input: any): any {
  if (typeof input === 'object') {
    const ret = keymapper.get(input);
    if (ret) return ret;
    const val = lastid++;
    keymapper.set(input, val);
    return val;
  } else return input;
}

type Holder<T> = { value: T | undefined };

export class CacheManager<T> {
  #storage: Map<string, Holder<T>> = new Map();
  cache<A extends any[]>(...args: A) {
    const key = args.map(objectid).join(':');
    let obj = this.#storage.get(key);
    if (!obj) {
      obj = { value: undefined };
      this.#storage.set(key, obj);
    }
    return obj;
  }
  purge<A extends any[]>(...args: A) {
    const key = args.map(objectid).join(':');
    this.#storage.delete(key);
  }
  purgePrefix<A extends any[]>(...args: A) {
    const prefix = args.map(objectid).join(':') + ':';
    for (const key of this.#storage.keys()) {
      if (key.startsWith(prefix)) this.#storage.delete(key);
    }
  }
}
