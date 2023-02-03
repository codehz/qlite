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
  GraphQLFile,
  ReadOnlyDatabaseFile,
  OutputStream,
} from './lib/cli-helper.js';
import { inferSchemaFromDatabase } from './lib/infer.js';
import {
  filterOutBuiltinDefinitions,
  generateRootTypes,
  generateSqlInitialMigration,
} from '@qlite/core';
import { mergeSchemas } from '@graphql-tools/schema';
import { printSchema } from 'graphql';
import { serveHttp } from './lib/server.js';
import { printSchemaWithDirectives } from '@graphql-tools/utils';

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

const generate = command({
  name: 'generate',
  args: {
    input: positional({
      type: GraphQLFile,
    }),
    output,
    stripDirectives: flag({
      type: boolean,
      long: 'strip-directives',
      short: 's',
    }),
  },
  handler(args) {
    const [extended_schema, typedefs] = generateRootTypes(args.input);
    const schema = mergeSchemas({
      schemas: [extended_schema],
      typeDefs: [typedefs],
    });
    if (args.stripDirectives) {
      const mapped = filterOutBuiltinDefinitions(schema);
      args.output.write(printSchema(mapped) + '\n');
    } else {
      args.output.write(printSchemaWithDirectives(schema) + '\n');
    }
  },
});

const serve = command({
  name: 'serve',
  args: {
    input: positional({
      type: GraphQLFile,
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
