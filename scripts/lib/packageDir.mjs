import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Locates an installed package's directory on disk.
 *
 * `require.resolve('<pkg>/package.json')` cannot be used here: a package with an
 * `exports` map only exposes the subpaths it lists, and none of the three
 * packages we pull assets from export their own manifest. That restriction is
 * about module resolution, and what these scripts want is different in kind —
 * the WebAssembly binaries and model paths that live *inside* the installed
 * directory, which the package never intended to be imported.
 *
 * So resolution is done the way Node itself locates a package: walk up from
 * `from`, checking each `node_modules` on the way. Starting from a dependent's
 * own directory finds a nested copy first and a hoisted one second, which keeps
 * this correct under either npm layout.
 */
export function packageDir(name, from) {
  const segments = name.split('/');
  let directory = resolve(from);

  for (;;) {
    const candidate = join(directory, 'node_modules', ...segments);
    if (existsSync(join(candidate, 'package.json'))) return candidate;

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Cannot locate package "${name}" starting from ${from}`);
    }
    directory = parent;
  }
}
