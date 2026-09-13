import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };

const cli = join(import.meta.dir, "..", "src", "kvstore.ts");
const directories: string[] = [];

function tempDataHome(): string {
  const directory = mkdtempSync(join(tmpdir(), "kvstore-test-"));
  directories.push(directory);
  return directory;
}

function kv(dataHome: string, ...args: string[]) {
  const result = Bun.spawnSync([process.execPath, cli, ...args], {
    env: { ...process.env, XDG_DATA_HOME: dataHome },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("global options", () => {
  test("prints help", () => {
    const result = kv(tempDataHome(), "--help");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: kvstore --db NAME");
  });

  test("prints the package version", () => {
    const result = kv(tempDataHome(), "--version");
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });
});

describe("store commands", () => {
  test("sets, gets, lists, checks and deletes JSON values", () => {
    const dataHome = tempDataHome();

    expect(kv(dataHome, "--db", "test", "set", "user:2", "12345678901234567890").code).toBe(0);
    expect(kv(dataHome, "--db", "test", "set", "user:1", '{"name":"Ada"}').code).toBe(0);

    expect(kv(dataHome, "--db", "test", "get", "user:1")).toMatchObject({
      code: 0,
      stdout: '{"name":"Ada"}\n',
    });
    expect(kv(dataHome, "--db", "test", "has", "missing")).toMatchObject({
      code: 1,
      stdout: "false\n",
    });
    expect(kv(dataHome, "--db", "test", "list", "user:")).toMatchObject({
      code: 0,
      stdout: '{"user:1":{"name":"Ada"},"user:2":12345678901234567890}\n',
    });
    expect(kv(dataHome, "--db", "test", "del", "user:1").code).toBe(0);
    expect(kv(dataHome, "--db", "test", "get", "user:1").code).toBe(1);
    expect(kv(dataHome, "--db", "test", "del", "user:1").code).toBe(1);
  });

  test("creates the database in the data directory", () => {
    const dataHome = tempDataHome();
    expect(kv(dataHome, "--db", "notes", "set", "x", "null").code).toBe(0);
    expect(readFileSync(join(dataHome, "kvstore", "notes.db")).length).toBeGreaterThan(0);
  });

  test("rejects invalid JSON and database names", () => {
    const dataHome = tempDataHome();
    expect(kv(dataHome, "--db", "test", "set", "x", "nope").code).toBe(2);
    expect(kv(dataHome, "--db", "test", "set", "", "null").code).toBe(2);
    expect(kv(dataHome, "--db", "../test", "get", "x").code).toBe(2);
    expect(kv(dataHome, "--db", "test.db", "get", "x").code).toBe(2);
  });

  test("returns 75 instead of waiting when another writer holds the database", () => {
    const dataHome = tempDataHome();
    expect(kv(dataHome, "--db", "test", "set", "x", "1").code).toBe(0);

    const db = new Database(join(dataHome, "kvstore", "test.db"));
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = kv(dataHome, "--db", "test", "set", "x", "2");
      expect(result.code).toBe(75);
      expect(result.stderr).toContain("database is busy");
    } finally {
      db.exec("ROLLBACK");
      db.close();
    }
  });
});
