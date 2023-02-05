import {
  fixupResult,
  generateResolver,
  generateRootTypes,
  generateSqlInitialMigration,
} from '@qlite/core';
import { buildSchema, GraphQLError, GraphQLSchema } from 'graphql';
import { renderGraphiQL } from '@graphql-yoga/render-graphiql';
import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { makeExecutableSchema } from '@graphql-tools/schema';
import Database, { SqliteError } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { printSchemaWithDirectives } from '@graphql-tools/utils';

export interface ServeConfig {
  port: number;
  db?: string;
  seed?: string;
  debug: boolean;
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
    one(_ctx, raw, parameters) {
      try {
        if (config.debug) console.log(raw);
        const stmt = db.prepare(raw);
        return fixupResult(stmt.get(...parameters));
      } catch (e) {
        if (e instanceof SqliteError) {
          throw new GraphQLError(e.message);
        }
        throw e;
      }
    },
    all(_ctx, raw, parameters) {
      try {
        if (config.debug) console.log(raw);
        const stmt = db.prepare(raw);
        return stmt.all(...parameters).map(fixupResult);
      } catch (e) {
        if (e instanceof SqliteError) {
          throw new GraphQLError(e.message);
        }
        throw e;
      }
    },
    mutate(_ctx, raw, parameters, do_returning: boolean) {
      try {
        if (config.debug) console.log(raw);
        const stmt = db.prepare(raw);
        return db.transaction(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (): { affected_rows: number; returning: Array<any> } => {
            if (do_returning) {
              const returning = stmt.all(...parameters).map(fixupResult);
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
      } catch (e) {
        if (e instanceof SqliteError) {
          throw new GraphQLError(e.message);
        }
        throw e;
      }
    },
    mutate_batch(_ctx, tasks, do_returning: boolean) {
      try {
        if (config.debug) tasks.forEach((x) => x && console.log(x?.sql));
        const stmts = tasks.map((input) =>
          input ? db.prepare(input.sql).bind(...input.parameters) : undefined
        );
        return db.transaction(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (): { affected_rows: number; returning: Array<any> }[] => {
            if (do_returning) {
              return stmts.map((stmt) => {
                if (stmt == null)
                  return {
                    affected_rows: 0,
                    returning: [],
                  };
                const returning = stmt.all().map(fixupResult);
                const affected_rows = get_changes.get().affected_rows as number;
                return {
                  affected_rows,
                  returning,
                };
              });
            } else {
              return stmts.map((stmt) => {
                if (stmt == null)
                  return {
                    affected_rows: 0,
                    returning: [],
                  };
                stmt.run();
                const affected_rows = get_changes.get().affected_rows as number;
                return {
                  affected_rows,
                  returning: [],
                };
              });
            }
          }
        )();
      } catch (e) {
        if (e instanceof SqliteError) {
          throw new GraphQLError(e.message);
        }
        throw e;
      }
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
