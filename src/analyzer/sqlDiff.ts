/**
 * Mesin Pendeteksi Pelanggaran Skema Basis Data (SQL Diff & Lock Engine)
 * Memindai skrip atau berkas migrasi SQL untuk mendeteksi operasi berbahaya
 * yang memicu AccessExclusiveLock, Metadata Lock, atau penguncian tabel penuh di produksi.
 *
 * Referensi Praktik Rekayasa:
 * - PostgreSQL Explicit Locking: https://www.postgresql.org/docs/current/explicit-locking.html
 * - Stripe Online Migrations at Scale: https://stripe.com/blog/online-migrations
 */

import {
  DatabaseDialect,
  DatabaseIssue,
  LockMode,
  RiskLevel,
  SqlRule
} from '../types';
import { getRulesByDialect, getSqlRules } from '../rules/sqlRules';
import {
  ParsedSqlStatement,
  parseSqlDirectory,
  parseSqlFile,
  parseSqlStatements
} from './sqlParser';

export interface SqlAnalysisResult {
  issues: DatabaseIssue[];
  totalStatements: number;
  criticalCount: number;
  warningCount: number;
  safeCount: number;
  accessExclusiveCount: number;
  lockContentionCount: number;
  passed: boolean;
}

/**
 * Menganalisis satu pernyataan SQL yang telah diurai terhadap kumpulan aturan mitigasi penguncian tabel
 */
