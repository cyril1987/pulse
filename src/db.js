const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// ─── Create Turso/LibSQL client ─────────────────────────────────────────────

const client = createClient({
  url: config.turso.url,
  authToken: config.turso.authToken,
});

// ─── Adapter: mimic better-sqlite3 API but async ────────────────────────────
//
// better-sqlite3 usage:     db.prepare(sql).get(...params)   (sync)
// Turso/LibSQL usage:  await db.prepare(sql).get(...params)   (async)
//
// This adapter lets us keep the same call-sites: db.prepare(sql).get/run/all()
// The only change in calling code is adding `await` in front.

const db = {
  /**
   * Returns a statement-like object with async get/run/all methods.
   */
  prepare(sql) {
    return {
      async get(...args) {
        const rs = await client.execute({ sql, args });
        if (rs.rows.length === 0) return undefined;
        return rowToObject(rs.rows[0], rs.columns);
      },

      async run(...args) {
        const rs = await client.execute({ sql, args });
        return {
          changes: rs.rowsAffected,
          lastInsertRowid: rs.lastInsertRowid ? Number(rs.lastInsertRowid) : 0,
        };
      },

      async all(...args) {
        const rs = await client.execute({ sql, args });
        return rs.rows.map(row => rowToObject(row, rs.columns));
      },
    };
  },

  /**
   * Execute raw SQL (multiple statements). Used for migrations.
   */
  async exec(sql) {
    await client.executeMultiple(sql);
  },

  /**
   * Run a group of operations in a transaction.
   * Usage:
   *   await db.transaction(async (tx) => {
   *     await tx.prepare('INSERT ...').run(val1, val2);
   *   });
   */
  async transaction(fn) {
    const tx = await client.transaction('write');
    try {
      // Add a prepare() helper on the transaction object
      tx.prepare = (sql) => ({
        async get(...args) {
          const rs = await tx.execute({ sql, args });
          if (rs.rows.length === 0) return undefined;
          return rowToObject(rs.rows[0], rs.columns);
        },
        async run(...args) {
          const rs = await tx.execute({ sql, args });
          return {
            changes: rs.rowsAffected,
            lastInsertRowid: rs.lastInsertRowid ? Number(rs.lastInsertRowid) : 0,
          };
        },
        async all(...args) {
          const rs = await tx.execute({ sql, args });
          return rs.rows.map(row => rowToObject(row, rs.columns));
        },
      });

      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  /**
   * Execute a PRAGMA statement. Turso/LibSQL supports a subset of PRAGMAs.
   */
  async pragma(statement) {
    try {
      await client.execute(`PRAGMA ${statement}`);
    } catch {
      // Some PRAGMAs are not supported by Turso — ignore silently
    }
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert a LibSQL Row to a plain object with column names as keys.
 */
function rowToObject(row, columns) {
  if (!row) return undefined;
  const obj = {};
  for (const col of columns) {
    let val = row[col];
    // Convert BigInt to Number for compatibility with existing code
    if (typeof val === 'bigint') {
      val = Number(val);
    }
    obj[col] = val;
  }
  return obj;
}

// ─── Run Migrations ─────────────────────────────────────────────────────────

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const migrationFiles = [
    '001-initial-schema.sql',
    '002-add-paused-until.sql',
    '003-add-users.sql',
    '004-add-microsoft-sso.sql',
    '005-add-custom-headers.sql',
    '006-add-monitor-groups.sql',
    '007-add-tasks.sql',
    '008-add-jira-integration.sql',
    '009-add-private-tasks.sql',
    '010-add-ismart-tickets.sql',
    '011-add-jira-sprint.sql',
    '012-add-notification-prefs.sql',
  ];

  for (const file of migrationFiles) {
    const filePath = path.join(migrationsDir, file);
    if (!fs.existsSync(filePath)) continue;

    const sql = fs.readFileSync(filePath, 'utf8');
    try {
      await client.executeMultiple(sql);
    } catch (e) {
      // Migration already applied or column already exists — ignore
      // This matches the original better-sqlite3 behavior of try/catch per migration
    }
  }

  console.log('[DB] Migrations complete');
}

// ─── Initialize ─────────────────────────────────────────────────────────────

// Export the db adapter immediately, but also export a promise for migration readiness.
// The app must `await dbReady` before handling requests.
const dbReady = runMigrations().then(() => db);

module.exports = db;
module.exports.dbReady = dbReady;
