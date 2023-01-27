#!/usr/bin/env node
import { run, command, positional, option, subcommands } from 'cmd-ts';
import {
  GraphQLFile,
  ReadOnlyDatabaseFile,
  OutputStream,
} from './lib/cli-helper';
import { inferSchemaFromDatabase } from './lib/infer';
import { generateSqlInitialMigration } from '@qlite/core';

const output = option({
  type: OutputStream,
  long: 'output',
  short: 'o',
});

const init = command({
  name: 'init',
  args: {
    input: positional({
      type: GraphQLFile,
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

const app = subcommands({
  name: 'qlite',
  cmds: { init, infer },
});

run(app, process.argv.slice(2));
