/**
 * Generator Laporan Visual HTML Mandiri (Self-Contained Standalone HTML Reporter)
 * Menghasilkan dasbor web statis dark-mode yang elegan, interaktif, dan tanpa dependensi
 * jaringan luar (offline-ready) untuk meninjau audit skema basis data, risiko lock contention,
 * pemutusan kontrak API, dampak silang (cross-impact), dan skrip mitigasi Expand-Contract.
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
 * Melakukan sanitasi string agar aman disematkan ke dalam elemen HTML
 */
function escapeHtml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Menghasilkan badge HTML untuk tingkat risiko
 */
function renderRiskBadge(level: RiskLevel): string {
  switch (level) {
    case RiskLevel.CRITICAL:
      return `<span class="badge badge-critical">CRITICAL</span>`;
    case RiskLevel.WARNING:
      return `<span class="badge badge-warning">WARNING</span>`;
    case RiskLevel.SAFE:
      return `<span class="badge badge-safe">SAFE</span>`;
    default:
      return `<span class="badge badge-info">${escapeHtml(level)}</span>`;
  }
}

/**
 * Menghasilkan badge metode HTTP
 */
function renderMethodBadge(method: string = 'GET'): string {
  const m = method.toUpperCase();
  let colorClass = 'method-get';
  if (m === 'POST') colorClass = 'method-post';
  else if (m === 'PUT') colorClass = 'method-put';
  else if (m === 'DELETE') colorClass = 'method-delete';
  else if (m === 'PATCH') colorClass = 'method-patch';

  return `<span class="badge ${colorClass}">${escapeHtml(m)}</span>`;
}

/**
 * Menghasilkan markup tabel isu basis data dan lock contention
 */
function renderDatabaseIssuesSection(issues: DatabaseIssue[]): string {
  if (issues.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-icon">✓</div>
        <p>Tidak ditemukan anomali penguncian atau perubahan berbahaya pada migrasi SQL.</p>
      </div>
    `;
  }

  const items = issues
    .map((issue) => {
      const lockBadge = issue.lockMode
        ? `<span class="badge badge-lock">${escapeHtml(issue.lockMode)}</span>`
        : '';
      const dialectBadge = issue.dialect
        ? `<span class="badge badge-dialect">${escapeHtml(issue.dialect)}</span>`
        : '';
      const target = [issue.table, issue.column].filter(Boolean).join('.');

      return `
        <div class="issue-card ${issue.riskLevel === RiskLevel.CRITICAL ? 'card-critical' : 'card-warning'}">
          <div class="issue-header">
            <div class="issue-title-group">
              <span class="issue-rule">${escapeHtml(issue.ruleName || issue.ruleId)}</span>
              ${renderRiskBadge(issue.riskLevel)}
              ${lockBadge}
              ${dialectBadge}
            </div>
            ${target ? `<div class="issue-target">Target: <code>${escapeHtml(target)}</code></div>` : ''}
          </div>
          <p class="issue-description">${escapeHtml(issue.description)}</p>
          <div class="sql-box">
            <div class="box-label">Pernyataan DDL SQL:</div>
            <pre><code>${escapeHtml(issue.statement)}</code></pre>
          </div>
          ${
            issue.file
              ? `<div class="issue-location">Lokasi: <code>${escapeHtml(issue.file)}${issue.line ? `:${issue.line}` : ''}</code></div>`
              : ''
          }
          ${
            issue.suggestedFix
              ? `<div class="fix-box"><strong>Rekomendasi Cepat:</strong> ${escapeHtml(issue.suggestedFix)}</div>`
              : ''
          }
        </div>
      `;
    })
    .join('\n');

  return `<div class="issues-list">${items}</div>`;
}

/**
 * Menghasilkan markup tabel isu breaking changes OpenAPI
 */
function renderApiIssuesSection(issues: ApiIssue[]): string {
  if (issues.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-icon">✓</div>
        <p>Seluruh kontrak spesifikasi OpenAPI kompatibel ke belakang tanpa breaking changes.</p>
      </div>
    `;
  }

  const items = issues
    .map((issue) => {
      return `
        <div class="issue-card card-critical">
          <div class="issue-header">
            <div class="issue-title-group">
              ${renderMethodBadge(issue.method || 'ALL')}
              <span class="api-path"><code>${escapeHtml(issue.path)}</code></span>
              ${renderRiskBadge(issue.riskLevel)}
            </div>
            <span class="badge badge-rule">${escapeHtml(issue.ruleId)}</span>
          </div>
          <p class="issue-description">${escapeHtml(issue.description)}</p>
          ${issue.details ? `<div class="details-box">${escapeHtml(issue.details)}</div>` : ''}
        </div>
      `;
    })
    .join('\n');

  return `<div class="issues-list">${items}</div>`;
}

