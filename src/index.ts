#!/usr/bin/env node

/**
 * SchemaGuard CLI Entry Point
 * Titik masuk antarmuka baris perintah untuk SchemaGuard.
 * Mengintegrasikan analisis skema SQL, deteksi breaking changes API,
 * rekomendasi strategi mitigasi zero-downtime, serta pelaporan visual.
 */

import * as fs from 'fs';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  ApiIssue,
  CliOptions,
  DatabaseIssue,
  ReportSummary,
  RiskLevel,
  SchemaGuardReport
} from './types';
import {
  analyzeSingleSqlFile,
  analyzeSqlDir,
  compareSqlDiff
} from './analyzer/sqlDiff';
import { compareOpenApiFiles } from './analyzer/apiDiff';
import { generateAllRecommendations } from './recommender/engine';
import { printTerminalReport } from './reporter/terminal';
import { renderMarkdownReport, saveMarkdownReport } from './reporter/markdown';

export const program = new Command();

program
  .name('schemaguard')
  .description('Perkakas pendeteksi perubahan merusak pada migrasi basis data dan spesifikasi API')
  .version('0.1.0');

/**
 * Menghitung ringkasan metrik dari daftar pelanggaran
 */
function calculateSummary(
  dbIssues: DatabaseIssue[],
  apiIssues: ApiIssue[],
  failOn: RiskLevel = RiskLevel.CRITICAL
): ReportSummary {
  let critical = 0;
  let warning = 0;
  let safe = 0;

  for (const i of dbIssues) {
    if (i.riskLevel === RiskLevel.CRITICAL) critical++;
    else if (i.riskLevel === RiskLevel.WARNING) warning++;
    else safe++;
  }

  for (const i of apiIssues) {
    if (i.riskLevel === RiskLevel.CRITICAL) critical++;
    else if (i.riskLevel === RiskLevel.WARNING) warning++;
    else safe++;
  }

  const totalIssues = dbIssues.length + apiIssues.length;
  let passed = true;

  if (failOn === RiskLevel.CRITICAL && critical > 0) {
    passed = false;
  } else if (failOn === RiskLevel.WARNING && (critical > 0 || warning > 0)) {
    passed = false;
  }

  return {
    totalIssues,
    critical,
    warning,
    safe,
    passed
  };
}

/**
 * Memproses dan mendistribusikan keluaran laporan
 */
function handleReportOutput(report: SchemaGuardReport, options: { format?: string; output?: string }): void {
  const format = options.format || 'console';

  if (format === 'json') {
    const jsonStr = JSON.stringify(report, null, 2);
    if (options.output) {
      fs.writeFileSync(options.output, jsonStr, 'utf-8');
      console.log(chalk.green(`Laporan JSON berhasil disimpan ke: ${options.output}`));
    } else {
      console.log(jsonStr);
    }
  } else if (format === 'markdown') {
    const mdStr = renderMarkdownReport(report);
    if (options.output) {
      saveMarkdownReport(report, options.output);
      console.log(chalk.green(`Laporan Markdown berhasil disimpan ke: ${options.output}`));
    } else {
      console.log(mdStr);
    }
  } else {
    // console default
    printTerminalReport(report);
    if (options.output) {
      saveMarkdownReport(report, options.output);
      console.log(chalk.green(`Salinan Markdown disimpan ke: ${options.output}`));
    }
  }
}

/**
 * Perintah: check-db
 * Memindai migrasi basis data untuk mendeteksi anti-pola skema berbahaya.
 */
program
  .command('check-db')
  .description('Pindai berkas migrasi basis data SQL untuk mendeteksi perubahan berisiko')
  .option('-f, --file <path>', 'Jalur ke berkas SQL migrasi')
  .option('-d, --dir <path>', 'Direktori berkas migrasi SQL')
  .option('--base <path>', 'Jalur ke skema dasar atau referensi cabang utama')
  .option('--format <type>', 'Format pelaporan (console, json, markdown)', 'console')
  .option('-o, --output <path>', 'Jalur penyimpanan berkas laporan keluaran')
  .option('--fail-on <level>', 'Gagalkan proses jika risiko mencapai batas ini (CRITICAL, WARNING)', 'CRITICAL')
  .action((options) => {
    if (!options.file && !options.dir) {
      console.error(chalk.red('Galat: Harap tentukan --file atau --dir untuk dipindai.'));
      process.exitCode = 1;
      return;
    }

    let issues: DatabaseIssue[] = [];

    if (options.base && options.file) {
      const baseSql = fs.readFileSync(options.base, 'utf-8');
      const headSql = fs.readFileSync(options.file, 'utf-8');
      const diffResult = compareSqlDiff(baseSql, headSql, options.file);
      issues = diffResult.issues;
    } else if (options.file) {
      issues = analyzeSingleSqlFile(options.file);
    } else if (options.dir) {
      issues = analyzeSqlDir(options.dir);
    }

    const failOn = (options.failOn as RiskLevel) || RiskLevel.CRITICAL;
    const summary = calculateSummary(issues, [], failOn);
    const recommendations = generateAllRecommendations({ databaseIssues: issues });

    const report: SchemaGuardReport = {
      timestamp: new Date().toISOString(),
      summary,
      databaseIssues: issues,
      apiIssues: [],
      recommendations
    };

    handleReportOutput(report, options);

    if (!summary.passed) {
      process.exitCode = 1;
    }
  });

