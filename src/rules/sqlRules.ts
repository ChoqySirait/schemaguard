/**
 * Aturan Anti-Pola Perubahan Skema Basis Data SQL
 * Mendefinisikan pola-pola sintaksis berbahaya yang dapat menyebabkan kegagalan sistem,
 * penguncian tabel eksklusif (table lock), atau hilangnya data di lingkungan produksi.
 */

import { RiskLevel, SqlRule } from '../types';

export const SQL_RULES: SqlRule[] = [
  {
    id: 'DROP_TABLE',
    name: 'Drop Table Statement',
    riskLevel: RiskLevel.CRITICAL,
    description: 'Menghapus tabel secara permanen yang menyebabkan hilangnya data dan kegagalan aplikasi aktif.',
    regex: /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([`"']?[\w.]+[`"']?)/i,
    recommendationTemplate: 'Hindari menghapus tabel langsung di produksi. Gunakan strategi pengarsipan atau deprecation bertahap.'
  },
  {
    id: 'DROP_COLUMN',
    name: 'Drop Column Statement',
    riskLevel: RiskLevel.CRITICAL,
    description: 'Menghapus kolom yang masih berpotensi diakses atau ditulis oleh versi aplikasi yang sedang aktif.',
    regex: /\bALTER\s+TABLE\s+(?:ONLY\s+)?([`"']?[\w.]+[`"']?)\s+DROP\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)/i,
    recommendationTemplate: 'Terapkan pola Expand and Contract: berhenti membaca/menulis kolom pada kode aplikasi terlebih dahulu sebelum menghapus kolom pada skema.'
  },
  {
    id: 'ALTER_COLUMN_TYPE',
    name: 'Alter Column Type',
    riskLevel: RiskLevel.CRITICAL,
    description: 'Mengubah tipe data kolom yang dapat menyebabkan kegagalan konversi data dan penguncian tabel penuh.',
    regex: /\bALTER\s+TABLE\s+(?:ONLY\s+)?([`"']?[\w.]+[`"']?)\s+ALTER\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)\s+(?:SET\s+DATA\s+)?TYPE\s+([^;,]+)/i,
    recommendationTemplate: 'Buat kolom baru dengan tipe data target, lakukan replikasi data ganda (dual-writing), lalu lakukan migrasi data bertahap.'
  },
  {
    id: 'RENAME_COLUMN',
    name: 'Rename Column Statement',
    riskLevel: RiskLevel.CRITICAL,
    description: 'Mengubah nama kolom secara langsung merusak backward compatibility bagi layanan yang belum diperbarui.',
    regex: /\bALTER\s+TABLE\s+(?:ONLY\s+)?([`"']?[\w.]+[`"']?)\s+RENAME\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)\s+TO\s+([`"']?[\w]+[`"']?)/i,
    recommendationTemplate: 'Tambahkan kolom baru dengan nama baru, sinkronkan data dengan trigger/kode aplikasi, lalu hapus kolom lama pada rilis berikutnya.'
  },
  {
    id: 'ADD_NOT_NULL_WITHOUT_DEFAULT',
    name: 'Add Not Null Column Without Default',
    riskLevel: RiskLevel.CRITICAL,
    description: 'Menambahkan kolom NOT NULL tanpa nilai default akan menggagalkan penulisan data dari aplikasi versi lama.',
    regex: /\bALTER\s+TABLE\s+(?:ONLY\s+)?([`"']?[\w.]+[`"']?)\s+ADD\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)\s+[^;]+?\bNOT\s+NULL(?!\s+DEFAULT)\b/i,
    recommendationTemplate: 'Tambahkan kolom baru sebagai nullable terlebih dahulu atau sertakan nilai DEFAULT yang valid.'
  },
  {
    id: 'CREATE_INDEX_NON_CONCURRENTLY',
    name: 'Non-concurrent Index Creation',
    riskLevel: RiskLevel.WARNING,
    description: 'Pembuatan indeks tanpa mode CONCURRENTLY dapat mengunci operasi tulis pada tabel besar selama proses indeks berjalan.',
    regex: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY\b)(?:IF\s+NOT\s+EXISTS\s+)?([`"']?[\w]+[`"']?)\s+ON\s+([`"']?[\w.]+[`"']?)/i,
    recommendationTemplate: 'Gunakan klausa CONCURRENTLY (pada PostgreSQL) saat membuat indeks untuk mencegah penguncian tabel (table locking).'
  },
  {
    id: 'RENAME_TABLE',
    name: 'Rename Table Statement',
    riskLevel: RiskLevel.CRITICAL,
    description: 'Mengubah nama tabel secara langsung akan merusak semua kueri yang belum disesuaikan.',
    regex: /\bALTER\s+TABLE\s+(?:ONLY\s+)?([`"']?[\w.]+[`"']?)\s+RENAME\s+TO\s+([`"']?[\w.]+[`"']?)/i,
    recommendationTemplate: 'Gunakan VIEW atau sinonim skema sebagai jembatan kompatibilitas sebelum tabel lama dihapus.'
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
