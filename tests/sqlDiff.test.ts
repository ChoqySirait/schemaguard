import { describe, it, expect } from 'vitest';
import { RiskLevel } from '../src/types';
import {
  extractStatementMetadata,
  parseSqlStatements,
  stripComments
} from '../src/analyzer/sqlParser';
import {
  analyzeSqlStatement,
  analyzeSqlText,
  buildAnalysisSummary,
  compareSqlDiff,
  detectAccessExclusiveLocks,
  detectLockContention,
  filterIssuesByDialect
} from '../src/analyzer/sqlDiff';

describe('SQL Parser & Sanitizer', () => {
  it('harus membersihkan komentar satu baris dan banyak baris dengan benar', () => {
    const rawSql = `
      -- Ini adalah komentar baris tunggal
      ALTER TABLE users DROP COLUMN avatar;
      /*
        Komentar banyak baris
        DROP TABLE users;
      */
      SELECT 1;
    `;
    const cleaned = stripComments(rawSql);
    expect(cleaned).not.toContain('Ini adalah komentar baris tunggal');
    expect(cleaned).not.toContain('Komentar banyak baris');
    expect(cleaned).toContain('ALTER TABLE users DROP COLUMN avatar;');
  });

  it('harus membagi pernyataan SQL berdasarkan titik koma dan melacak baris', () => {
    const rawSql = `
      CREATE TABLE orders (id INT);
      DROP TABLE old_orders;
    `;
    const statements = parseSqlStatements(rawSql);
    expect(statements.length).toBe(2);
    expect(statements[0].statement).toContain('CREATE TABLE orders');
    expect(statements[1].statement).toContain('DROP TABLE old_orders');
    expect(statements[1].table).toBe('old_orders');
  });

  it('tidak boleh memecah pernyataan jika titik koma berada di dalam string literal', () => {
    const rawSql = "INSERT INTO configs (val) VALUES ('a;b;c');\nALTER TABLE users DROP COLUMN bio;";
    const statements = parseSqlStatements(rawSql);
    expect(statements.length).toBe(2);
    expect(statements[0].statement).toContain("'a;b;c'");
    expect(statements[1].statement).toContain('ALTER TABLE users DROP COLUMN bio');
  });

  it('harus mengekstrak metadata operasi rename dan alter column type', () => {
    const metaRename = extractStatementMetadata('ALTER TABLE users RENAME COLUMN legacy_name TO current_name');
    expect(metaRename.operationType).toBe('ALTER_TABLE_RENAME_COLUMN');
    expect(metaRename.table).toBe('users');
    expect(metaRename.column).toBe('legacy_name');
    expect(metaRename.newColumn).toBe('current_name');

    const metaAlterType = extractStatementMetadata('ALTER TABLE orders ALTER COLUMN price TYPE NUMERIC(12,2)');
    expect(metaAlterType.operationType).toBe('ALTER_TABLE_ALTER_COLUMN_TYPE');
    expect(metaAlterType.table).toBe('orders');
    expect(metaAlterType.column).toBe('price');
    expect(metaAlterType.targetType).toBe('NUMERIC(12,2)');
  });

  it('harus menganalisis statement individual dengan analyzeSqlStatement', () => {
    const stmt = parseSqlStatements('DROP TABLE legacy_users;')[0];
    const issues = analyzeSqlStatement(stmt, 'test.sql');
    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('DROP_TABLE');
    expect(issues[0].lockMode).toBe('ACCESS_EXCLUSIVE');
  });

  it('harus mengonstruksi ringkasan analisis dengan buildAnalysisSummary', () => {
    const summary = buildAnalysisSummary([], 5);
    expect(summary.totalStatements).toBe(5);
    expect(summary.passed).toBe(true);
    expect(summary.criticalCount).toBe(0);
    expect(summary.accessExclusiveCount).toBe(0);
    expect(summary.lockContentionCount).toBe(0);
  });
});

