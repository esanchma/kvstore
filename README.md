# kvstore

`kvstore` is a small command-line JSON key-value store. Each named store is one SQLite database file. It requires no server and compiles to a standalone executable with Bun.

## Usage

```console
$ kvstore --db personal set user '{"name":"Ada"}'
$ kvstore --db personal get user
{"name":"Ada"}
$ kvstore --db personal has user
true
$ kvstore --db personal list
{"user":{"name":"Ada"}}
$ kvstore --db personal del user
```

The commands are:

```text
kvstore --db NAME set KEY JSON
kvstore --db NAME get KEY
kvstore --db NAME del KEY
kvstore --db NAME has KEY
kvstore --db NAME list [PREFIX]
kvstore --help
kvstore --version
```

`set` accepts any valid JSON value, and keys must not be empty. `list` sorts keys and prints one JSON object. Database names may contain letters, numbers, `.`, `_`, and `-`; they must not contain `..` or end in `.db`.

## Storage

Databases live at:

```text
$XDG_DATA_HOME/kvstore/NAME.db
```

If `XDG_DATA_HOME` is unset or relative, `kvstore` uses:

```text
$HOME/.local/share/kvstore/NAME.db
```

SQLite uses the `DELETE` journal mode and does not wait for locks. If another process holds a write lock, `kvstore` exits with status `75` so the caller can retry. SQLite can create a temporary `NAME.db-journal` file during a write and removes it afterward.

Exit statuses are:

- `0`: success
- `1`: key not found
- `2`: invalid usage or another error
- `75`: database busy; retry the operation

For `has`, a missing key prints `false` and exits with status `1`. `get` and `del` also return status `1` when the key does not exist.

## Development

Install [Bun](https://bun.sh/), then run:

```sh
bun test
bun run build
```

The build command creates the standalone executable at `dist/kvstore`.
