/**
 * Katalog Aturan Mitigasi Lock Contention DDL Skema Basis Data (PostgreSQL & MySQL)
 * Mendefinisikan aturan deteksi statis terhadap operasi DDL berbahaya yang memicu
 * AccessExclusiveLock, Metadata Lock, atau penguncian tabel penuh di lingkungan produksi.
 *
 * Referensi Praktik Rekayasa:
 * - PostgreSQL Explicit Locking: https://www.postgresql.org/docs/current/explicit-locking.html
 * - Stripe Online Migrations at Scale: https://stripe.com/blog/online-migrations
 */

import { DatabaseDialect, LockMode, RiskLevel, SqlRule } from '../types';

export const SQL_RULES: SqlRule[] = [
  {
    id: 'DROP_TABLE',
    name: 'Drop Table Statement',
    riskLevel: RiskLevel.CRITICAL,
    lockMode: 'ACCESS_EXCLUSIVE',
    dialect: 'generic',
    description: 'DROP TABLE mengakuisisi ACCESS EXCLUSIVE LOCK di PostgreSQL dan Metadata Lock di MySQL, memblokir seluruh kueri baca/tulis aktif serta menghapus data secara permanen.',
    regex: /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([`"']?[\w.]+[`"']?)/i,
    recommendationTemplate: 'Terapkan pola Expand-Contract: tandai tabel sebagai deprecated, alihkan ketergantungan kueri aplikasi, dan hapus tabel fisik hanya setelah masa transisi selesai.'
  },
  {
    id: 'DROP_COLUMN',
    name: 'Drop Column Statement',
    riskLevel: RiskLevel.CRITICAL,
    lockMode: 'ACCESS_EXCLUSIVE',
    dialect: 'generic',
    description: 'DROP COLUMN memerlukan ACCESS EXCLUSIVE LOCK dan langsung merusak aplikasi versi aktif yang masih mencoba membaca atau menulis kolom tersebut selama deployment bertahap.',
    regex: /\bALTER\s+TABLE\s+(?:ONLY\s+)?([`"']?[\w.]+[`"']?)\s+DROP\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)/i,
    recommendationTemplate: 'Terapkan pola Expand and Contract: hentikan pembacaan dan penulisan kolom pada kode aplikasi terlebih dahulu sebelum menghapus kolom fisik dari skema.'
  },
  {
    id: 'ALTER_COLUMN_TYPE',
    name: 'Alter Column Type',
    riskLevel: RiskLevel.CRITICAL,
    lockMode: 'ACCESS_EXCLUSIVE',
    dialect: 'generic',
    description: 'ALTER COLUMN TYPE memicu penulisan ulang tabel (table rewrite) dan ACCESS EXCLUSIVE LOCK penuh selama proses konversi baris berlangsung pada tabel berukuran besar.',
    regex: /\bALTER\s+TABLE\s+(?:ONLY\s+)?([`"']?[\w.]+[`"']?)\s+ALTER\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)\s+(?:SET\s+DATA\s+)?TYPE\s+([^;]+)/i,
    recommendationTemplate: 'Buat kolom baru dengan tipe data target, lakukan replikasi data ganda (dual-writing), lakukan backfill bertahap dalam batch kecil, lalu alihkan pembacaan kueri.'
  },
  {
    id: 'RENAME_COLUMN',
    name: 'Rename Column Statement',
    riskLevel: RiskLevel.CRITICAL,
    lockMode: 'ACCESS_EXCLUSIVE',
    dialect: 'generic',
    description: 'RENAME COLUMN membutuhkan ACCESS EXCLUSIVE LOCK dan secara instan merusak kueri INSERT/SELECT pada pod/instance aplikasi yang belum diperbarui.',
    regex: /\bALTER\s+TABLE\s+(?:ONLY\s+)?([`"']?[\w.]+[`"']?)\s+RENAME\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)\s+TO\s+([`"']?[\w]+[`"']?)/i,
    recommendationTemplate: 'Tambahkan kolom baru dengan nama baru, sinkronkan data dua arah via kode aplikasi atau trigger, lalu hapus kolom lama pada rilis aplikasi berikutnya.'
  },
  {
    id: 'ADD_NOT_NULL_WITHOUT_DEFAULT',
    name: 'Add Not Null Column Without Default',
    riskLevel: RiskLevel.CRITICAL,
    lockMode: 'ACCESS_EXCLUSIVE',
    dialect: 'generic',
    description: 'Menambahkan kolom NOT NULL tanpa nilai DEFAULT akan menggagalkan seluruh perintah penulisan (INSERT) dari aplikasi versi lama yang belum menyediakan payload kolom baru.',
    regex: /\bALTER\s+TABLE\s+(?:ONLY\s+)?([`"']?[\w.]+[`"']?)\s+ADD\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)\s+[^;]+?\bNOT\s+NULL(?!\s+DEFAULT)\b/i,
    recommendationTemplate: 'Tambahkan kolom sebagai nullable terlebih dahulu atau sertakan klausa DEFAULT yang valid, lalu berlakukan batasan NOT NULL setelah seluruh data terisi.'
  },
  {
    id: 'CREATE_INDEX_NON_CONCURRENTLY',
    name: 'Non-concurrent Index Creation',
    riskLevel: RiskLevel.WARNING,
    lockMode: 'SHARE',
    dialect: 'postgresql',
    description: 'Pembuatan indeks tanpa klausa CONCURRENTLY mengakuisisi SHARE LOCK di PostgreSQL, menahan operasi tulis (INSERT/UPDATE/DELETE) pada tabel selama indeks dikonstruksi.',
    regex: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY\b)(?:IF\s+NOT\s+EXISTS\s+)?([`"']?[\w]+[`"']?)\s+ON\s+([`"']?[\w.]+[`"']?)/i,
    recommendationTemplate: 'Gunakan klausa CONCURRENTLY (pada PostgreSQL) atau ALGORITHM=INPLACE, LOCK=NONE (pada MySQL) untuk mencegah penguncian tabel di lingkungan produksi.'
  },
  {
    id: 'RENAME_TABLE',
    name: 'Rename Table Statement',
    riskLevel: RiskLevel.CRITICAL,
    lockMode: 'ACCESS_EXCLUSIVE',
    dialect: 'generic',
    description: 'Mengubah nama tabel secara langsung membutuhkan ACCESS EXCLUSIVE LOCK dan langsung merusak semua kueri aplikasi yang mengacu pada nama tabel lama.',
    regex: /\bALTER\s+TABLE\s+(?:ONLY\s+)?([`"']?[\w.]+[`"']?)\s+RENAME\s+TO\s+([`"']?[\w.]+[`"']?)/i,
    recommendationTemplate: 'Gunakan VIEW atau sinonim skema sebagai jembatan kompatibilitas sebelum tabel lama dihapus secara permanen.'
  },
  {
    id: 'ADD_COLUMN_WITH_DEFAULT',
    name: 'Add Column With Volatile Default',
    riskLevel: RiskLevel.WARNING,
    lockMode: 'ACCESS_EXCLUSIVE',
    dialect: 'postgresql',
    description: 'Menambahkan kolom dengan nilai default volatile (seperti now(), random()) memicu table rewrite dan lock eksklusif karena setiap baris harus dihitung ulang.',
    regex: /\bALTER\s+TABLE\s+(?:ONLY\s+)?([`"']?[\w.]+[`"']?)\s+ADD\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)\s+[^;]+?\bDEFAULT\s+(?:now\(\)|clock_timestamp\(\)|random\(\))/i,
    recommendationTemplate: 'Gunakan nilai DEFAULT konstan atau tambahkan kolom sebagai NULLABLE, kemudian lakukan backfill bertahap dalam batch kecil untuk menghindari saturasi I/O.'
  },
  {
    id: 'VALIDATE_CONSTRAINT',
    name: 'Add Constraint Without Not Valid',
    riskLevel: RiskLevel.WARNING,
    lockMode: 'SHARE_ROW_EXCLUSIVE',
    dialect: 'postgresql',
    description: 'Menambahkan CHECK atau FOREIGN KEY constraint tanpa klausa NOT VALID memicu pemindaian tabel penuh yang menahan operasi tulis konkuren.',
    regex: /\bALTER\s+TABLE\s+(?:ONLY\s+)?([`"']?[\w.]+[`"']?)\s+ADD\s+CONSTRAINT\s+([`"']?[\w]+[`"']?)\s+(?:CHECK|FOREIGN\s+KEY)(?!.*?\bNOT\s+VALID\b)[^;]+/i,
    recommendationTemplate: 'Tambahkan constraint menggunakan klausul NOT VALID terlebih dahulu, kemudian validasi tabel secara terpisah dengan ALTER TABLE ... VALIDATE CONSTRAINT.'
  }
];

/**
 * Mendapatkan seluruh daftar aturan anti-pola SQL
 */
export function getSqlRules(): SqlRule[] {
  return [...SQL_RULES];
}

/**
 * Mencari definisi aturan berdasarkan ID
 */
export function findSqlRuleById(id: string): SqlRule | undefined {
  return SQL_RULES.find((rule) => rule.id === id);
}

/**
 * Mendapatkan aturan yang relevan berdasarkan dialek basis data
 */
export function getRulesByDialect(dialect: DatabaseDialect): SqlRule[] {
  return SQL_RULES.filter((rule) => rule.dialect === 'generic' || rule.dialect === dialect);
}

/**
 * Mendapatkan aturan yang memiliki tingkat risiko tertentu
 */
export function getRulesByRiskLevel(level: RiskLevel): SqlRule[] {
  return SQL_RULES.filter((rule) => rule.riskLevel === level);
}
