/**
 * Mesin Penyusun Rekomendasi Skrip Transisi (Migration Recommender Engine)
 * Menganalisis isu-isu perubahan skema basis data dan pelanggaran kontrak API,
 * kemudian merangkai rekomendasi mitigasi bertahap menggunakan pola Expand and Contract.
 */

import { ApiIssue, DatabaseIssue, MigrationRecommendation, RiskLevel } from '../types';
import {
  ColumnContext,
  IndexContext,
  TableContext,
  createAddNotNullRecommendation,
  createAlterColumnTypeRecommendation,
  createApiBreakingChangeRecommendation,
  createDropColumnRecommendation,
  createDropTableRecommendation,
  createIndexRecommendation,
  createRenameColumnRecommendation,
  createRenameTableRecommendation
} from './templates';

/**
 * Mengekstrak informasi tipe data target dari pernyataan ALTER COLUMN TYPE
 */
function extractAlterTypeDetails(statement: string): { newDataType?: string } {
  const match = statement.match(
    /\bALTER\s+(?:COLUMN\s+)?(?:[`"']?[\w]+[`"']?)\s+(?:SET\s+DATA\s+)?TYPE\s+([^;]+)/i
  );
  if (match) {
    return { newDataType: match[1].trim() };
  }
  return {};
}

/**
 * Mengekstrak nama kolom lama dan baru dari pernyataan RENAME COLUMN
 */
function extractRenameColumnDetails(statement: string): { oldColumn?: string; newColumn?: string } {
  const match = statement.match(
    /\bRENAME\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)\s+TO\s+([`"']?[\w]+[`"']?)/i
  );
  if (match) {
    return {
      oldColumn: match[1].replace(/[`"']/g, ''),
      newColumn: match[2].replace(/[`"']/g, '')
    };
  }
  return {};
}

/**
 * Mengekstrak nama tabel baru dari pernyataan RENAME TO
 */
function extractRenameTableDetails(statement: string): { newTable?: string } {
  const match = statement.match(/\bRENAME\s+TO\s+([`"']?[\w.]+[`"']?)/i);
  if (match) {
    return { newTable: match[1].replace(/[`"']/g, '') };
  }
  return {};
}

/**
 * Mengekstrak detail indeks (nama indeks, kolom) dari pernyataan CREATE INDEX
 */
function extractIndexDetails(statement: string): { indexName?: string; columns?: string } {
  const match = statement.match(
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([`"']?[\w]+[`"']?)?\s+ON\s+([`"']?[\w.]+[`"']?)(?:\s*\(([^)]+)\))?/i
  );
  if (match) {
    return {
      indexName: match[1] ? match[1].replace(/[`"']/g, '') : undefined,
      columns: match[3] ? match[3].trim() : undefined
    };
  }
  return {};
}

/**
 * Mengekstrak tipe data dari pernyataan ADD COLUMN ... NOT NULL
 */
function extractAddColumnDetails(statement: string): { dataType?: string } {
  const match = statement.match(
    /\bADD\s+(?:COLUMN\s+)?(?:[`"']?[\w]+[`"']?)\s+([A-Za-z0-9_()]+)/i
  );
  if (match) {
    return { dataType: match[1].trim() };
  }
  return {};
}

/**
 * Menghasilkan rekomendasi mitigasi bertahap untuk satu DatabaseIssue
 */
export function generateRecommendationForDatabaseIssue(
  issue: DatabaseIssue
): MigrationRecommendation {
  const rawStmt = issue.statement || '';
  const table = issue.table || 'tabel_terkait';
  const column = issue.column || 'kolom_terkait';

  switch (issue.ruleId) {
    case 'DROP_TABLE': {
      const ctx: TableContext = { table };
      return createDropTableRecommendation(ctx);
    }

    case 'DROP_COLUMN': {
      const ctx: ColumnContext = { table, column };
      return createDropColumnRecommendation(ctx);
    }

    case 'ALTER_COLUMN_TYPE': {
      const details = extractAlterTypeDetails(rawStmt);
      const ctx: ColumnContext = {
        table,
        column,
        newDataType: details.newDataType || 'TIPE_BARU'
      };
      return createAlterColumnTypeRecommendation(ctx);
    }

    case 'RENAME_COLUMN': {
      const details = extractRenameColumnDetails(rawStmt);
      const ctx: ColumnContext = {
        table,
        column: details.oldColumn || column,
        oldColumn: details.oldColumn || column,
        newColumn: details.newColumn
      };
      return createRenameColumnRecommendation(ctx);
    }

    case 'ADD_NOT_NULL_WITHOUT_DEFAULT': {
      const details = extractAddColumnDetails(rawStmt);
      const ctx: ColumnContext = {
        table,
        column,
        dataType: details.dataType || 'VARCHAR(255)',
        defaultValue: "''"
      };
      return createAddNotNullRecommendation(ctx);
    }

    case 'CREATE_INDEX_NON_CONCURRENTLY': {
      const details = extractIndexDetails(rawStmt);
      const ctx: IndexContext = {
        indexName: details.indexName || 'idx_nama_indeks',
        table,
        columns: details.columns || column
      };
      return createIndexRecommendation(ctx);
    }

    case 'RENAME_TABLE': {
      const details = extractRenameTableDetails(rawStmt);
      const ctx: TableContext = {
        table,
        newTable: details.newTable
      };
      return createRenameTableRecommendation(ctx);
    }

    default: {
      // Fallback umum untuk operasi berbahaya lainnya
      return {
        issueId: issue.ruleId,
        title: `Mitigasi Operasi Berisiko: ${issue.ruleName || issue.ruleId}`,
        target: table,
        description: issue.description || 'Operasi skema berpotensi mengunci tabel atau merusak konsistensi data.',
        expandPhase: {
          phase: 1,
          title: 'Fase Perluas (Expand): Analisis Dampak dan Penyiapan Lingkungan Transisi',
          description: 'Uji eksekusi skema pada staging dengan volume data riil dan gunakan flag fitur (feature flags).',
          script: `-- Evaluasi kueri alternatif:\n-- ${issue.statement}`
        },
        contractPhase: {
          phase: 2,
          title: 'Fase Susutkan (Contract): Penerapan Skema Definitif',
          description: 'Jalankan penerapan perubahan setelah trafik di luar jam sibuk (low-traffic maintenance window).',
          script: `-- Eksekusi terjadwal aman:\n${issue.statement}`
        },
        transitionNotes: [
          'Jalankan pemindaian beban transaksi basis data sebelum menerapkan perubahan.',
          'Pastikan rencana rollback darurat tersedia jika proses melebihi batas waktu toleransi (statement timeout).'
        ]
      };
    }
  }
}

/**
 * Menghasilkan rekomendasi mitigasi bertahap untuk satu ApiIssue
 */
export function generateRecommendationForApiIssue(
  issue: ApiIssue
): MigrationRecommendation {
  return createApiBreakingChangeRecommendation({
    path: issue.path,
    method: issue.method,
    details: `${issue.description} ${issue.details || ''}`.trim()
  });
}

/**
 * Menghasilkan daftar rekomendasi untuk kumpulan DatabaseIssue
 */
export function generateDatabaseRecommendations(
  issues: DatabaseIssue[]
): MigrationRecommendation[] {
  // Hanya buat rekomendasi untuk isu berisiko CRITICAL atau WARNING
  const dangerousIssues = issues.filter(
    (i) => i.riskLevel === RiskLevel.CRITICAL || i.riskLevel === RiskLevel.WARNING
  );

  return dangerousIssues.map((issue) => generateRecommendationForDatabaseIssue(issue));
}

/**
 * Menghasilkan daftar rekomendasi untuk kumpulan ApiIssue
 */
export function generateApiRecommendations(
  issues: ApiIssue[]
): MigrationRecommendation[] {
  const dangerousIssues = issues.filter(
    (i) => i.riskLevel === RiskLevel.CRITICAL || i.riskLevel === RiskLevel.WARNING
  );

  return dangerousIssues.map((issue) => generateRecommendationForApiIssue(issue));
}

/**
 * Menghasilkan rekomendasi holistik gabungan untuk seluruh isu basis data dan kontrak API
 */
export function generateAllRecommendations(options: {
  databaseIssues?: DatabaseIssue[];
  apiIssues?: ApiIssue[];
}): MigrationRecommendation[] {
  const recommendations: MigrationRecommendation[] = [];

  if (options.databaseIssues && options.databaseIssues.length > 0) {
    recommendations.push(...generateDatabaseRecommendations(options.databaseIssues));
  }

  if (options.apiIssues && options.apiIssues.length > 0) {
    recommendations.push(...generateApiRecommendations(options.apiIssues));
  }

  return recommendations;
}
