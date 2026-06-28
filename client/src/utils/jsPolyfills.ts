// Runtime polyfills for JS proposals used by pdfjs-dist v5.7+ that aren't
// yet in older Electron / Chromium / Safari versions.
//
// Map.prototype.getOrInsertComputed (TC39 Stage 3) — added to Chromium 132
// (Electron 34, Jan 2025). Older runtimes throw
// `TypeError: this[#t].getOrInsertComputed is not a function` when PDF.js
// tries to render. We patch Map and WeakMap prototypes here, imported at
// the very top of main.tsx so the patch is in place before any PDF.js code
// runs on the main thread.
//
// Workers run in their own realm and don't see this patch — but PDF.js
// only calls getOrInsertComputed on the main-thread side of its public
// API in the versions we use, so a main-thread polyfill is sufficient.
//
// References:
//   https://github.com/tc39/proposal-upsert
//   https://chromestatus.com/feature/6193716903116800

interface MapWithGetOrInsert<K, V> extends Map<K, V> {
  getOrInsert?(key: K, defaultValue: V): V;
  getOrInsertComputed?(key: K, callbackfn: (key: K) => V): V;
}

interface WeakMapWithGetOrInsert<K extends WeakKey, V> extends WeakMap<K, V> {
  getOrInsert?(key: K, defaultValue: V): V;
  getOrInsertComputed?(key: K, callbackfn: (key: K) => V): V;
}

if (!(Map.prototype as MapWithGetOrInsert<unknown, unknown>).getOrInsertComputed) {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    value: function <K, V>(this: Map<K, V>, key: K, callbackfn: (key: K) => V): V {
      if (this.has(key)) return this.get(key) as V;
      const v = callbackfn(key);
      this.set(key, v);
      return v;
    },
    writable: true,
    configurable: true,
  });
}

if (!(Map.prototype as MapWithGetOrInsert<unknown, unknown>).getOrInsert) {
  Object.defineProperty(Map.prototype, 'getOrInsert', {
    value: function <K, V>(this: Map<K, V>, key: K, defaultValue: V): V {
      if (this.has(key)) return this.get(key) as V;
      this.set(key, defaultValue);
      return defaultValue;
    },
    writable: true,
    configurable: true,
  });
}

if (!(WeakMap.prototype as WeakMapWithGetOrInsert<WeakKey, unknown>).getOrInsertComputed) {
  Object.defineProperty(WeakMap.prototype, 'getOrInsertComputed', {
    value: function <K extends WeakKey, V>(this: WeakMap<K, V>, key: K, callbackfn: (key: K) => V): V {
      if (this.has(key)) return this.get(key) as V;
      const v = callbackfn(key);
      this.set(key, v);
      return v;
    },
    writable: true,
    configurable: true,
  });
}

if (!(WeakMap.prototype as WeakMapWithGetOrInsert<WeakKey, unknown>).getOrInsert) {
  Object.defineProperty(WeakMap.prototype, 'getOrInsert', {
    value: function <K extends WeakKey, V>(this: WeakMap<K, V>, key: K, defaultValue: V): V {
      if (this.has(key)) return this.get(key) as V;
      this.set(key, defaultValue);
      return defaultValue;
    },
    writable: true,
    configurable: true,
  });
}
