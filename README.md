# QLite

A lightweight GraphQL server which use SQLite3 as data source.

It will be deployable in Cloudflare Workers (WIP).

You can define your SQLite3 schema in a single GraphQL schema file (or generate GraphQL schema from existing SQLite3 database).

![**status: WIP!**](https://svg.hertz.services/text?content=Status:+WIP!&fontFamily=monospace&percent=0.9)

## Features

1. Define SQLite3 schema in the GraphQL schema file.
2. Generate GraphQL schema from existing SQLite Database.
3. Hasura-like query/mutation language (Subscriptions are planned), but not all features are supported, see [Limitations And Caveats](#limitions-and-caveats).
4. "Environment" Independent Design, the core component doesn't even depend on any SQLite3 binding, so it can be ported to many js runtime environments (like Cloudflare Workers and Deno Deploy).

## Install & usage

```shell
npm i -g @qlite/cli@latest
```

<details><summary>Sample Config File</summary>

```yaml
tables:
  books:
    columns:
      id: {type: integer, primary_key: true}
      title: {type: text, not_null: true}
      url: {type: text}
      created_at: {type: timestamp}
    relations:
      authors:
        type: array
        remote_table: book_author_maps
        mappings:
          id: book_id
  book_author_maps:
    columns:
      book_id: {type: integer, primary_key: true}
      author_id: {type: integer, primary_key: true}
    relations:
      book:
        type: object
        remote_table: books
        mappings:
          book_id: id
      author:
        type: object
        remote_table: authors
        mappings:
          author_id: id
  authors:
    columns:
      id: {type: integer, primary_key: true}
      name: {type: text, not_null: true}
      created_at: {type: timestamp}
    relations:
      books:
        type: array
        remote_table: book_author_maps
        mappings:
          id: author_id
```

</details>

Starting a dev server:

```shell
qlite serve x.yaml
```

And now you can play with the Graph*i*QL via [http://127.0.0.1:9000/graphql](http://127.0.0.1:9000/graphql)

## Limitations And Caveats

This project aimed to provide some level of hasura compatibility, but full compatibility with it is not the goal.

Supported features list:
1. [Simple Object Queries](https://hasura.io/docs/latest/queries/postgres/simple-object-queries/) (note the json support is still lack)
2. [Nested Object Queries](https://hasura.io/docs/latest/queries/postgres/nested-object-queries/)
3. [Aggregation Queries](https://hasura.io/docs/latest/queries/postgres/aggregation-queries/)
4. Basic [Filter Query Results / Search Queries](https://hasura.io/docs/latest/queries/postgres/query-filters/)
5. [Sort Query Results](https://hasura.io/docs/latest/queries/postgres/sorting/)
6. [Paginate Query Results](https://hasura.io/docs/latest/queries/postgres/pagination/)
7. (builtin) [Use Multiple Arguments in a Query](https://hasura.io/docs/latest/queries/postgres/multiple-arguments/)
8. (builtin) [Multiple Queries in a Request](https://hasura.io/docs/latest/queries/postgres/multiple-queries/)
9. [Use Variables / Aliases / Fragments / Directives in Queries](https://hasura.io/docs/latest/queries/postgres/variables-aliases-fragments-directives/)
10. [Filter based on nested objects' fields](https://hasura.io/docs/latest/queries/postgres/query-filters/#filter-based-on-nested-objects-fields)

Incomplete/Unsupported features list: 
1. Not all comparison operators and aggregate functions are supported, but some of them will be supported in future releases
2. [distinct_on](https://hasura.io/docs/latest/queries/postgres/distinct-queries/#the-distinct_on-argument) are not supported.
3. on_conflict type has different syntax
4. (TODO) JSON related feature
5. (TODO) [Insert an object along with its related objects through relationships](https://hasura.io/docs/latest/mutations/postgres/insert/#pg-nested-inserts)