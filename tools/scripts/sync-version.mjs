import glob from 'fast-glob';
import { readFile, writeFile } from 'node:fs/promises';
import pkg from '../../package.json' assert { type: 'json' };

const version = pkg.version;
const to_be_update = await glob('packages/*/package.json');

for (const file of to_be_update) {
  const parsed = JSON.parse(await readFile(file, { encoding: 'utf-8' }));
  parsed.version = version;
  const result = JSON.stringify(parsed, null, 2) + '\n';
  await writeFile(file, result, { encoding: 'utf-8' });
}
