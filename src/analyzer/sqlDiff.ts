/**
 * Mesin Pendeteksi Pelanggaran Skema Basis Data (SQL Diff Engine)
 * Memindai skrip atau berkas migrasi SQL untuk mendeteksi perubahan berbahaya (breaking changes)
 * berdasarkan daftar aturan anti-pola skema.
 */

import { DatabaseIssue, RiskLevel, SqlRule } from '../types';
import { getSqlRules } from '../rules/sqlRules';
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
  passed: boolean;
}

/**
 * Menganalisis satu pernyataan SQL yang telah diurai terhadap kumpulan aturan
 */
export function analyzeSqlStatement(
  parsed: ParsedSqlStatement,
  fileName: string = 'migration.sql',
  rules: SqlRule[] = getSqlRules()
): DatabaseIssue[] {
  const issues: DatabaseIssue[] = [];
  const normalizedStatement = parsed.statement.replace(/\s+/g, ' ');

  for (const rule of rules) {
    if (rule.regex.test(normalizedStatement)) {
      issues.push({
        ruleId: rule.id,
        ruleName: rule.name,
        description: rule.description,
        statement: parsed.statement,
        riskLevel: rule.riskLevel,
        table: parsed.table,
        column: parsed.column,
        line: parsed.startLine,
        file: fileName,
        suggestedFix: rule.recommendationTemplate
      });
    }
  }

  return issues;
}

/**
 * Menganalisis teks SQL mentah dan mengembalikan daftar pelanggaran
 */
export function analyzeSqlText(
  sqlContent: string,
  fileName: string = 'inline.sql'
): DatabaseIssue[] {
  const statements = parseSqlStatements(sqlContent);
  const issues: DatabaseIssue[] = [];

  for (const stmt of statements) {
    const stmtIssues = analyzeSqlStatement(stmt, fileName);
    issues.push(...stmtIssues);
  }

  return issues;
}

/**
 * Menganalisis satu berkas SQL berdasarkan jalur berkasnya
 */
export function analyzeSingleSqlFile(filePath: string): DatabaseIssue[] {
  const parsedFile = parseSqlFile(filePath);
  const issues: DatabaseIssue[] = [];

  for (const stmt of parsedFile.statements) {
    const stmtIssues = analyzeSqlStatement(stmt, parsedFile.fileName);
    issues.push(...stmtIssues);
  }

  return issues;
}

/**
 * Menganalisis seluruh berkas migrasi dalam satu direktori
 */
export function analyzeSqlDir(dirPath: string): DatabaseIssue[] {
  const parsedFiles = parseSqlDirectory(dirPath);
  const issues: DatabaseIssue[] = [];

  for (const file of parsedFiles) {
    for (const stmt of file.statements) {
      const stmtIssues = analyzeSqlStatement(stmt, file.fileName);
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
  fileName: string = 'migration_diff.sql'
): SqlAnalysisResult {
  const baseStatements = parseSqlStatements(baseSql).map((s) => s.statement.trim());
  const headStatements = parseSqlStatements(headSql);

  // Hanya periksa pernyataan baru pada head yang belum ada di base
  const newStatements = headStatements.filter(
    (h) => !baseStatements.includes(h.statement.trim())
  );

  const issues: DatabaseIssue[] = [];
  for (const stmt of newStatements) {
    const stmtIssues = analyzeSqlStatement(stmt, fileName);
    issues.push(...stmtIssues);
  }

  return buildAnalysisSummary(issues, headStatements.length);
}

/**
 * Mengonstruksi ringkasan metrik dari daftar pelanggaran
 */
export function buildAnalysisSummary(
  issues: DatabaseIssue[],
  totalStatements: number = issues.length
): SqlAnalysisResult {
  let criticalCount = 0;
  let warningCount = 0;
  let safeCount = 0;

  for (const issue of issues) {
    if (issue.riskLevel === RiskLevel.CRITICAL) {
      criticalCount++;
    } else if (issue.riskLevel === RiskLevel.WARNING) {
      warningCount++;
    } else {
      safeCount++;
    }
  }

  const passed = criticalCount === 0;

  return {
    issues,
    totalStatements,
    criticalCount,
    warningCount,
    safeCount,
    passed
  };
}