describe('SQL Diff Engine - DDL Lock Contention Detection', () => {
  it('harus mendeteksi DROP TABLE sebagai CRITICAL dengan ACCESS_EXCLUSIVE lock', () => {
    const sql = 'DROP TABLE customers;';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('DROP_TABLE');
    expect(issues[0].riskLevel).toBe(RiskLevel.CRITICAL);
    expect(issues[0].lockMode).toBe('ACCESS_EXCLUSIVE');
    expect(issues[0].table).toBe('customers');
  });

  it('harus mendeteksi DROP COLUMN sebagai CRITICAL dengan ACCESS_EXCLUSIVE lock', () => {
    const sql = 'ALTER TABLE users DROP COLUMN phone;';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('DROP_COLUMN');
    expect(issues[0].riskLevel).toBe(RiskLevel.CRITICAL);
    expect(issues[0].lockMode).toBe('ACCESS_EXCLUSIVE');
    expect(issues[0].table).toBe('users');
    expect(issues[0].column).toBe('phone');
  });

  it('harus mendeteksi ALTER COLUMN TYPE sebagai CRITICAL dengan ACCESS_EXCLUSIVE lock', () => {
    const sql = 'ALTER TABLE orders ALTER COLUMN price TYPE NUMERIC(10,2);';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('ALTER_COLUMN_TYPE');
    expect(issues[0].riskLevel).toBe(RiskLevel.CRITICAL);
    expect(issues[0].lockMode).toBe('ACCESS_EXCLUSIVE');
    expect(issues[0].table).toBe('orders');
    expect(issues[0].column).toBe('price');
  });

  it('harus mendeteksi RENAME COLUMN sebagai CRITICAL dengan ACCESS_EXCLUSIVE lock', () => {
    const sql = 'ALTER TABLE accounts RENAME COLUMN username TO user_identifier;';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('RENAME_COLUMN');
    expect(issues[0].riskLevel).toBe(RiskLevel.CRITICAL);
    expect(issues[0].lockMode).toBe('ACCESS_EXCLUSIVE');
  });

  it('harus mendeteksi ADD COLUMN NOT NULL tanpa DEFAULT sebagai CRITICAL dengan ACCESS_EXCLUSIVE lock', () => {
    const sql = 'ALTER TABLE payments ADD COLUMN status VARCHAR(20) NOT NULL;';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('ADD_NOT_NULL_WITHOUT_DEFAULT');
    expect(issues[0].riskLevel).toBe(RiskLevel.CRITICAL);
    expect(issues[0].lockMode).toBe('ACCESS_EXCLUSIVE');
  });

  it('tidak boleh menandai ADD COLUMN NOT NULL jika memiliki klausa DEFAULT', () => {
    const sql = "ALTER TABLE payments ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'PENDING';";
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(0);
  });

  it('harus mendeteksi RENAME TABLE sebagai CRITICAL dengan ACCESS_EXCLUSIVE lock', () => {
    const sql = 'ALTER TABLE legacy_customers RENAME TO active_customers;';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('RENAME_TABLE');
    expect(issues[0].riskLevel).toBe(RiskLevel.CRITICAL);
    expect(issues[0].lockMode).toBe('ACCESS_EXCLUSIVE');
  });

  it('harus mendeteksi pembuatan indeks non-concurrently sebagai WARNING dengan SHARE lock', () => {
    const sql = 'CREATE INDEX idx_users_email ON users (email);';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('CREATE_INDEX_NON_CONCURRENTLY');
    expect(issues[0].riskLevel).toBe(RiskLevel.WARNING);
    expect(issues[0].lockMode).toBe('SHARE');
  });

  it('tidak boleh menandai pembuatan indeks yang menggunakan CONCURRENTLY', () => {
    const sql = 'CREATE INDEX CONCURRENTLY idx_users_email ON users (email);';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(0);
  });

  it('harus mendeteksi penambahan kolom dengan volatile default (now()) sebagai WARNING', () => {
    const sql = 'ALTER TABLE logs ADD COLUMN created_at TIMESTAMP DEFAULT now();';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('ADD_COLUMN_WITH_DEFAULT');
    expect(issues[0].riskLevel).toBe(RiskLevel.WARNING);
    expect(issues[0].lockMode).toBe('ACCESS_EXCLUSIVE');
  });

  it('harus mendeteksi penambahan constraint tanpa klausa NOT VALID sebagai WARNING', () => {
    const sql = 'ALTER TABLE orders ADD CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id);';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('VALIDATE_CONSTRAINT');
    expect(issues[0].riskLevel).toBe(RiskLevel.WARNING);
    expect(issues[0].lockMode).toBe('SHARE_ROW_EXCLUSIVE');
  });

  it('tidak boleh menandai penambahan constraint jika menggunakan NOT VALID', () => {
    const sql = 'ALTER TABLE orders ADD CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(0);
  });
});

