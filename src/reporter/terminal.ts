/**
 * Pemformat Laporan Tabel Terminal Berbasis Pohon (Compact Tree Terminal Reporter)
 * Menyajikan hasil audit skema basis data, mode penguncian (lock mode),
 * breaking changes API, dan pemetaan dampak silang secara ringkas, ergonomis,
 * dan hierarkis tanpa membanjiri konsol dengan baris kode SQL mentah yang panjang.
 */

import * as path from 'path';
import chalk from 'chalk';
import {
  ApiIssue,
  CrossImpactLink,
  DatabaseIssue,
  LockMode,
  MigrationRecommendation,
  ReportSummary,
  RiskLevel,
  SchemaGuardReport
} from '../types';
import { getApiCompatibilityStatus } from '../analyzer/crossImpact';

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
 * Menghasilkan lencana warna untuk mode penguncian basis data (Lock Mode)
 */
export function formatLockBadge(mode?: LockMode | string): string {
  if (!mode || mode === 'NONE') return '';
  switch (mode) {
    case 'ACCESS_EXCLUSIVE':
    case 'EXCLUSIVE':
      return chalk.red.bold(`[LOCK: ${mode}]`);
    case 'SHARE_ROW_EXCLUSIVE':
    case 'SHARE':
    case 'METADATA_LOCK':
      return chalk.yellow.bold(`[LOCK: ${mode}]`);
    default:
      return chalk.gray(`[LOCK: ${mode}]`);
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
export function formatSummaryCards(summary: ReportSummary, crossImpactCount: number = 0): string {
  const lines: string[] = [];
  const statusBadge = summary.passed
    ? chalk.bgGreen.black.bold(' [PASSED] AMAN ')
    : chalk.bgRed.white.bold(' [BLOCKED] KRITIS ');

  const riskScore = summary.critical > 0
    ? chalk.red.bold('TINGGI (Downtime/Breaking)')
    : summary.warning > 0
    ? chalk.yellow.bold('SEDANG (Potensi Lock/Latensi)')
    : chalk.green.bold('AMAN (0 Risiko)');

  lines.push(
    chalk.bold.cyan('🛡️  SCHEMAGUARD AUDIT: ') + statusBadge + ' ' + chalk.gray(`(Total ${summary.totalIssues} isu)`)
  );
  lines.push(
    `Skor Risiko: ${riskScore} │ DDL Berisiko: ${chalk.bold(summary.totalIssues)} │ API Terdampak: ${chalk.cyan.bold(
      crossImpactCount
    )}`
  );
  lines.push(horizontalRule(80));

  return lines.join('\n');
}

/**
 * Mengelompokkan temuan SQL dan dampaknya ke dalam struktur pohon bersarang (Tree Format)
 */
export function formatFindingsTree(
  dbIssues: DatabaseIssue[],
  crossImpacts: CrossImpactLink[] = [],
  apiIssues: ApiIssue[] = []
): string {
  const lines: string[] = [];
  lines.push(chalk.bold.white('🗄️  STRUKTUR HIERARKI TEMUAN PENGUNCIAN & DAMPAK API:'));

  if (dbIssues.length === 0 && apiIssues.length === 0) {
    lines.push(chalk.green('  ✔ Tidak ditemukan anomali penguncian atau breaking changes.'));
    lines.push('');
    return lines.join('\n');
  }

  // 1. Kelompokkan isu DDL berdasarkan nama tabel
  const tableMap = new Map<string, DatabaseIssue[]>();
  for (const issue of dbIssues) {
    const tableKey = issue.table || 'tabel_umum';
    const group = tableMap.get(tableKey) || [];
    group.push(issue);
    tableMap.set(tableKey, group);
  }

  // Indexing cross impacts berdasarkan table.column
  const impactMap = new Map<string, CrossImpactLink[]>();
  for (const link of crossImpacts) {
    const key = `${link.sqlTable}.${link.sqlColumn}`.toLowerCase();
    const group = impactMap.get(key) || [];
    group.push(link);
    impactMap.set(key, group);
  }

  const tableEntries = Array.from(tableMap.entries());
  tableEntries.forEach(([tableName, issues], tableIdx) => {
    lines.push(chalk.bold.yellow(`📦 ${tableName}`) + chalk.gray(' (Tabel)'));

    issues.forEach((issue, issueIdx) => {
      const isLastIssue = issueIdx === issues.length - 1;
      const branch = isLastIssue ? '└── ' : '├── ';
      const indent = isLastIssue ? '    ' : '│   ';

      const riskIcon = issue.riskLevel === RiskLevel.CRITICAL ? chalk.red('🔴') : chalk.yellow('🟡');
      const lockText = issue.lockMode ? chalk.magenta(`(${issue.lockMode} lock)`) : '';
      const ruleText = chalk.bold.white(issue.ruleName || issue.ruleId);
      const colText = issue.column ? chalk.cyan(`[${issue.column}]`) : '';

      lines.push(`  ${branch}${riskIcon} ${ruleText} ${colText} ${lockText}`);

      // Cari apakah ada dampak ke API
      const key = `${tableName}.${issue.column || ''}`.toLowerCase();
      const impacts = impactMap.get(key) || [];

      if (impacts.length > 0) {
        impacts.forEach((imp, impIdx) => {
          const isLastImp = impIdx === impacts.length - 1;
          const subBranch = isLastImp ? '└── ' : '├── ';
          lines.push(
            `  ${indent}${chalk.blue(subBranch)}🔗 ${chalk.cyan.bold(
              imp.apiMethod + ' ' + imp.apiPath
            )} ${chalk.gray(`(properti '${imp.propertyName}')`)}`
          );
        });
      }
    });

    if (tableIdx < tableEntries.length - 1) {
      lines.push('');
    }
  });

  // 2. Tampilkan isu API langsung (jika ada)
  if (apiIssues.length > 0) {
    lines.push('');
    lines.push(chalk.bold.magenta('🌐 Kontrak OpenAPI:'));
    apiIssues.forEach((issue, idx) => {
      const isLast = idx === apiIssues.length - 1;
      const branch = isLast ? '└── ' : '├── ';
      const riskIcon = issue.riskLevel === RiskLevel.CRITICAL ? chalk.red('🔴') : chalk.yellow('🟡');
      lines.push(
        `  ${branch}${riskIcon} ${chalk.bold.white(issue.method || 'ALL')} ${chalk.cyan(issue.path)} ${chalk.gray(
          `(${issue.ruleId})`
        )}`
      );
      lines.push(`      ${chalk.gray(issue.description)}`);
    });
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format status API yang selaras dengan temuan dampak silang
 */
export function formatApiStatusBanner(apiIssuesCount: number, crossImpactsCount: number): string {
  const status = getApiCompatibilityStatus(apiIssuesCount, crossImpactsCount);
  if (status.isCompatible) {
    return chalk.green(`✔ ${status.statusText}\n`);
  } else if (status.hasIndirectBreakage && apiIssuesCount === 0) {
    return chalk.yellow(`⚠ ${status.statusText}\n`);
  }
  return chalk.red(`✖ ${status.statusText}\n`);
}

/**
 * Format panduan rekomendasi ringkas (Actionable Checklist) tanpa mencetak skrip SQL mentah panjang
 */
export function formatCompactRecommendations(recs: MigrationRecommendation[]): string {
  if (recs.length === 0) return '';

  const lines: string[] = [];
  lines.push(chalk.bold.yellow('🛡️  PANDUAN LANGKAH MITIGASI RINGKAS (EXPAND & CONTRACT):'));

  recs.forEach((rec, idx) => {
    lines.push(`  ${chalk.bold.white(`${idx + 1}. ${rec.target}`)}:`);

    if (rec.issueId === 'DROP_COLUMN' || rec.issueId === 'DROP_TABLE') {
      lines.push(`     • ${chalk.cyan('Expand')}  : Hentikan akses pada kode aplikasi terlebih dahulu, jadikan nullable/deprecated.`);
      lines.push(`     • ${chalk.magenta('Contract')}: Hapus fisik dari basis data setelah 100% armada rilis baru beroperasi.`);
    } else if (rec.issueId === 'ALTER_COLUMN_TYPE' || rec.issueId === 'RENAME_COLUMN') {
      lines.push(`     • ${chalk.cyan('Expand')}  : Tambah kolom bayangan ➔ pasang pemicu dual-write ➔ backfill bertahap (1k-5k baris/batch).`);
      lines.push(`     • ${chalk.magenta('Contract')}: Alihkan kueri baca ke kolom baru ➔ bersihkan pemicu & kolom lama ➔ ganti nama definitif.`);
    } else if (rec.issueId === 'CREATE_INDEX_NON_CONCURRENTLY') {
      lines.push(`     • ${chalk.cyan('Tindakan')}: Buat indeks di luar blok transaksi tunggal menggunakan mode non-pemblokiran (CONCURRENTLY).`);
    } else if (rec.issueId === 'ADD_COLUMN_WITH_DEFAULT') {
      lines.push(`     • ${chalk.cyan('Expand')}  : Tambah kolom sebagai NULLABLE ➔ backfill bertahap (1k-5k baris) di luar jam sibuk.`);
      lines.push(`     • ${chalk.magenta('Contract')}: Tetapkan nilai DEFAULT hanya untuk baris transaksi masa depan.`);
    } else if (rec.issueId === 'VALIDATE_CONSTRAINT') {
      lines.push(`     • ${chalk.cyan('Expand')}  : Tambah batasan menggunakan klausa NOT VALID (lock instan tanpa scan tabel).`);
      lines.push(`     • ${chalk.magenta('Contract')}: Validasi constraint secara terpisah di latar belakang.`);
    } else {
      lines.push(`     • ${chalk.cyan('Expand')}  : ${rec.expandPhase.title}`);
      lines.push(`     • ${chalk.magenta('Contract')}: ${rec.contractPhase.title}`);
    }
  });

  lines.push('');
  return lines.join('\n');
}

/**
 * Format tabel temuan perubahan skema basis data (kompatibilitas lama)
 */
export function formatDatabaseIssues(issues: DatabaseIssue[]): string {
  if (issues.length === 0) {
    return chalk.green('✔ Tidak ditemukan anti-pola skema atau penguncian berbahaya pada SQL.\n');
  }
  return formatFindingsTree(issues, [], []);
}

/**
 * Format tabel temuan pelanggaran spesifikasi kontrak API (kompatibilitas lama)
 */
export function formatApiIssues(issues: ApiIssue[]): string {
  if (issues.length === 0) {
    return chalk.green('✔ Kontrak spesifikasi API sepenuhnya kompatibel ke belakang (backward-compatible).\n');
  }
  return '';
}

/**
 * Format pemetaan dampak silang perubahan skema SQL ke endpoint API (kompatibilitas lama)
 */
export function formatCrossImpacts(crossImpacts: CrossImpactLink[] = []): string {
  if (crossImpacts.length === 0) return '';
  const lines: string[] = [];
  crossImpacts.forEach((link, index) => {
    const num = chalk.gray(`[${index + 1}]`);
    const badge = formatRiskBadge(link.riskLevel);
    lines.push(`  ${num} ${badge} ${chalk.yellow(link.sqlTable + '.' + link.sqlColumn)} ➔ ${chalk.magenta(link.apiMethod + ' ' + link.apiPath)}`);
  });
  return lines.join('\n');
}

/**
 * Format rekomendasi mitigasi migrasi tanpa downtime (kompatibilitas lama)
 */
export function formatRecommendations(recs: MigrationRecommendation[]): string {
  return formatCompactRecommendations(recs);
}

/**
 * Mengonstruksi laporan teks lengkap untuk konsol terminal dengan hierarki pohon yang ergonomis
 */
export function renderTerminalReport(
  report: SchemaGuardReport,
  reportPath: string = './schemaguard-report.html'
): string {
  const output: string[] = [];
  const crossImpacts = report.crossImpacts || [];
  const crossImpactCount = crossImpacts.length;

  output.push('');
  output.push(formatSummaryCards(report.summary, crossImpactCount));

  // Tampilkan struktur pohon hierarkis
  output.push(formatFindingsTree(report.databaseIssues, crossImpacts, report.apiIssues));

  // Tampilkan banner status API yang selaras
  output.push(formatApiStatusBanner(report.apiIssues.length, crossImpactCount));

  // Tampilkan rekomendasi ringkas (tanpa banjir dump SQL mentah)
  if (report.recommendations && report.recommendations.length > 0) {
    output.push(formatCompactRecommendations(report.recommendations));
  }

  // Format tautan file absolut yang dikenali oleh terminal VS Code (Ctrl + Klik)
  const resolvedPath = path.resolve(reportPath);
  const formattedLink = `file:///${resolvedPath.replace(/\\/g, '/')}`;

  // Footer & Tautan file URL
  output.push(horizontalRule(80, '─'));
  output.push(
    `📄 Buka laporan lengkap & skrip SQL mandiri : ${chalk.underline.blue(formattedLink)}`
  );
  output.push(
    `💡 Lewati aturan jika terbukti aman         : ${chalk.gray('schemaguard check --ignore-rule <id>')}`
  );
  output.push(horizontalRule(80, '─'));
  output.push('');

  return output.join('\n');
}

/**
 * Mencetak laporan langsung ke stdout terminal
 */
export function printTerminalReport(report: SchemaGuardReport, reportPath?: string): void {
  console.log(renderTerminalReport(report, reportPath));
}
