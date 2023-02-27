import {
  generateSchema,
  generateSqlInitialMigration,
  QLiteConfig,
} from '@qlite/core';
import { GraphQLError } from 'graphql';
import { renderGraphiQL } from '@graphql-yoga/render-graphiql';
import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import Database, { SqliteError } from 'better-sqlite3';
import { readFileSync } from 'node:fs';

export interface ServeConfig {
  port: number;
  db?: string;
  seed?: string;
  debug: boolean;
}

export function serveHttp(config: QLiteConfig, serve_config: ServeConfig) {
  const db = new Database(serve_config.db ?? ':memory:');
  const get_changes = db.prepare('select changes() as affected_rows;');
  if (!serve_config.db) {
    const migration = generateSqlInitialMigration(config);
    if (serve_config.debug) console.log(migration);
    db.exec(migration);
    if (serve_config.seed) {
      const seed = readFileSync(serve_config.seed, { encoding: 'utf8' });
      if (serve_config.debug) console.log(seed);
      db.exec(seed);
    }
  }
  const schema = generateSchema(config, {
    one(_ctx, raw, parameters) {
      try {
        if (serve_config.debug) console.log(raw, parameters);
        const stmt = db.prepare(raw);
        return stmt.get(
          Object.fromEntries(parameters.map((x, i) => [i + 1, x]))
        );
      } catch (e) {
        if (e instanceof SqliteError) {
          throw new GraphQLError(e.message);
        }
        throw e;
      }
    },
    all(_ctx, raw, parameters) {
      try {
        if (serve_config.debug) console.log(raw, parameters);
        const stmt = db.prepare(raw);
        return stmt.all(
          Object.fromEntries(parameters.map((x, i) => [i + 1, x]))
        );
      } catch (e) {
        if (e instanceof SqliteError) {
          throw new GraphQLError(e.message);
        }
        throw e;
      }
    },
    mutate(_ctx, raw, parameters, do_returning: boolean) {
      try {
        if (serve_config.debug) console.log(raw);
        const stmt = db.prepare(raw);
        return db.transaction(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (): { affected_rows: number; returning: Array<any> } => {
            if (do_returning) {
              const returning = stmt.all(
                Object.fromEntries(parameters.map((x, i) => [i + 1, x]))
              );
              const affected_rows = get_changes.get().affected_rows as number;
              return {
                affected_rows,
                returning,
              };
            } else {
              stmt.run(
                Object.fromEntries(parameters.map((x, i) => [i + 1, x]))
              );
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
        if (serve_config.debug)
          tasks.forEach((x) => x && console.log(x.sql, x.parameters));
        const stmts = tasks.map((input) =>
          db
            .prepare(input.sql)
            .bind(
              Object.fromEntries(input.parameters.map((x, i) => [i + 1, x]))
            )
        );
        return db.transaction(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (): { affected_rows: number; returning: Array<any> }[] => {
            if (do_returning) {
              return stmts.map((stmt) => {
                const returning = stmt.all();
                const affected_rows = get_changes.get().affected_rows as number;
                return {
                  affected_rows,
                  returning,
                };
              });
            } else {
              return stmts.map((stmt) => {
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
    schema,
    renderGraphiQL,
    graphiql: true,
  });
  const server = createServer(yoga);
  server.listen(serve_config.port, () => {
    console.log('Server is running on ' + serve_config.port);
  });
}
