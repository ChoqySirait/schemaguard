import { describe, it, expect } from 'vitest';
import { RiskLevel } from '../src/types';
import { parseSqlStatements, stripComments } from '../src/analyzer/sqlParser';
import {
  analyzeSqlStatement,
  analyzeSqlText,
  compareSqlDiff,
  buildAnalysisSummary
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
});

describe('SQL Diff Engine - Anti-Pattern Detection', () => {
  it('harus mendeteksi DROP TABLE sebagai pelanggaran CRITICAL', () => {
    const sql = 'DROP TABLE customers;';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('DROP_TABLE');
    expect(issues[0].riskLevel).toBe(RiskLevel.CRITICAL);
    expect(issues[0].table).toBe('customers');
  });

  it('harus mendeteksi DROP COLUMN sebagai pelanggaran CRITICAL', () => {
    const sql = 'ALTER TABLE users DROP COLUMN email;';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('DROP_COLUMN');
    expect(issues[0].riskLevel).toBe(RiskLevel.CRITICAL);
    expect(issues[0].column).toBe('email');
  });

  it('harus mendeteksi ALTER COLUMN TYPE sebagai pelanggaran CRITICAL', () => {
    const sql = 'ALTER TABLE products ALTER COLUMN price TYPE numeric(10,2);';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('ALTER_COLUMN_TYPE');
    expect(issues[0].riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('harus mendeteksi RENAME COLUMN sebagai pelanggaran CRITICAL', () => {
    const sql = 'ALTER TABLE accounts RENAME COLUMN is_active TO status;';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('RENAME_COLUMN');
    expect(issues[0].riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('harus mendeteksi ADD NOT NULL tanpa DEFAULT sebagai pelanggaran CRITICAL', () => {
    const sql = 'ALTER TABLE payments ADD COLUMN transaction_id VARCHAR(64) NOT NULL;';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('ADD_NOT_NULL_WITHOUT_DEFAULT');
    expect(issues[0].riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('harus mendeteksi CREATE INDEX tanpa CONCURRENTLY sebagai WARNING', () => {
    const sql = 'CREATE INDEX idx_user_email ON users (email);';
    const issues = analyzeSqlText(sql);

    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('CREATE_INDEX_NON_CONCURRENTLY');
    expect(issues[0].riskLevel).toBe(RiskLevel.WARNING);
  });

  it('tidak boleh mendeteksi operasi yang aman (SAFE)', () => {
    const sql = `
      CREATE TABLE audit_logs (id SERIAL PRIMARY KEY, action TEXT);
      CREATE INDEX CONCURRENTLY idx_audit_action ON audit_logs (action);
      ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL;
    `;
    const issues = analyzeSqlText(sql);
    expect(issues.length).toBe(0);
  });
});

describe('SQL Schema Comparison (Base vs Head)', () => {
  it('harus membandingkan head terhadap base dan mendeteksi perubahan berbahaya', () => {
    const baseSql = `
      CREATE TABLE users (id INT, name TEXT, email TEXT);
    `;
    const headSql = `
      CREATE TABLE users (id INT, name TEXT, email TEXT);
      ALTER TABLE users DROP COLUMN email;
      CREATE INDEX idx_users_name ON users (name);
    `;

    const result = compareSqlDiff(baseSql, headSql);
    expect(result.passed).toBe(false);
    expect(result.criticalCount).toBe(1);
    expect(result.warningCount).toBe(1);
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
  });
});
