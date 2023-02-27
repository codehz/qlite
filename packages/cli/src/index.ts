#!/usr/bin/env node
import {
  run,
  command,
  positional,
  option,
  subcommands,
  flag,
  boolean,
  number,
  optional,
  string,
} from 'cmd-ts';
import {
  ReadOnlyDatabaseFile,
  OutputStream,
  QLiteConfigFile,
} from './lib/cli-helper.js';
import { inferSchemaFromDatabase } from './lib/infer.js';
import {
  generateSchema,
  generateSqlInitialMigration,
} from '@qlite/core';
import { printSchema } from 'graphql';
import { serveHttp } from './lib/server.js';

const output = option({
  type: OutputStream,
  long: 'output',
  short: 'o',
});

const init = command({
  name: 'init',
  args: {
    input: positional({
      type: QLiteConfigFile,
    }),
    output,
  },
  handler(args) {
    const migration = generateSqlInitialMigration(args.input);
    args.output.write(migration + '\n');
  },
});

const infer = command({
  name: 'infer',
  args: {
    db: positional({
      type: ReadOnlyDatabaseFile,
    }),
    output,
  },
  handler(args) {
    const result = inferSchemaFromDatabase(args.db);
    args.output.write(result + '\n');
  },
});

const generate = command({
  name: 'generate',
  args: {
    input: positional({
      type: QLiteConfigFile,
    }),
    output,
    stripDirectives: flag({
      type: boolean,
      long: 'strip-directives',
      short: 's',
    }),
  },
  handler(args) {
    const schema = generateSchema(args.input);
    args.output.write(printSchema(schema));
  },
});

const serve = command({
  name: 'serve',
  args: {
    input: positional({
      type: QLiteConfigFile,
    }),
    port: option({
      long: 'port',
      short: 'p',
      type: number,
      defaultValue: () => 9000,
    }),
    db: option({
      long: 'database',
      type: optional(string),
    }),
    seed: option({
      long: 'seed',
      type: optional(string),
    }),
    debug: flag({
      type: boolean,
      long: 'debug',
    }),
  },
  handler(args) {
    serveHttp(args.input, args);
  },
});

const app = subcommands({
  name: 'qlite',
  cmds: { init, infer, generate, serve },
});

run(app, process.argv.slice(2));
