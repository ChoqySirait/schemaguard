/**
 * Pemformat Laporan Markdown untuk Pull Request GitHub (Markdown Reporter)
 * Menghasilkan ringkasan berformat Markdown terstruktur yang siap disematkan
 * sebagai komentar bot otomatis pada Pull Request GitHub CI/CD.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ApiIssue,
  CrossImpactLink,
  DatabaseIssue,
  MigrationRecommendation,
  ReportSummary,
  RiskLevel,
  SchemaGuardReport
} from '../types';

/**
 * Lencana Markdown untuk tingkat risiko
 */
export function getMarkdownBadge(level: RiskLevel): string {
  switch (level) {
    case RiskLevel.CRITICAL:
      return '🔴 `CRITICAL`';
    case RiskLevel.WARNING:
      return '🟡 `WARNING`';
    case RiskLevel.SAFE:
      return '🟢 `SAFE`';
    default:
      return `⚪ \`${level}\``;
  }
}

/**
 * Format tabel ringkasan evaluasi dalam Markdown
 */
export function formatMarkdownSummary(summary: ReportSummary, crossImpactCount: number = 0): string {
  const lines: string[] = [];

  const statusBadge = summary.passed
    ? '### ✅ Status: PASSED (Siap Digabung)'
    : '### ❌ Status: BLOCKED (Perubahan Merusak Terdeteksi)';

  lines.push(statusBadge);
  lines.push('');
  lines.push('| Metrik Evaluasi | Nilai | Catatan |');
  lines.push('| :--- | :---: | :--- |');
  lines.push(`| **Total Isu** | **${summary.totalIssues}** | Seluruh temuan skema dan API |`);
  lines.push(`| 🔴 **Risiko Kritis (Breaking)** | **${summary.critical}** | Operasi yang menggagalkan aplikasi aktif atau lock eksklusif |`);
  lines.push(`| 🟡 **Peringatan (Warning)** | **${summary.warning}** | Potensi penguncian tabel / latensi tinggi |`);
  lines.push(`| 🟢 **Aman (Safe)** | **${summary.safe}** | Perubahan kompatibel ke belakang |`);
  if (crossImpactCount > 0) {
    lines.push(`| 🔗 **Dampak Silang (Cross-Impact)** | **${crossImpactCount}** | Modifikasi kolom SQL yang memutus properti API |`);
  }
  lines.push('');

  if (!summary.passed) {
    lines.push('> [!CAUTION]');
    lines.push(
      '> **Peringatan Penggabungan Kode:** Pull Request ini mengandung perubahan berbahaya (*breaking changes* / *exclusive lock*) yang dapat menyebabkan kegagalan sistem atau waktu henti (*downtime*) di lingkungan produksi jika diterapkan secara langsung.'
    );
    lines.push('');
  } else {
    lines.push('> [!NOTE]');
    lines.push(
      '> Tidak ada perubahan skema atau kontrak API berkategori kritis. Penerapan aman dilakukan dengan prosedur standar.'
    );
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format tabel daftar isu migrasi SQL
 */
export function formatMarkdownDatabaseIssues(issues: DatabaseIssue[]): string {
  if (issues.length === 0) {
    return '*(Tidak ada pelanggaran skema basis data yang terdeteksi)*\n';
  }

  const lines: string[] = [];
  lines.push('<details open>');
  lines.push(`<summary><b>🗄️ Daftar Pelanggaran Skema Basis Data (${issues.length})</b></summary>`);
  lines.push('');
  lines.push('| Tingkat | Aturan | Mode Kunci | Target | Kueri SQL | Berkas |');
  lines.push('| :---: | :--- | :---: | :--- | :--- | :--- |');

  issues.forEach((issue) => {
    const badge = getMarkdownBadge(issue.riskLevel);
    const lockBadge = issue.lockMode ? `\`${issue.lockMode}\`` : '-';
    const rule = `**${issue.ruleName || issue.ruleId}**<br>_${issue.description}_`;
    const target = issue.table ? `\`${issue.table}${issue.column ? `.${issue.column}` : ''}\`` : '-';
    const stmt = issue.statement
      ? `\`${issue.statement.trim().replace(/\s+/g, ' ').slice(0, 70)}...\``
      : '-';
    const loc = issue.file ? `\`${issue.file}${issue.line ? `:${issue.line}` : ''}\`` : '-';

    lines.push(`| ${badge} | ${rule} | ${lockBadge} | ${target} | ${stmt} | ${loc} |`);
  });

  lines.push('');
  lines.push('</details>');
  lines.push('');

  return lines.join('\n');
}

/**
 * Format tabel daftar isu kontrak API
 */
export function formatMarkdownApiIssues(issues: ApiIssue[]): string {
  if (issues.length === 0) {
    return '*(Spesifikasi kontrak API sepenuhnya kompatibel ke belakang)*\n';
  }

  const lines: string[] = [];
  lines.push('<details open>');
  lines.push(`<summary><b>🌐 Daftar Pelanggaran Kontrak API (${issues.length})</b></summary>`);
  lines.push('');
  lines.push('| Tingkat | Aturan | Endpoint & Metode | Deskripsi Dampak |');
  lines.push('| :---: | :--- | :--- | :--- |');

  issues.forEach((issue) => {
    const badge = getMarkdownBadge(issue.riskLevel);
    const endpoint = `\`${(issue.method || 'ALL').toUpperCase()} ${issue.path}\``;
    const desc = `**${issue.description}**${issue.details ? `<br>_${issue.details}_` : ''}`;

    lines.push(`| ${badge} | \`${issue.ruleId}\` | ${endpoint} | ${desc} |`);
  });

  lines.push('');
  lines.push('</details>');
  lines.push('');

  return lines.join('\n');
}

/**
 * Format pemetaan dampak silang SQL ke API dalam Markdown
 */
export function formatMarkdownCrossImpacts(crossImpacts: CrossImpactLink[] = []): string {
  if (crossImpacts.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('<details open>');
  lines.push(`<summary><b>🔗 Pemetaan Dampak Silang (SQL ➔ API: ${crossImpacts.length})</b></summary>`);
  lines.push('');
  lines.push('| Kolom SQL | | Rute & Properti API | Potensi Dampak | Tingkat |');
  lines.push('| :--- | :---: | :--- | :--- | :---: |');

  crossImpacts.forEach((link) => {
    const badge = getMarkdownBadge(link.riskLevel);
    const sqlCol = `\`${link.sqlTable}.${link.sqlColumn}\``;
    const apiRoute = `\`${link.apiMethod} ${link.apiPath}\` (\`${link.propertyName}\`)`;

    lines.push(`| ${sqlCol} | ➔ | ${apiRoute} | ${link.impactDescription} | ${badge} |`);
  });

  lines.push('');
  lines.push('</details>');
  lines.push('');

  return lines.join('\n');
}

/**
 * Format bagian rekomendasi pola Expand & Contract
 */
export function formatMarkdownRecommendations(recs: MigrationRecommendation[]): string {
  if (recs.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('---');
  lines.push('### 🛡️ Usulan Strategi Mitigasi Aman (Expand & Contract)');
  lines.push('');
  lines.push('Terapkan strategi dua fase berikut untuk mencegah waktu henti (*zero-downtime deployment*):');
  lines.push('');

  recs.forEach((rec, idx) => {
    lines.push(`<details open>`);
    lines.push(
      `<summary><b>Rekomendasi ${idx + 1}: ${rec.title}</b> (Target: <code>${rec.target}</code>)</summary>`
    );
    lines.push('');
    lines.push(`${rec.description}`);
    lines.push('');

    // Fase 1: Expand
    lines.push(`#### 1. ${rec.expandPhase.title}`);
    lines.push(`_${rec.expandPhase.description}_`);
    lines.push('');
    lines.push('```sql');
    lines.push(rec.expandPhase.script);
    lines.push('```');
    lines.push('');

    // Fase 2: Contract
    lines.push(`#### 2. ${rec.contractPhase.title}`);
    lines.push(`_${rec.contractPhase.description}_`);
    lines.push('');
    lines.push('```sql');
    lines.push(rec.contractPhase.script);
    lines.push('```');
    lines.push('');

    // Catatan transisi
    if (rec.transitionNotes && rec.transitionNotes.length > 0) {
      lines.push('**Prosedur Penerapan Bertahap:**');
      rec.transitionNotes.forEach((note) => {
        lines.push(`- [ ] ${note}`);
      });
      lines.push('');
    }

    lines.push('</details>');
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Mengonstruksi laporan Markdown terstruktur secara utuh
 */
export function renderMarkdownReport(report: SchemaGuardReport): string {
  const parts: string[] = [];
  const crossImpactCount = report.crossImpacts ? report.crossImpacts.length : 0;

  parts.push('## 🛡️ SchemaGuard Quality Gate Report');
  parts.push(`*Dipindai secara otomatis pada: \`${report.timestamp}\`*`);
  parts.push('');

  parts.push(formatMarkdownSummary(report.summary, crossImpactCount));
  parts.push('---');
  parts.push('### 📋 Rincian Temuan Evaluasi');
  parts.push('');
  parts.push(formatMarkdownDatabaseIssues(report.databaseIssues));
  parts.push(formatMarkdownApiIssues(report.apiIssues));

  if (report.crossImpacts && report.crossImpacts.length > 0) {
    parts.push(formatMarkdownCrossImpacts(report.crossImpacts));
  }

  if (report.recommendations && report.recommendations.length > 0) {
    parts.push(formatMarkdownRecommendations(report.recommendations));
  }

  parts.push('---');
  parts.push(
    '*Laporan ini dibuat otomatis oleh [SchemaGuard](https://github.com/ChoqySirait/schemaguard) GitHub Action.*'
  );

  return parts.join('\n');
}

/**
 * Menyimpan laporan Markdown ke berkas target
 */
export function saveMarkdownReport(report: SchemaGuardReport, outputPath: string): void {
  const markdownContent = renderMarkdownReport(report);
  const resolvedPath = path.resolve(outputPath);
  const dir = path.dirname(resolvedPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(resolvedPath, markdownContent, 'utf-8');
}