/**
 * Perintah: check-api
 * Membandingkan spesifikasi OpenAPI untuk mendeteksi perubahan kontrak merusak.
 */
program
  .command('check-api')
  .description('Bandingkan spesifikasi OpenAPI antara versi lama dan baru')
  .requiredOption('--base <path>', 'Jalur ke berkas OpenAPI dasar (JSON/YAML lama)')
  .requiredOption('--head <path>', 'Jalur ke berkas OpenAPI target (JSON/YAML baru)')
  .option('--format <type>', 'Format pelaporan (console, json, markdown)', 'console')
  .option('-o, --output <path>', 'Jalur penyimpanan berkas laporan keluaran')
  .option('--fail-on <level>', 'Gagalkan proses jika risiko mencapai batas ini (CRITICAL, WARNING)', 'CRITICAL')
  .action((options) => {
    const diffResult = compareOpenApiFiles(options.base, options.head);
    const failOn = (options.failOn as RiskLevel) || RiskLevel.CRITICAL;
    const summary = calculateSummary([], diffResult.issues, failOn);
    const recommendations = generateAllRecommendations({ apiIssues: diffResult.issues });

    const report: SchemaGuardReport = {
      timestamp: new Date().toISOString(),
      summary,
      databaseIssues: [],
      apiIssues: diffResult.issues,
      recommendations
    };

    handleReportOutput(report, options);

    if (!summary.passed) {
      process.exitCode = 1;
    }
  });

/**
 * Perintah: scan
 * Menjalankan evaluasi komprehensif (basis data dan kontrak API) serta menghasilkan rekomendasi mitigasi.
 */
program
  .command('scan')
  .description('Jalankan pemindaian penuh untuk basis data dan spesifikasi API')
  .option('--sql-file <path>', 'Berkas SQL migrasi')
  .option('--sql-dir <path>', 'Direktori berkas migrasi SQL')
  .option('--db-base <path>', 'Jalur ke skema SQL cabang utama (base)')
  .option('--db-head <path>', 'Jalur ke skema SQL cabang fitur (head)')
  .option('--api-base <path>', 'Berkas OpenAPI dasar')
  .option('--api-head <path>', 'Berkas OpenAPI target')
  .option('--format <type>', 'Format pelaporan (console, json, markdown)', 'console')
  .option('-o, --output <path>', 'Jalur penyimpanan berkas laporan keluaran')
  .option('--fail-on <level>', 'Gagalkan proses jika risiko mencapai batas ini (CRITICAL, WARNING)', 'CRITICAL')
  .action((options: CliOptions) => {
    const dbIssues: DatabaseIssue[] = [];
    const apiIssues: ApiIssue[] = [];

    // Evaluasi Basis Data
    if (options.dbBase && options.dbHead) {
      const baseSql = fs.readFileSync(options.dbBase, 'utf-8');
      const headSql = fs.readFileSync(options.dbHead, 'utf-8');
      const res = compareSqlDiff(baseSql, headSql, options.dbHead);
      dbIssues.push(...res.issues);
    } else if (options.sqlFile) {
      dbIssues.push(...analyzeSingleSqlFile(options.sqlFile));
    } else if (options.sqlDir) {
      dbIssues.push(...analyzeSqlDir(options.sqlDir));
    }

    // Evaluasi Kontrak API
    if (options.apiBase && options.apiHead) {
      const res = compareOpenApiFiles(options.apiBase, options.apiHead);
      apiIssues.push(...res.issues);
    }

    const failOn = (options.failOn as RiskLevel) || RiskLevel.CRITICAL;
    const summary = calculateSummary(dbIssues, apiIssues, failOn);
    const recommendations = generateAllRecommendations({
      databaseIssues: dbIssues,
      apiIssues
    });

    const report: SchemaGuardReport = {
      timestamp: new Date().toISOString(),
      summary,
      databaseIssues: dbIssues,
      apiIssues,
      recommendations
    };

    handleReportOutput(report, options);

    if (!summary.passed) {
      process.exitCode = 1;
    }
  });

/**
 * Jalankan parser perintah baris argumen
 */
export function runCli(args: string[] = process.argv): void {
  program.parse(args);
}

// Eksekusi langsung jika dipanggil sebagai script mandiri
if (require.main === module) {
  runCli();
}