/**
 * Menghasilkan markup pemetaan dampak silang (Cross-Impact Links)
 */
function renderCrossImpactSection(links: CrossImpactLink[] = []): string {
  if (links.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-icon">✓</div>
        <p>Tidak ada keterkaitan dampak langsung antara kolom SQL yang dimodifikasi dengan properti respons API.</p>
      </div>
    `;
  }

  const rows = links
    .map((link) => {
      return `
        <tr>
          <td><code>${escapeHtml(link.sqlTable)}.${escapeHtml(link.sqlColumn)}</code></td>
          <td><span class="arrow-indicator">➔</span></td>
          <td>${renderMethodBadge(link.apiMethod)} <code>${escapeHtml(link.apiPath)}</code> (<code>${escapeHtml(link.propertyName)}</code>)</td>
          <td>${escapeHtml(link.impactDescription)}</td>
          <td>${renderRiskBadge(link.riskLevel)}</td>
        </tr>
      `;
    })
    .join('\n');

  return `
    <div class="table-container">
      <table class="report-table">
        <thead>
          <tr>
            <th>Kolom Skema SQL</th>
            <th></th>
            <th>Endpoint & Properti API Terdampak</th>
            <th>Deskripsi Potensi Dampak</th>
            <th>Tingkat Risiko</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Menghasilkan markup draf skrip mitigasi migrasi Expand-Contract
 */
function renderRecommendationsSection(recommendations: MigrationRecommendation[]): string {
  if (recommendations.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-icon">✓</div>
        <p>Tidak ada skrip mitigasi khusus yang diperlukan.</p>
      </div>
    `;
  }

  const items = recommendations
    .map((rec, idx) => {
      const notes = rec.transitionNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join('\n');

      return `
        <div class="rec-accordion">
          <div class="rec-header">
            <div class="rec-title">
              <span class="rec-index">#${idx + 1}</span>
              <strong>${escapeHtml(rec.title)}</strong>
              <span class="rec-target">Target: <code>${escapeHtml(rec.target)}</code></span>
            </div>
          </div>
          <p class="rec-desc">${escapeHtml(rec.description)}</p>

          <div class="phases-grid">
            <div class="phase-box phase-expand">
              <div class="phase-badge">Fase 1: Expand (Perluas)</div>
              <h4>${escapeHtml(rec.expandPhase.title)}</h4>
              <p>${escapeHtml(rec.expandPhase.description)}</p>
              <pre><code>${escapeHtml(rec.expandPhase.script)}</code></pre>
            </div>

            <div class="phase-box phase-contract">
              <div class="phase-badge">Fase 2: Contract (Susutkan)</div>
              <h4>${escapeHtml(rec.contractPhase.title)}</h4>
              <p>${escapeHtml(rec.contractPhase.description)}</p>
              <pre><code>${escapeHtml(rec.contractPhase.script)}</code></pre>
            </div>
          </div>

          <div class="notes-box">
            <div class="notes-title">📋 Catatan Transisi & Panduan Penerapan:</div>
            <ul>${notes}</ul>
          </div>
        </div>
      `;
    })
    .join('\n');

  return `<div class="recommendations-container">${items}</div>`;
}

/**
 * Mengompilasi seluruh data laporan ke dalam satu string HTML statis mandiri
 */
export function generateHtmlReport(report: SchemaGuardReport): string {
  const summary: ReportSummary = report.summary;
  const statusClass = summary.passed ? 'status-passed' : 'status-blocked';
  const statusText = summary.passed ? 'PASSED (SIAP DIGABUNG)' : 'BLOCKED (PERUBAHAN MERUSAK)';
  const crossImpactCount = report.crossImpacts ? report.crossImpacts.length : 0;

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SchemaGuard - Laporan Audit Skema & Kontrak API</title>
  <style>
    :root {
      --bg-primary: #090d16;
      --bg-surface: #111827;
      --bg-card: #1f2937;
      --bg-code: #0b0f19;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --border-color: #374151;
      --color-critical: #ef4444;
      --color-critical-bg: rgba(239, 68, 68, 0.12);
      --color-warning: #f59e0b;
      --color-warning-bg: rgba(245, 158, 11, 0.12);
      --color-safe: #10b981;
      --color-safe-bg: rgba(16, 185, 129, 0.12);
      --color-accent: #3b82f6;
      --color-accent-bg: rgba(59, 130, 246, 0.12);
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-primary);
      color: var(--text-main);
      font-family: var(--font-family);
      line-height: 1.6;
      padding: 2rem 1rem;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    /* Header & Hero */
    .header {
      background: linear-gradient(135deg, #111827 0%, #1e1b4b 100%);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 2rem;
      margin-bottom: 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1.5rem;
    }

    .brand-title {
      font-size: 1.75rem;
      font-weight: 800;
      letter-spacing: -0.025em;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .brand-title .logo-shield {
      background: var(--color-accent);
      color: white;
      padding: 0.2rem 0.6rem;
      border-radius: 6px;
      font-size: 1.25rem;
    }

    .timestamp {
      color: var(--text-muted);
      font-size: 0.875rem;
      margin-top: 0.25rem;
    }

    .status-pill {
      font-weight: 700;
      font-size: 1rem;
      padding: 0.6rem 1.25rem;
      border-radius: 9999px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .status-passed {
      background: var(--color-safe-bg);
      color: var(--color-safe);
      border: 1px solid var(--color-safe);
    }

    .status-blocked {
      background: var(--color-critical-bg);
      color: var(--color-critical);
      border: 1px solid var(--color-critical);
      box-shadow: 0 0 15px rgba(239, 68, 68, 0.25);
    }

    /* Metric Cards */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2.5rem;
    }

    .metric-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 1.25rem;
      text-align: center;
    }

    .metric-value {
      font-size: 2.25rem;
      font-weight: 800;
      margin-bottom: 0.25rem;
    }

    .metric-label {
      color: var(--text-muted);
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .val-critical { color: var(--color-critical); }
    .val-warning { color: var(--color-warning); }
    .val-safe { color: var(--color-safe); }
    .val-total { color: var(--text-main); }
    .val-impact { color: var(--color-accent); }

    /* Sections */
    .section {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.75rem;
      margin-bottom: 2rem;
    }

    .section-title {
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 0.75rem;
    }

    /* Badges */
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      letter-spacing: 0.025em;
    }

    .badge-critical { background: var(--color-critical-bg); color: var(--color-critical); border: 1px solid var(--color-critical); }
    .badge-warning { background: var(--color-warning-bg); color: var(--color-warning); border: 1px solid var(--color-warning); }
    .badge-safe { background: var(--color-safe-bg); color: var(--color-safe); border: 1px solid var(--color-safe); }
    .badge-lock { background: #4c1d95; color: #c4b5fd; border: 1px solid #7c3aed; }
    .badge-dialect { background: #1e3a8a; color: #93c5fd; }
    .badge-rule { background: #374151; color: #d1d5db; }

    .method-get { background: #064e3b; color: #6ee7b7; }
    .method-post { background: #1e3a8a; color: #93c5fd; }
    .method-put { background: #78350f; color: #fcd34d; }
    .method-delete { background: #7f1d1d; color: #fca5a5; }
    .method-patch { background: #4c1d95; color: #d8b4fe; }

    /* Issue Cards */
    .issues-list { display: flex; flex-direction: column; gap: 1rem; }
    .issue-card {
      background: var(--bg-card);
      border-radius: 8px;
      padding: 1.25rem;
      border-left: 4px solid var(--border-color);
    }
    .card-critical { border-left-color: var(--color-critical); }
    .card-warning { border-left-color: var(--color-warning); }

    .issue-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .issue-title-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .issue-rule { font-weight: 700; font-size: 1.05rem; }
    .issue-target code { background: #111827; padding: 0.1rem 0.4rem; border-radius: 4px; color: #e5e7eb; }
    .issue-description { color: #d1d5db; margin-bottom: 0.75rem; font-size: 0.95rem; }

    .sql-box {
      background: var(--bg-code);
      border: 1px solid #2d3748;
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 0.75rem;
      overflow-x: auto;
    }
    .sql-box .box-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-bottom: 0.25rem;
      font-weight: 600;
    }
    .sql-box code { color: #93c5fd; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.9rem; }

    .fix-box {
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.2);
      border-radius: 6px;
      padding: 0.6rem 0.8rem;
      font-size: 0.875rem;
      color: #a7f3d0;
    }

    .issue-location {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    /* Tables */
    .table-container { overflow-x: auto; }
    .report-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    .report-table th, .report-table td {
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }
    .report-table th {
      background: #1e293b;
      color: #cbd5e1;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
    }
    .arrow-indicator { color: var(--color-accent); font-weight: bold; }

    /* Expand Contract Recommendations */
    .rec-accordion {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1.25rem;
      margin-bottom: 1.25rem;
    }
    .rec-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.5rem;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .rec-index {
      background: var(--color-accent-bg);
      color: var(--color-accent);
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      font-size: 0.8rem;
      margin-right: 0.5rem;
    }
    .rec-desc { color: var(--text-muted); margin-bottom: 1rem; font-size: 0.9rem; }

    .phases-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .phase-box {
      background: var(--bg-code);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 1rem;
    }
    .phase-expand { border-top: 3px solid var(--color-accent); }
    .phase-contract { border-top: 3px solid var(--color-safe); }

    .phase-badge {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      margin-bottom: 0.5rem;
      color: var(--text-muted);
    }
    .phase-box h4 { font-size: 0.95rem; margin-bottom: 0.35rem; }
    .phase-box p { font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.75rem; }
    .phase-box pre {
      background: #040711;
      padding: 0.75rem;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.85rem;
      color: #38bdf8;
      border: 1px solid #1e293b;
    }

    .notes-box {
      background: rgba(255, 255, 255, 0.03);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      font-size: 0.875rem;
    }
    .notes-title { font-weight: 600; margin-bottom: 0.4rem; color: #e2e8f0; }
    .notes-box ul { margin-left: 1.5rem; color: #94a3b8; }
    .notes-box li { margin-bottom: 0.25rem; }

    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 2.5rem 1rem;
      color: var(--text-muted);
    }
    .empty-icon {
      font-size: 2rem;
      color: var(--color-safe);
      margin-bottom: 0.5rem;
    }

    /* Footer */
    .footer {
      text-align: center;
      color: var(--text-muted);
      font-size: 0.85rem;
      margin-top: 3rem;
      border-top: 1px solid var(--border-color);
      padding-top: 1.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header class="header">
      <div>
        <div class="brand-title">
          <span class="logo-shield">SG</span> SchemaGuard Security Report
        </div>
        <div class="timestamp">Waktu Pemindaian: ${escapeHtml(report.timestamp)}</div>
      </div>
      <div>
        <div class="status-pill ${statusClass}">${statusText}</div>
      </div>
    </header>

    <!-- Metrics Cards -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value val-total">${summary.totalIssues}</div>
        <div class="metric-label">Total Isu Terdeteksi</div>
      </div>
      <div class="metric-card">
        <div class="metric-value val-critical">${summary.critical}</div>
        <div class="metric-label">Risiko Kritis (Breaking)</div>
      </div>
      <div class="metric-card">
        <div class="metric-value val-warning">${summary.warning}</div>
        <div class="metric-label">Peringatan (Warning)</div>
      </div>
      <div class="metric-card">
        <div class="metric-value val-safe">${summary.safe}</div>
        <div class="metric-label">Operasi Aman (Safe)</div>
      </div>
      <div class="metric-card">
        <div class="metric-value val-impact">${crossImpactCount}</div>
        <div class="metric-label">Dampak Silang (SQL-API)</div>
      </div>
    </div>

    <!-- Bagian 1: Database Issues -->
    <section class="section">
      <h2 class="section-title">🗄️ Audit Migrasi Basis Data & Lock Contention</h2>
      ${renderDatabaseIssuesSection(report.databaseIssues)}
    </section>

    <!-- Bagian 2: API Issues -->
    <section class="section">
      <h2 class="section-title">🌐 Kompatibilitas Kontrak API (OpenAPI)</h2>
      ${renderApiIssuesSection(report.apiIssues)}
    </section>

    <!-- Bagian 3: Cross Impact -->
    <section class="section">
      <h2 class="section-title">🔗 Pemetaan Dampak Silang (Cross-Impact: SQL ke API)</h2>
      ${renderCrossImpactSection(report.crossImpacts)}
    </section>

    <!-- Bagian 4: Expand Contract Recommendations -->
    <section class="section">
      <h2 class="section-title">🛡️ Strategi Mitigasi Transisi Aman (Pola Expand-Contract)</h2>
      ${renderRecommendationsSection(report.recommendations)}
    </section>

    <!-- Footer -->
    <footer class="footer">
      <p>Dihasilkan secara deterministik oleh <strong>SchemaGuard CLI</strong> — Perkakas Pencegah Downtime DDL & Breaking Changes API.</p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Menyimpan laporan HTML statis ke berkas tujuan
 */
export function saveHtmlReport(report: SchemaGuardReport, outputPath: string): void {
  const absolutePath = path.resolve(outputPath);
  const dir = path.dirname(absolutePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const htmlContent = generateHtmlReport(report);
  fs.writeFileSync(absolutePath, htmlContent, 'utf-8');
}
