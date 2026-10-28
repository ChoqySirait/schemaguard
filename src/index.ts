#!/usr/bin/env node

/**
 * SchemaGuard CLI Entry Point
 * Titik masuk antarmuka baris perintah untuk SchemaGuard.
 * Mengintegrasikan analisis skema SQL (lock contention), deteksi breaking changes API,
 * pemetaan dampak silang (cross-impact), rekomendasi pola Expand and Contract,
 * serta generator laporan terminal, Markdown, dan dasbor HTML statis mandiri.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  ApiIssue,
  BaseCliOptions,
  CheckApiOptions,
  CheckDbOptions,
  CliOptions,
  CrossImpactLink,
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
import { parseOpenApiFile } from './analyzer/apiParser';
import { compareOpenApiFiles } from './analyzer/apiDiff';
import { mapCrossImpact } from './analyzer/crossImpact';
import { generateAllRecommendations } from './recommender/expandContract';
import { printTerminalReport } from './reporter/terminal';
import { renderMarkdownReport, saveMarkdownReport } from './reporter/markdown';
import { generateHtmlReport, saveHtmlReport } from './reporter/htmlReport';

export const program: Command = new Command();

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
  let critical: number = 0;
  let warning: number = 0;
  let safe: number = 0;

  for (const issue of dbIssues) {
    if (issue.riskLevel === RiskLevel.CRITICAL) critical++;
    else if (issue.riskLevel === RiskLevel.WARNING) warning++;
    else safe++;
  }

  for (const issue of apiIssues) {
    if (issue.riskLevel === RiskLevel.CRITICAL) critical++;
    else if (issue.riskLevel === RiskLevel.WARNING) warning++;
    else safe++;
  }

  const totalIssues: number = dbIssues.length + apiIssues.length;
  let passed: boolean = true;

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
 * Memproses dan mendistribusikan keluaran laporan ke berbagai format
 */
function handleReportOutput(
  report: SchemaGuardReport,
  options: BaseCliOptions & { htmlReport?: string }
): void {
  const format: string = options.format || 'console';

  // 1. Simpan laporan HTML jika diminta melalui opsi format=html atau --html-report
  if (options.htmlReport) {
    saveHtmlReport(report, options.htmlReport);
    console.log(chalk.green(`Laporan visual HTML berhasil disimpan ke: ${options.htmlReport}`));
  }

  if (format === 'json') {
    const jsonStr: string = JSON.stringify(report, null, 2);
    if (options.output) {
      fs.writeFileSync(options.output, jsonStr, 'utf-8');
      console.log(chalk.green(`Laporan JSON berhasil disimpan ke: ${options.output}`));
    } else {
      console.log(jsonStr);
    }
  } else if (format === 'markdown') {
    const mdStr: string = renderMarkdownReport(report);
    if (options.output) {
      saveMarkdownReport(report, options.output);
      console.log(chalk.green(`Laporan Markdown berhasil disimpan ke: ${options.output}`));
    } else {
      console.log(mdStr);
    }
  } else if (format === 'html') {
    const htmlStr: string = generateHtmlReport(report);
    if (options.output) {
      saveHtmlReport(report, options.output);
      console.log(chalk.green(`Laporan HTML berhasil disimpan ke: ${options.output}`));
    } else {
      console.log(htmlStr);
    }
  } else {
    // console default
    printTerminalReport(report, options.htmlReport);
    if (options.output) {
      saveMarkdownReport(report, options.output);
      console.log(chalk.green(`Salinan Markdown disimpan ke: ${options.output}`));
    }
  }
}

/**
 * Perintah: check-db
 * Memindai migrasi basis data untuk mendeteksi anti-pola skema dan lock contention.
 */