export function analyzeSqlStatement(
  parsed: ParsedSqlStatement,
  fileName: string = 'migration.sql',
  rules?: SqlRule[],
  dialect?: DatabaseDialect
): DatabaseIssue[] {
  const issues: DatabaseIssue[] = [];
  const normalizedStatement = parsed.statement.replace(/\s+/g, ' ');

  // Gunakan aturan berdasar dialek jika ditentukan, atau gunakan aturan default
  const activeRules = rules ?? (dialect ? getRulesByDialect(dialect) : getSqlRules());

  for (const rule of activeRules) {
    const match = normalizedStatement.match(rule.regex);
    if (match) {
      // Ambil tabel dan kolom dari hasil parser atau dari regex capture groups
      let extractedTable = parsed.table;
      let extractedColumn = parsed.column;

      if (!extractedTable && match[1]) {
        extractedTable = match[1].replace(/[`"'\[\]]/g, '');
      }

      if (!extractedColumn && match[2]) {
        extractedColumn = match[2].replace(/[`"'\[\]]/g, '');
      }

      issues.push({
        ruleId: rule.id,
        ruleName: rule.name,
        description: rule.description,
        statement: parsed.statement,
        riskLevel: rule.riskLevel,
        lockMode: rule.lockMode,
        dialect: rule.dialect || parsed.dialect || dialect || 'generic',
        table: extractedTable,
        column: extractedColumn,
        line: parsed.startLine,
        file: fileName,
        suggestedFix: rule.recommendationTemplate
      });
    }
  }

  return issues;
}

/**
 * Menyaring daftar temuan yang memicu AccessExclusiveLock (PostgreSQL) atau Metadata Lock eksklusif (MySQL)
 */
export function detectAccessExclusiveLocks(issues: DatabaseIssue[]): DatabaseIssue[] {
  return issues.filter((issue) => issue.lockMode === 'ACCESS_EXCLUSIVE' || issue.lockMode === 'EXCLUSIVE');
}

/**
 * Menyaring daftar temuan yang memicu potensi perebutan kunci (lock contention) tingkat menengah hingga tinggi
 */
export function detectLockContention(issues: DatabaseIssue[]): DatabaseIssue[] {
  const highLockModes: (LockMode | string)[] = [
    'ACCESS_EXCLUSIVE',
    'SHARE_ROW_EXCLUSIVE',
    'EXCLUSIVE',
    'SHARE',
    'METADATA_LOCK'
  ];

  return issues.filter((issue) => issue.lockMode && highLockModes.includes(issue.lockMode));
}

/**
 * Menyaring daftar temuan berdasarkan dialek basis data target
 */
export function filterIssuesByDialect(
  issues: DatabaseIssue[],
  dialect: DatabaseDialect
): DatabaseIssue[] {
  return issues.filter(
    (issue) => !issue.dialect || issue.dialect === 'generic' || issue.dialect === dialect
  );
}

/**
 * Menganalisis teks SQL mentah dan mengembalikan daftar pelanggaran penguncian tabel
 */
export function analyzeSqlText(
  sqlContent: string,
  fileName: string = 'inline.sql',
  dialect?: DatabaseDialect
): DatabaseIssue[] {
  const statements = parseSqlStatements(sqlContent);
  const issues: DatabaseIssue[] = [];

  for (const stmt of statements) {
    const stmtIssues = analyzeSqlStatement(stmt, fileName, undefined, dialect);
    issues.push(...stmtIssues);
  }

  return issues;
}

/**
 * Menganalisis satu berkas SQL berdasarkan jalur berkasnya
 */
export function analyzeSingleSqlFile(
  filePath: string,
  dialect?: DatabaseDialect
): DatabaseIssue[] {
  const parsedFile = parseSqlFile(filePath);
  const issues: DatabaseIssue[] = [];

  for (const stmt of parsedFile.statements) {
    const stmtIssues = analyzeSqlStatement(stmt, parsedFile.fileName, undefined, dialect);
    issues.push(...stmtIssues);
  }

  return issues;
}

/**
 * Menganalisis seluruh berkas migrasi dalam satu direktori
 */
export function analyzeSqlDir(
  dirPath: string,
  dialect?: DatabaseDialect
): DatabaseIssue[] {
  const parsedFiles = parseSqlDirectory(dirPath);
  const issues: DatabaseIssue[] = [];

  for (const file of parsedFiles) {
    for (const stmt of file.statements) {
      const stmtIssues = analyzeSqlStatement(stmt, file.fileName, undefined, dialect);
      issues.push(...stmtIssues);
    }
  }

  return issues;
}

/**
 * Membandingkan skema cabang kerja (head) terhadap cabang utama (base)
 * Mendeteksi operasi berbahaya yang ditambahkan pada skrip migrasi head.
 */
export function compareSqlDiff(
  baseSql: string,
  headSql: string,
  fileName: string = 'migration_diff.sql',
  dialect?: DatabaseDialect
): SqlAnalysisResult {
  const baseStatements = parseSqlStatements(baseSql).map((s) => s.statement.trim());
  const headStatements = parseSqlStatements(headSql);

  // Hanya periksa pernyataan baru pada head yang belum ada di base
  const newStatements = headStatements.filter(
    (h) => !baseStatements.includes(h.statement.trim())
  );

  const issues: DatabaseIssue[] = [];
  for (const stmt of newStatements) {
    const stmtIssues = analyzeSqlStatement(stmt, fileName, undefined, dialect);
    issues.push(...stmtIssues);
  }

  return buildAnalysisSummary(issues, headStatements.length);
}

/**
 * Mengonstruksi ringkasan metrik dari daftar pelanggaran penguncian dan risiko skema
 */
export function buildAnalysisSummary(
  issues: DatabaseIssue[],
  totalStatements: number = issues.length
): SqlAnalysisResult {
  let criticalCount = 0;
  let warningCount = 0;
  let safeCount = 0;
  let accessExclusiveCount = 0;
  let lockContentionCount = 0;

  for (const issue of issues) {
    if (issue.riskLevel === RiskLevel.CRITICAL) {
      criticalCount++;
    } else if (issue.riskLevel === RiskLevel.WARNING) {
      warningCount++;
    } else {
      safeCount++;
    }

    if (issue.lockMode === 'ACCESS_EXCLUSIVE' || issue.lockMode === 'EXCLUSIVE') {
      accessExclusiveCount++;
    }

    if (
      issue.lockMode &&
      ['ACCESS_EXCLUSIVE', 'SHARE_ROW_EXCLUSIVE', 'EXCLUSIVE', 'SHARE', 'METADATA_LOCK'].includes(
        issue.lockMode
      )
    ) {
      lockContentionCount++;
    }
  }

  const passed = criticalCount === 0;

  return {
    issues,
    totalStatements,
    criticalCount,
    warningCount,
    safeCount,
    accessExclusiveCount,
    lockContentionCount,
    passed
  };
}
