import {
  generateResolver,
  generateRootTypes,
  generateSqlInitialMigration,
} from '@qlite/core';
import { buildSchema, GraphQLSchema } from 'graphql';
import { renderGraphiQL } from '@graphql-yoga/render-graphiql';
import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { makeExecutableSchema } from '@graphql-tools/schema';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { printSchemaWithDirectives } from '@graphql-tools/utils';

export interface ServeConfig {
  port: number;
  db?: string;
  seed?: string;
}

// workaround
function cloneSchema(schema: GraphQLSchema) {
  return buildSchema(printSchemaWithDirectives(schema));
}

export function serveHttp(schema: GraphQLSchema, config: ServeConfig) {
  const db = new Database(config.db ?? ':memory:');
  const get_changes = db.prepare('select changes() as affected_rows;');
  if (!config.db) {
    const migration = generateSqlInitialMigration(schema);
    db.exec(migration);
    if (config.seed) {
      const seed = readFileSync(config.seed, { encoding: 'utf8' });
      db.exec(seed);
    }
  }
  const [extended_schema, typedefs] = generateRootTypes(schema);
  const resolver = generateResolver(cloneSchema(extended_schema), {
    one(raw, parameters) {
      const stmt = db.prepare(raw);
      return stmt.get(...parameters);
    },
    all(raw, parameters) {
      const stmt = db.prepare(raw);
      return stmt.all(...parameters);
    },
    mutate(raw, parameters, do_returning: boolean) {
      const stmt = db.prepare(raw);
      return db.transaction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (): { affected_rows: number; returning: Array<any> } => {
          if (do_returning) {
            const returning = stmt.all(...parameters);
            const affected_rows = get_changes.get().affected_rows as number;
            return {
              affected_rows,
              returning,
            };
          } else {
            stmt.run(...parameters);
            const affected_rows = get_changes.get().affected_rows as number;
            return {
              affected_rows,
              returning: [],
            };
          }
        }
      )();
    },
  });
  const yoga = createYoga({
    schema: makeExecutableSchema({
      typeDefs: [extended_schema, typedefs],
      resolvers: resolver,
    }),
    renderGraphiQL,
    graphiql: true,
  });
  const server = createServer(yoga);
  server.listen(config.port, () => {
    console.log('Server is running on ' + config.port);
  });
}