describe('SQL Lock Utilities & Dialect Filtering', () => {
  it('harus menyaring hanya AccessExclusiveLock dengan detectAccessExclusiveLocks', () => {
    const sql = `
      DROP TABLE deprecated_logs;
      CREATE INDEX idx_users_name ON users (name);
      ALTER TABLE users DROP COLUMN nickname;
    `;
    const issues = analyzeSqlText(sql);
    const exclusiveLocks = detectAccessExclusiveLocks(issues);

    expect(exclusiveLocks.length).toBe(2);
    expect(exclusiveLocks.every((i) => i.lockMode === 'ACCESS_EXCLUSIVE')).toBe(true);
  });

  it('harus mendeteksi seluruh lock contention tingkat menengah dan tinggi dengan detectLockContention', () => {
    const sql = `
      DROP TABLE deprecated_logs;
      CREATE INDEX idx_users_name ON users (name);
      ALTER TABLE orders ADD CONSTRAINT fk_users FOREIGN KEY (user_id) REFERENCES users(id);
    `;
    const issues = analyzeSqlText(sql);
    const contended = detectLockContention(issues);

    expect(contended.length).toBe(3);
  });

  it('harus memfilter temuan berdasarkan dialek yang diminta', () => {
    const sql = `
      CREATE INDEX idx_test ON test_table (col);
      DROP TABLE test_table;
    `;
    const issues = analyzeSqlText(sql);
    const pgIssues = filterIssuesByDialect(issues, 'postgresql');
    expect(pgIssues.length).toBe(2);

    const mysqlIssues = filterIssuesByDialect(issues, 'mysql');
    // CREATE_INDEX_NON_CONCURRENTLY adalah spesifik postgresql
    expect(mysqlIssues.some((i) => i.ruleId === 'DROP_TABLE')).toBe(true);
  });
});

describe('SQL Diff Engine - Schema Comparison', () => {
  it('harus mendeteksi penambahan kueri berbahaya di cabang head dibanding base', () => {
    const baseSql = 'CREATE TABLE users (id INT, name TEXT);';
    const headSql = `
      CREATE TABLE users (id INT, name TEXT, email TEXT);
      ALTER TABLE users DROP COLUMN email;
      CREATE INDEX idx_users_name ON users (name);
    `;

    const result = compareSqlDiff(baseSql, headSql);
    expect(result.passed).toBe(false);
    expect(result.criticalCount).toBe(1);
    expect(result.warningCount).toBe(1);
    expect(result.accessExclusiveCount).toBe(1);
    expect(result.lockContentionCount).toBe(2);
    expect(result.issues.some((i) => i.ruleId === 'DROP_COLUMN')).toBe(true);
    expect(result.issues.some((i) => i.ruleId === 'CREATE_INDEX_NON_CONCURRENTLY')).toBe(true);
  });

  it('harus lulus jika head hanya menambahkan migrasi yang aman', () => {
    const baseSql = 'CREATE TABLE users (id INT);';
    const headSql = `
      CREATE TABLE users (id INT);
      ALTER TABLE users ADD COLUMN created_at TIMESTAMP NULL;
    `;

    const result = compareSqlDiff(baseSql, headSql);
    expect(result.passed).toBe(true);
    expect(result.criticalCount).toBe(0);
    expect(result.accessExclusiveCount).toBe(0);
    expect(result.lockContentionCount).toBe(0);
  });
});
