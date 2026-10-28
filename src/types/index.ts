/**
 * SchemaGuard Core Type Definitions
 * Tipe data strictly-typed untuk analisis migrasi basis data (DDL lock contention),
 * kompatibilitas kontrak API (OpenAPI), pemetaan dampak silang (cross-impact),
 * rekomendasi mitigasi Expand-Contract, dan generator laporan visual.
 */

/**
 * Tingkat keparahan risiko dari perubahan skema atau kontrak API
 */
export enum RiskLevel {
  CRITICAL = 'CRITICAL', // Perubahan merusak (breaking) / table lock eksklusif yang memicu downtime
  WARNING = 'WARNING',   // Perubahan berisiko potensial (lock sedang atau penurunan performa)
  SAFE = 'SAFE'          // Perubahan aman dan kompatibel ke belakang
}

/**
 * Dialek basis data yang didukung oleh mesin auditor
 */
export type DatabaseDialect = 'postgresql' | 'mysql' | 'generic';

/**
 * Mode penguncian tabel pada basis data relasional
 */
export type LockMode =
  | 'ACCESS_EXCLUSIVE'      // PostgreSQL AccessExclusiveLock: memblokir seluruh SELECT, INSERT, UPDATE, DELETE
  | 'SHARE_ROW_EXCLUSIVE'  // PostgreSQL ShareRowExclusiveLock: memblokir penulisan konkuren
  | 'SHARE'                // PostgreSQL ShareLock: memblokir modifikasi data selama indeks dibuat
  | 'EXCLUSIVE'            // PostgreSQL ExclusiveLock
  | 'METADATA_LOCK'        // MySQL Metadata Lock (MDL): memblokir DDL dan DML konkuren
  | 'NONE';                // Tanpa penguncian signifikan (operasi konkuren aman)

/**
 * Kategori pelanggaran atau operasi berbahaya skema DDL basis data
 */
export type SqlRuleId =
  | 'DROP_TABLE'
  | 'DROP_COLUMN'
  | 'ALTER_COLUMN_TYPE'
  | 'RENAME_COLUMN'
  | 'ADD_NOT_NULL_WITHOUT_DEFAULT'
  | 'CREATE_INDEX_NON_CONCURRENTLY'
  | 'RENAME_TABLE'
  | 'ADD_COLUMN_WITH_DEFAULT'
  | 'VALIDATE_CONSTRAINT'
  | 'GENERIC_DANGEROUS_OP';

/**
 * Representasi satu pelanggaran atau temuan pada berkas migrasi SQL
 */
export interface DatabaseIssue {
  ruleId: SqlRuleId | string;
  ruleName: string;
  description: string;
  statement: string;
  riskLevel: RiskLevel;
  lockMode?: LockMode | string;
  dialect?: DatabaseDialect;
  table?: string;
  column?: string;
  line?: number;
  file?: string;
  suggestedFix?: string;
}

/**
 * Definisi aturan deteksi anti-pola dan lock contention skema SQL
 */
export interface SqlRule {
  id: SqlRuleId | string;
  name: string;
  riskLevel: RiskLevel;
  lockMode?: LockMode | string;
  dialect?: DatabaseDialect;
  description: string;
  regex: RegExp;
  recommendationTemplate?: string;
}

/**
 * Kategori pelanggaran atau perubahan spesifikasi API (OpenAPI)
 */
export type ApiRuleId =
  | 'ENDPOINT_REMOVED'
  | 'METHOD_REMOVED'
  | 'REQUIRED_PARAMETER_ADDED'
  | 'RESPONSE_SCHEMA_CHANGED'
  | 'STATUS_CODE_REMOVED'
  | 'PROPERTY_TYPE_CHANGED';

/**
 * Representasi satu pelanggaran atau temuan pada spesifikasi API (OpenAPI)
 */
export interface ApiIssue {
  ruleId: ApiRuleId | string;
  path: string;
  method?: string;
  description: string;
  riskLevel: RiskLevel;
  details?: string;
  property?: string;
}

/**
 * Pemetaan keterkaitan langsung antara perubahan kolom SQL terhadap rute API (Cross-Impact)
 */
export interface CrossImpactLink {
  sqlTable: string;
  sqlColumn: string;
  apiPath: string;
  apiMethod: string;
  propertyName: string;
  impactDescription: string;
  riskLevel: RiskLevel;
}

/**
 * Definisi fase mitigasi migrasi pola Expand and Contract
 */
export interface MigrationPhase {
  phase: number;
  title: string;
  description: string;
  script: string;
}

/**
 * Rekomendasi strategi mitigasi migrasi tanpa downtime
 */
export interface MigrationRecommendation {
  issueId?: string;
  title: string;
  target: string;
  description: string;
  expandPhase: MigrationPhase;
  contractPhase: MigrationPhase;
  transitionNotes: string[];
}

/**
 * Ringkasan evaluasi metrik risiko
 */
export interface ReportSummary {
  totalIssues: number;
  critical: number;
  warning: number;
  safe: number;
  passed: boolean;
}

/**
 * Hasil lengkap evaluasi SchemaGuard
 */
export interface SchemaGuardReport {
  timestamp: string;
  summary: ReportSummary;
  databaseIssues: DatabaseIssue[];
  apiIssues: ApiIssue[];
  crossImpacts?: CrossImpactLink[];
  recommendations: MigrationRecommendation[];
}

/**
 * Opsi dasar yang digunakan bersama oleh seluruh perintah CLI
 */
export interface BaseCliOptions {
  format?: 'console' | 'json' | 'html' | 'markdown' | string;
  output?: string;
  failOn?: 'CRITICAL' | 'WARNING' | RiskLevel | string;
  htmlReport?: string;
}

/**
 * Opsi konfigurasi eksekusi antarmuka baris perintah (CLI) check-db
 */
export interface CheckDbOptions extends BaseCliOptions {
  file?: string;
  dir?: string;
  base?: string;
  migrations?: string;
}

/**
 * Opsi konfigurasi eksekusi antarmuka baris perintah (CLI) check-api
 */
export interface CheckApiOptions extends BaseCliOptions {
  base: string;
  head: string;
  api?: string;
}

/**
 * Opsi konfigurasi eksekusi antarmuka baris perintah (CLI) scan / check
 */
export interface CliOptions extends BaseCliOptions {
  dbBase?: string;
  dbHead?: string;
  sqlFile?: string;
  sqlDir?: string;
  migrations?: string;
  apiBase?: string;
  apiHead?: string;
  api?: string;
  file?: string;
  dir?: string;
  base?: string;
  head?: string;
  htmlReport?: string;
}