program
  .command('check-db')
  .description('Pindai berkas migrasi basis data SQL untuk mendeteksi perubahan berisiko dan penguncian tabel')
  .option('-f, --file <path>', 'Jalur ke berkas SQL migrasi')
  .option('-d, --dir <path>', 'Direktori berkas migrasi SQL')
  .option('-m, --migrations <path>', 'Jalur berkas atau direktori migrasi SQL')
  .option('--base <path>', 'Jalur ke skema dasar atau referensi cabang utama')
  .option('--format <type>', 'Format pelaporan (console, json, html, markdown)', 'console')
  .option('-o, --output <path>', 'Jalur penyimpanan berkas laporan keluaran')
  .option('--html-report <path>', 'Jalur penyimpanan berkas laporan web visual HTML')
  .option('--fail-on <level>', 'Gagalkan proses jika risiko mencapai batas ini (CRITICAL, WARNING)', 'CRITICAL')
  .action((options: CheckDbOptions & { htmlReport?: string }): void => {
    try {
      const targetPath = options.migrations || options.file || options.dir;

      if (!targetPath && !options.base) {
        console.error(chalk.red('Galat: Harap tentukan berkas atau direktori migrasi via --migrations, --file, atau --dir.'));
        process.exitCode = 1;
        return;
      }

      let issues: DatabaseIssue[] = [];

      if (options.base && options.file) {
        if (!fs.existsSync(options.base)) {
          console.error(chalk.red(`Galat: Berkas skema dasar tidak ditemukan: ${options.base}`));
          process.exitCode = 1;
          return;
        }
        if (!fs.existsSync(options.file)) {
          console.error(chalk.red(`Galat: Berkas SQL migrasi tidak ditemukan: ${options.file}`));
          process.exitCode = 1;
          return;
        }
        const baseSql: string = fs.readFileSync(options.base, 'utf-8');
        const headSql: string = fs.readFileSync(options.file, 'utf-8');
        const diffResult = compareSqlDiff(baseSql, headSql, options.file);
        issues = diffResult.issues;
      } else if (targetPath) {
        if (!fs.existsSync(targetPath)) {
          console.error(chalk.red(`Galat: Berkas/direktori migrasi tidak ditemukan: ${targetPath}`));
          process.exitCode = 1;
          return;
        }

        const stat = fs.statSync(targetPath);
        if (stat.isDirectory()) {
          issues = analyzeSqlDir(targetPath);
        } else {
          issues = analyzeSingleSqlFile(targetPath);
        }
      }

      const failOn: RiskLevel = (options.failOn as RiskLevel) || RiskLevel.CRITICAL;
      const summary: ReportSummary = calculateSummary(issues, [], failOn);
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
    } catch (err: unknown) {
      const message: string = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Galat saat menjalankan check-db: ${message}`));
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
  .option('--format <type>', 'Format pelaporan (console, json, html, markdown)', 'console')
  .option('-o, --output <path>', 'Jalur penyimpanan berkas laporan keluaran')
  .option('--html-report <path>', 'Jalur penyimpanan berkas laporan web visual HTML')
  .option('--fail-on <level>', 'Gagalkan proses jika risiko mencapai batas ini (CRITICAL, WARNING)', 'CRITICAL')
  .action((options: CheckApiOptions & { htmlReport?: string }): void => {
    try {
      if (!fs.existsSync(options.base)) {
        console.error(chalk.red(`Galat: Berkas OpenAPI dasar tidak ditemukan: ${options.base}`));
        process.exitCode = 1;
        return;
      }
      if (!fs.existsSync(options.head)) {
        console.error(chalk.red(`Galat: Berkas OpenAPI target tidak ditemukan: ${options.head}`));
        process.exitCode = 1;
        return;
      }

      const diffResult = compareOpenApiFiles(options.base, options.head);
      const failOn: RiskLevel = (options.failOn as RiskLevel) || RiskLevel.CRITICAL;
      const summary: ReportSummary = calculateSummary([], diffResult.issues, failOn);
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
    } catch (err: unknown) {
      const message: string = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Galat saat menjalankan check-api: ${message}`));
      process.exitCode = 1;
    }
  });

/**
 * Perintah: check (atau scan)
 * Alur kerja utama pengembang: memeriksa migrasi DDL, spesifikasi kontrak API,
 * dan memetakan dampak silang keduanya (Cross-Impact Mapping).
 */
