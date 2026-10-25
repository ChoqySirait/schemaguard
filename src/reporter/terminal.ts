/**
 * Pemformat Laporan Tabel Terminal (Terminal Reporter)
 * Bertanggung jawab menyajikan hasil analisis skema basis data, kontrak API,
 * dan rekomendasi mitigasi bertahap dalam bentuk tabel dan ringkasan visual
 * yang informatif di konsol terminal pengembang.
 */

import chalk from 'chalk';
import {
  ApiIssue,
  DatabaseIssue,
  MigrationRecommendation,
  ReportSummary,
  RiskLevel,
  SchemaGuardReport
} from '../types';

/**
 * Menghasilkan lencana warna (badge) untuk tingkat risiko
 */
export function formatRiskBadge(level: RiskLevel): string {
  switch (level) {
    case RiskLevel.CRITICAL:
      return chalk.bgRed.white.bold(' CRITICAL ');
    case RiskLevel.WARNING:
      return chalk.bgYellow.black.bold(' WARNING  ');
    case RiskLevel.SAFE:
      return chalk.bgGreen.black.bold('   SAFE   ');
    default:
      return chalk.bgGray.white(` ${level} `);
  }
}

/**
 * Membuat garis pemisah horizontal
 */
function horizontalRule(length: number = 80, char: string = '─'): string {
  return chalk.gray(char.repeat(length));
}

/**
 * Format ringkasan evaluasi risiko dalam bentuk kartu metrik
 */
