// In-memory stand-in for a Cloudflare D1 binding (copied from DogHouse), backed by Node's built-in SQLite (the same
// engine D1 runs). It applies the real files in migrations/, so tests exercise the real schema.
// `queries` counts statements run (each one in a batch too), to check the free plan's 50 per request.
// fakeD1({ skip: ['0009_item_versions.sql'] }) leaves migrations out, for code that must cope without them
// (and any later one that alters a table left out).
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

const plain = (row) => (row ? { ...row } : null);

class Statement {
  constructor(db, sql, params = [], count = { n: 0 }) {
    this.db = db;
    this.sql = sql;
    this.params = params;
    this.count = count;
  }
  bind(...params) {
    return new Statement(this.db, this.sql, params, this.count);
  }
  async all() {
    this.count.n++;
    return { results: this.db.prepare(this.sql).all(...this.params).map(plain), success: true };
  }
  async first(col) {
    this.count.n++;
    const row = plain(this.db.prepare(this.sql).get(...this.params));
    return col ? (row?.[col] ?? null) : row;
  }
  async run() {
    this.count.n++;
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(r.changes) } };
  }
}

export function fakeD1({ migrate = true, skip = [] } = {}) {
  const db = new DatabaseSync(':memory:');
  if (migrate) {
    for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql') && !skip.includes(n)).sort()) {
      try {
        db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
      } catch (err) {
        // A later migration that changes a table left out with `skip` is left out too.
        if (!skip.length || !/no such table/i.test(String(err?.message))) throw err;
      }
    }
  }
  const count = { n: 0 };
  return {
    raw: db,
    get queries() { return count.n; },
    resetQueries() { count.n = 0; },
    prepare: (sql) => new Statement(db, sql, [], count),

    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
