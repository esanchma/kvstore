#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import packageJson from "../package.json" with { type: "json" };

const HELP = `Usage: kvstore --db NAME COMMAND [ARGUMENTS]

A small JSON key-value store backed by SQLite.

Commands:
  set KEY JSON    Store a JSON value
  get KEY         Print a stored value
  del KEY         Delete a value
  has KEY         Print whether a key exists
  list [PREFIX]   Print matching entries as a JSON object

Options:
  -h, --help      Show this help
  -v, --version   Show the version

Databases are stored under \$XDG_DATA_HOME/kvstore, or
\$HOME/.local/share/kvstore when XDG_DATA_HOME is not set.

Exit codes:
  0  Success
  1  Key not found
  2  Invalid usage or other error
  75 Database busy; retry the operation`;

function usageError(message: string): never {
  console.error(`kvstore: ${message}\nTry 'kvstore --help' for more information.`);
  process.exit(2);
}

function databasePath(name: string): string {
  if (
    !/^[A-Za-z0-9._-]+$/.test(name) ||
    name === "." ||
    name.includes("..") ||
    name.endsWith(".db")
  ) {
    usageError(
      "database NAME must use only letters, numbers, '.', '_' or '-', without '..' or a '.db' suffix",
    );
  }

  const xdgDataHome = process.env.XDG_DATA_HOME;
  let dataHome: string;
  if (xdgDataHome && isAbsolute(xdgDataHome)) {
    dataHome = xdgDataHome;
  } else {
    const home = process.env.HOME;
    if (!home) usageError("HOME is not set");
    dataHome = join(home, ".local", "share");
  }

  const directory = join(dataHome, "kvstore");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return join(directory, `${name}.db`);
}

function isBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const sqliteError = error as Error & { code?: string; errno?: number };
  return (
    sqliteError.code === "SQLITE_BUSY" ||
    sqliteError.code === "SQLITE_LOCKED" ||
    sqliteError.errno === 5 ||
    sqliteError.errno === 6
  );
}

function requireArguments(command: string, args: string[], count: number): void {
  if (args.length !== count) {
    usageError(`${command} expects ${count} argument${count === 1 ? "" : "s"}`);
  }
}

function requireKey(command: string, args: string[], count: number): void {
  requireArguments(command, args, count);
  if (args[0] === "") usageError("KEY must not be empty");
}

function run(db: Database, command: string, args: string[]): number {
  switch (command) {
    case "set": {
      requireKey(command, args, 2);
      try {
        JSON.parse(args[1]);
      } catch {
        usageError("set value must be valid JSON");
      }
      db.query(
        "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      ).run(args[0], args[1]);
      return 0;
    }

    case "get": {
      requireKey(command, args, 1);
      const row = db.query("SELECT value FROM kv WHERE key = ?").get(args[0]) as
        | { value: string }
        | null;
      if (!row) return 1;
      console.log(row.value);
      return 0;
    }

    case "del": {
      requireKey(command, args, 1);
      const result = db.query("DELETE FROM kv WHERE key = ?").run(args[0]);
      return result.changes === 0 ? 1 : 0;
    }

    case "has": {
      requireKey(command, args, 1);
      const found = db.query("SELECT 1 FROM kv WHERE key = ?").get(args[0]) !== null;
      console.log(found);
      return found ? 0 : 1;
    }

    case "list": {
      if (args.length > 1) usageError("list expects at most 1 argument");
      const prefix = args[0] ?? "";
      const rows = db
        .query(
          "SELECT key, value FROM kv WHERE substr(key, 1, length(?)) = ? ORDER BY key",
        )
        .all(prefix, prefix) as Array<{ key: string; value: string }>;
      console.log(`{${rows.map(({ key, value }) => `${JSON.stringify(key)}:${value}`).join(",")}}`);
      return 0;
    }

    default:
      usageError(`unknown command '${command}'`);
  }
}

function main(): number {
  const argv = Bun.argv.slice(2);
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(HELP);
    return 0;
  }
  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
    console.log(packageJson.version);
    return 0;
  }
  if (argv.length < 3 || argv[0] !== "--db") {
    usageError("expected --db NAME followed by a command");
  }

  let db: Database | undefined;
  try {
    db = new Database(databasePath(argv[1]), { create: true });
    db.exec("PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 0;");
    db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID");
    return run(db, argv[2], argv.slice(3));
  } catch (error) {
    if (isBusy(error)) {
      console.error("kvstore: database is busy; retry the operation");
      return 75;
    }
    console.error(`kvstore: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  } finally {
    db?.close();
  }
}

process.exitCode = main();
