import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const ts = createRequire(import.meta.url)('typescript');
export function loadModule(file, globals = {}) {
  const cache = new Map();
  const load = (filename) => {
    if (cache.has(filename)) return cache.get(filename);
    const exports = {};
    cache.set(filename, exports);
    const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(source, { exports, URL, Request, Response, AbortSignal, Uint8Array, TextDecoder, btoa, atob, crypto: globalThis.crypto,
      fetch: globalThis.fetch, setTimeout, clearTimeout, console,
      require: (specifier) => load(resolve(dirname(filename), specifier.replace(/\.js$/, '.ts'))), ...globals }, { filename });
    return exports;
  };
  return load(file);
}
