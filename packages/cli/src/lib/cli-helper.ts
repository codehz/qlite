import { readFile } from 'node:fs/promises';
import { stdout } from 'node:process';
import { Writable } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { Type } from 'cmd-ts';
import {
  parse,
  GraphQLSchema,
  Source,
  DocumentNode,
  buildASTSchema,
} from 'graphql';
import SQLite3Database, { Database } from 'better-sqlite3';
import { BuiltinDefinitions, QLiteConfig } from '@qlite/core';
import yaml from 'yaml';

export const QLiteConfigFile: Type<string, QLiteConfig> = {
  displayName: 'QLiteConfig File',
  async from(input) {
    const file = await readFile(input, { encoding: 'utf-8' });
    const raw = yaml.parse(file);
    return QLiteConfig.parse(raw);
  },
};

export const GraphQLFile: Type<string, GraphQLSchema> = {
  displayName: 'GraphQL File',
  async from(input) {
    const file = await readFile(input, { encoding: 'utf-8' });
    try {
      const parsed = parse(new Source(file, input));
      const processed: DocumentNode = {
        ...parsed,
        definitions: [...BuiltinDefinitions.definitions, ...parsed.definitions],
      };
      return buildASTSchema(processed);
    } catch (e) {
      throw new Error('Failed to parse graphql schema.\n' + e);
    }
  },
};

export const ReadOnlyDatabaseFile: Type<string, Database> = {
  displayName: 'SQLite3 Database file (readonly)',
  async from(input) {
    return new SQLite3Database(input, { readonly: true });
  },
};

export const DatabaseFile: Type<string, Database> = {
  displayName: 'SQLite3 Database file',
  async from(input) {
    return new SQLite3Database(input);
  },
};

export const OutputStream: Type<string, Writable> = {
  displayName: 'Output file stream',
  defaultValue: () => stdout,
  async from(input) {
    return createWriteStream(input, { encoding: 'utf-8' });
  },
};