function handleCheckOrScanAction(options: CliOptions): void {
  try {
    const dbIssues: DatabaseIssue[] = [];
    const apiIssues: ApiIssue[] = [];
    let crossImpacts: CrossImpactLink[] = [];

    const migrationsPath = options.migrations || options.sqlFile || options.sqlDir || options.file || options.dir;
    const apiPath = options.api;

    // 1. Audit Migrasi SQL
    if (options.dbBase && options.dbHead) {
      if (!fs.existsSync(options.dbBase)) {
        console.error(chalk.red(`Galat: Berkas skema dasar tidak ditemukan: ${options.dbBase}`));
        process.exitCode = 1;
        return;
      }
      if (!fs.existsSync(options.dbHead)) {
        console.error(chalk.red(`Galat: Berkas skema target tidak ditemukan: ${options.dbHead}`));
        process.exitCode = 1;
        return;
      }
      const baseSql: string = fs.readFileSync(options.dbBase, 'utf-8');
      const headSql: string = fs.readFileSync(options.dbHead, 'utf-8');
      const res = compareSqlDiff(baseSql, headSql, options.dbHead);
      dbIssues.push(...res.issues);
    } else if (migrationsPath) {
      if (!fs.existsSync(migrationsPath)) {
        console.error(chalk.red(`Galat: Berkas atau direktori migrasi SQL tidak ditemukan: ${migrationsPath}`));
        process.exitCode = 1;
        return;
      }
      const stat = fs.statSync(migrationsPath);
      if (stat.isDirectory()) {
        dbIssues.push(...analyzeSqlDir(migrationsPath));
      } else {
        dbIssues.push(...analyzeSingleSqlFile(migrationsPath));
      }
    }

    // 2. Evaluasi Kontrak API & Pemetaan Dampak Silang
    if (options.apiBase && options.apiHead) {
      if (!fs.existsSync(options.apiBase)) {
        console.error(chalk.red(`Galat: Berkas OpenAPI dasar tidak ditemukan: ${options.apiBase}`));
        process.exitCode = 1;
        return;
      }
      if (!fs.existsSync(options.apiHead)) {
        console.error(chalk.red(`Galat: Berkas OpenAPI target tidak ditemukan: ${options.apiHead}`));
        process.exitCode = 1;
        return;
      }
      const res = compareOpenApiFiles(options.apiBase, options.apiHead);
      apiIssues.push(...res.issues);

      // Petakan dampak silang jika ada berkas OpenAPI target dan ada isu kolom SQL
      if (dbIssues.length > 0) {
        const headSpec = parseOpenApiFile(options.apiHead);
        crossImpacts = mapCrossImpact(dbIssues, headSpec);
      }
    } else if (apiPath) {
      if (!fs.existsSync(apiPath)) {
        console.error(chalk.red(`Galat: Berkas OpenAPI tidak ditemukan: ${apiPath}`));
        process.exitCode = 1;
        return;
      }
      const apiSpec = parseOpenApiFile(apiPath);
      if (dbIssues.length > 0) {
        crossImpacts = mapCrossImpact(dbIssues, apiSpec);
      }
    }

    if (dbIssues.length === 0 && apiIssues.length === 0 && !migrationsPath && !apiPath && !options.apiBase) {
      console.warn(chalk.yellow('Peringatan: Tidak ada berkas migrasi basis data (--migrations) atau spesifikasi API (--api) yang ditentukan untuk dipindai.'));
    }

    const failOn: RiskLevel = (options.failOn as RiskLevel) || RiskLevel.CRITICAL;
    const summary: ReportSummary = calculateSummary(dbIssues, apiIssues, failOn);
    const recommendations = generateAllRecommendations({
      databaseIssues: dbIssues,
      apiIssues
    });

    const report: SchemaGuardReport = {
      timestamp: new Date().toISOString(),
      summary,
      databaseIssues: dbIssues,
      apiIssues,
      crossImpacts,
      recommendations
    };

    handleReportOutput(report, options);

    if (!summary.passed) {
      process.exitCode = 1;
    }
  } catch (err: unknown) {
    const message: string = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Galat saat menjalankan pemindaian: ${message}`));
    process.exitCode = 1;
  }
}

program
  .command('check')
  .description('Audit migrasi DDL SQL dan kontrak OpenAPI terhadap breaking changes dan lock contention')
  .option('-m, --migrations <path>', 'Direktori atau berkas migrasi SQL')
  .option('-a, --api <path>', 'Berkas spesifikasi kontrak OpenAPI (YAML/JSON)')
  .option('--api-base <path>', 'Berkas OpenAPI cabang dasar (lama)')
  .option('--api-head <path>', 'Berkas OpenAPI cabang kerja (baru)')
  .option('--db-base <path>', 'Jalur ke skema SQL cabang utama (base)')
  .option('--db-head <path>', 'Jalur ke skema SQL cabang fitur (head)')
  .option('--html-report <path>', 'Jalur berkas laporan visual HTML mandiri (e.g. schemaguard-report.html)')
  .option('--format <type>', 'Format pelaporan (console, json, html, markdown)', 'console')
  .option('-o, --output <path>', 'Jalur penyimpanan berkas laporan keluaran')
  .option('--fail-on <level>', 'Gagalkan proses jika risiko mencapai batas ini (CRITICAL, WARNING)', 'CRITICAL')
  .action((options: CliOptions): void => {
    handleCheckOrScanAction(options);
  });

program
  .command('scan')
  .description('Alias untuk perintah check')
  .option('-m, --migrations <path>', 'Direktori atau berkas migrasi SQL')
  .option('--sql-file <path>', 'Berkas SQL migrasi')
  .option('--sql-dir <path>', 'Direktori berkas migrasi SQL')
  .option('--db-base <path>', 'Jalur ke skema SQL cabang utama (base)')
  .option('--db-head <path>', 'Jalur ke skema SQL cabang fitur (head)')
  .option('-a, --api <path>', 'Berkas spesifikasi OpenAPI')
  .option('--api-base <path>', 'Berkas OpenAPI dasar')
  .option('--api-head <path>', 'Berkas OpenAPI target')
  .option('--html-report <path>', 'Jalur berkas laporan visual HTML mandiri')
  .option('--format <type>', 'Format pelaporan (console, json, html, markdown)', 'console')
  .option('-o, --output <path>', 'Jalur penyimpanan berkas laporan keluaran')
  .option('--fail-on <level>', 'Gagalkan proses jika risiko mencapai batas ini (CRITICAL, WARNING)', 'CRITICAL')
  .action((options: CliOptions): void => {
    handleCheckOrScanAction(options);
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