export function formatSummaryCards(summary: ReportSummary): string {
  const lines: string[] = [];
  lines.push(chalk.bold.white('📊 RINGKASAN EVALUASI RISIKO:'));
  lines.push(horizontalRule(80));

  const totalStr = chalk.bold(`${summary.totalIssues} isu terdeteksi`);
  const critStr = chalk.red.bold(`✖ ${summary.critical} Kritis (Breaking)`);
  const warnStr = chalk.yellow.bold(`⚠ ${summary.warning} Peringatan`);
  const safeStr = chalk.green.bold(`✔ ${summary.safe} Aman`);

  lines.push(`  ${totalStr} │ ${critStr} │ ${warnStr} │ ${safeStr}`);
  lines.push(horizontalRule(80));

  if (summary.passed) {
    lines.push(chalk.bgGreen.black.bold(' STATUS: LOLOS (PASSED) ') + chalk.green(' Tidak ditemukan perubahan merusak berkategori kritis.'));
  } else {
    lines.push(chalk.bgRed.white.bold(' STATUS: GAGAL (BLOCKED) ') + chalk.red(' Ditemukan pelanggaran skema berkategori kritis yang memicu breaking changes!'));
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Format tabel temuan perubahan skema basis data
 */
export function formatDatabaseIssues(issues: DatabaseIssue[]): string {
  if (issues.length === 0) {
    return chalk.green('✔ Tidak ditemukan anti-pola skema basis data.\n');
  }

  const lines: string[] = [];
  lines.push(chalk.bold.cyan('🗄️  PELANGGARAN SKEMA BASIS DATA (SQL):'));
  lines.push(horizontalRule(80));

  issues.forEach((issue, index) => {
    const num = chalk.gray(`[${index + 1}]`);
    const badge = formatRiskBadge(issue.riskLevel);
    const rule = chalk.bold.white(issue.ruleName || issue.ruleId);
    const target = issue.table ? chalk.yellow(`[Tabel: ${issue.table}${issue.column ? `, Kolom: ${issue.column}` : ''}]`) : '';
    const loc = issue.file ? chalk.gray(`(${issue.file}${issue.line ? `:${issue.line}` : ''})`) : '';

    lines.push(`${num} ${badge} ${rule} ${target} ${loc}`);
    lines.push(`    ${chalk.white(issue.description)}`);

    if (issue.statement) {
      const cleanStmt = issue.statement.trim().replace(/\s+/g, ' ');
      const preview = cleanStmt.length > 90 ? cleanStmt.slice(0, 87) + '...' : cleanStmt;
      lines.push(`    ${chalk.gray('Kueri:')} ${chalk.italic.cyan(preview)}`);
    }

    if (issue.suggestedFix) {
      lines.push(`    ${chalk.gray('Saran:')} ${chalk.italic.green(issue.suggestedFix)}`);
    }

    lines.push(horizontalRule(80, '┄'));
  });

  lines.push('');
  return lines.join('\n');
}

/**
 * Format tabel temuan pelanggaran spesifikasi kontrak API
 */
export function formatApiIssues(issues: ApiIssue[]): string {
  if (issues.length === 0) {
    return chalk.green('✔ Kontrak spesifikasi API sepenuhnya kompatibel ke belakang (backward-compatible).\n');
  }

  const lines: string[] = [];
  lines.push(chalk.bold.magenta('🌐 PELANGGARAN KONTRAK API (OPENAPI):'));
  lines.push(horizontalRule(80));

  issues.forEach((issue, index) => {
    const num = chalk.gray(`[${index + 1}]`);
    const badge = formatRiskBadge(issue.riskLevel);
    const endpoint = chalk.bold.white(`${issue.method || 'ALL'} ${issue.path}`);
    const rule = chalk.gray(`(${issue.ruleId})`);

    lines.push(`${num} ${badge} ${endpoint} ${rule}`);
    lines.push(`    ${chalk.white(issue.description)}`);

    if (issue.details) {
      lines.push(`    ${chalk.gray('Dampak:')} ${chalk.italic.yellow(issue.details)}`);
    }

    lines.push(horizontalRule(80, '┄'));
  });

  lines.push('');
  return lines.join('\n');
}

/**
 * Format rekomendasi mitigasi migrasi tanpa downtime
 */
export function formatRecommendations(recs: MigrationRecommendation[]): string {
  if (recs.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push(chalk.bold.yellow('🛡️  REKOMENDASI STRATEGI MITIGASI (EXPAND & CONTRACT):'));
  lines.push(horizontalRule(80));

  recs.forEach((rec, index) => {
    lines.push(chalk.bold.yellow(`\n[Rekomendasi ${index + 1}] ${rec.title}`));
    lines.push(chalk.gray(`Target: ${rec.target}`));
    lines.push(chalk.white(`${rec.description}\n`));

    // Fase Perluas (Expand)
    lines.push(`  ${chalk.cyan.bold('▸ ' + rec.expandPhase.title)}`);
    lines.push(`    ${chalk.gray(rec.expandPhase.description)}`);
    lines.push(chalk.gray('    Skrip Transisi:'));
    rec.expandPhase.script.split('\n').forEach((sLine) => {
      lines.push(`      ${chalk.green(sLine)}`);
    });
    lines.push('');

    // Fase Susutkan (Contract)
    lines.push(`  ${chalk.magenta.bold('▸ ' + rec.contractPhase.title)}`);
    lines.push(`    ${chalk.gray(rec.contractPhase.description)}`);
    lines.push(chalk.gray('    Skrip Definitif:'));
    rec.contractPhase.script.split('\n').forEach((sLine) => {
      lines.push(`      ${chalk.red(sLine)}`);
    });
    lines.push('');

    // Catatan transisi
    if (rec.transitionNotes && rec.transitionNotes.length > 0) {
      lines.push(`  ${chalk.bold.white('▸ Langkah Penerapan Bertahap (Deployment Steps):')}`);
      rec.transitionNotes.forEach((note) => {
        lines.push(`    • ${chalk.white(note)}`);
      });
    }

    lines.push(horizontalRule(80, '═'));
  });

  lines.push('');
  return lines.join('\n');
}

/**
 * Mengonstruksi laporan teks lengkap untuk konsol terminal
 */
export function renderTerminalReport(report: SchemaGuardReport): string {
  const output: string[] = [];

  output.push('');
  output.push(chalk.cyan.bold('╔══════════════════════════════════════════════════════════════════════════════╗'));
  output.push(chalk.cyan.bold('║                         🛡️  SCHEMAGUARD AUDIT REPORT                          ║'));
  output.push(chalk.cyan.bold('╚══════════════════════════════════════════════════════════════════════════════╝'));
  output.push(chalk.gray(`Waktu Pemindaian: ${report.timestamp}`));
  output.push('');

  output.push(formatSummaryCards(report.summary));
  output.push(formatDatabaseIssues(report.databaseIssues));
  output.push(formatApiIssues(report.apiIssues));

  if (report.recommendations && report.recommendations.length > 0) {
    output.push(formatRecommendations(report.recommendations));
  }

  output.push(horizontalRule(80, '─'));
  output.push(chalk.gray('SchemaGuard - Melindungi integritas data & kontrak API produksi tanpa waktu henti.'));
  output.push('');

  return output.join('\n');
}

/**
 * Mencetak laporan langsung ke stdout terminal
 */
export function printTerminalReport(report: SchemaGuardReport): void {
  console.log(renderTerminalReport(report));
}
