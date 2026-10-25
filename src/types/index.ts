/**
 * SchemaGuard Core Type Definitions
 * Tipe data dasar untuk analisis migrasi basis data, kompatibilitas kontrak API,
 * rekomendasi mitigasi bertahap, dan pelaporan risiko.
 */

/**
 * Tingkat keparahan risiko dari perubahan skema atau kontrak API
 */
export enum RiskLevel {
  CRITICAL = 'CRITICAL', // Perubahan merusak (breaking changes) tingkat tinggi yang membahayakan produksi
  WARNING = 'WARNING',   // Perubahan berisiko potensial (misalnya penguncian tabel atau kompatibilitas parsial)
  SAFE = 'SAFE'          // Perubahan aman dan kompatibel ke belakang
}

/**
 * Kategori pelanggaran atau perubahan basis data
 */
export type SqlRuleId =
  | 'DROP_TABLE'
  | 'DROP_COLUMN'
  | 'ALTER_COLUMN_TYPE'
  | 'RENAME_COLUMN'
  | 'ADD_NOT_NULL_WITHOUT_DEFAULT'
  | 'CREATE_INDEX_NON_CONCURRENTLY'
  | 'RENAME_TABLE'
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
  table?: string;
  column?: string;
  line?: number;
  file?: string;
  suggestedFix?: string;
}

/**
 * Definisi aturan deteksi anti-pola skema SQL
 */
export interface SqlRule {
  id: SqlRuleId | string;
  name: string;
  riskLevel: RiskLevel;
  description: string;
  regex: RegExp;
  recommendationTemplate?: string;
}

/**
 * Kategori pelanggaran atau perubahan spesifikasi API
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
  recommendations: MigrationRecommendation[];
}

/**
 * Opsi dasar yang digunakan bersama oleh seluruh perintah CLI
 */
export interface BaseCliOptions {
  format?: 'console' | 'json' | 'markdown' | string;
  output?: string;
  failOn?: 'CRITICAL' | 'WARNING' | RiskLevel | string;
}

/**
 * Opsi konfigurasi eksekusi antarmuka baris perintah (CLI) check-db
 */
export interface CheckDbOptions extends BaseCliOptions {
  file?: string;
  dir?: string;
  base?: string;
}

/**
 * Opsi konfigurasi eksekusi antarmuka baris perintah (CLI) check-api
 */
export interface CheckApiOptions extends BaseCliOptions {
  base: string;
  head: string;
}

/**
 * Opsi konfigurasi eksekusi antarmuka baris perintah (CLI) scan
 */
export interface CliOptions extends BaseCliOptions {
  dbBase?: string;
  dbHead?: string;
  sqlFile?: string;
  sqlDir?: string;
  apiBase?: string;
  apiHead?: string;
  file?: string;
  dir?: string;
  base?: string;
  head?: string;
}
