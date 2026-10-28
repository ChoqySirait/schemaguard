/**
 * Generator Skrip Transisi Pola Expand and Contract (Zero-Downtime Migration Engine)
 * Menghasilkan skrip SQL dua fase (Expand & Contract) dan rekomendasi transisi
 * untuk memitigasi AccessExclusiveLock, Metadata Lock, dan breaking changes API.
 *
 * Referensi Praktik Rekayasa:
 * - Martin Fowler (Expand and Contract Pattern / Parallel Change):
 *   https://martinfowler.com/bliki/ParallelChange.html
 * - Stripe Online Migrations at Scale:
 *   https://stripe.com/blog/online-migrations
 */

import {
  ApiIssue,
  DatabaseIssue,
  MigrationPhase,
  MigrationRecommendation,
  RiskLevel
} from '../types';

export interface ColumnContext {
  table: string;
  column: string;
  oldColumn?: string;
  newColumn?: string;
  dataType?: string;
  newDataType?: string;
  defaultValue?: string;
}

export interface TableContext {
  table: string;
  newTable?: string;
}

export interface IndexContext {
  indexName: string;
  table: string;
  columns?: string;
}

export interface ConstraintContext {
  table: string;
  constraintName: string;
  constraintType?: string;
  definition?: string;
}

export interface ApiContext {
  path: string;
  method?: string;
  paramName?: string;
  details?: string;
}

/**
 * Ekstraksi tipe data dari ALTER COLUMN TYPE
 */
export function extractAlterTypeDetails(statement: string): { newDataType?: string } {
  const match = statement.match(
    /\bALTER\s+(?:COLUMN\s+)?(?:[`"']?[\w]+[`"']?)\s+(?:SET\s+DATA\s+)?TYPE\s+([^;]+)/i
  );
  if (match) {
    return { newDataType: match[1].trim() };
  }
  return {};
}

/**
 * Ekstraksi nama kolom lama dan baru dari RENAME COLUMN
 */
export function extractRenameColumnDetails(
  statement: string
): { oldColumn?: string; newColumn?: string } {
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
 * Ekstraksi nama tabel baru dari RENAME TO
 */
export function extractRenameTableDetails(statement: string): { newTable?: string } {
  const match = statement.match(/\bRENAME\s+TO\s+([`"']?[\w.]+[`"']?)/i);
  if (match) {
    return { newTable: match[1].replace(/[`"']/g, '') };
  }
  return {};
}

/**
 * Ekstraksi nama indeks dan kolom dari CREATE INDEX
 */
export function extractIndexDetails(statement: string): { indexName?: string; columns?: string } {
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
 * Ekstraksi tipe data dari ADD COLUMN ... NOT NULL
 */
export function extractAddColumnDetails(statement: string): { dataType?: string } {
  const match = statement.match(
    /\bADD\s+(?:COLUMN\s+)?(?:[`"']?[\w]+[`"']?)\s+([A-Za-z0-9_()]+)/i
  );
  if (match) {
    return { dataType: match[1].trim() };
  }
  return {};
}

/**
 * Template: DROP TABLE
 */
export function createDropTableRecommendation(ctx: TableContext): MigrationRecommendation {
  const table = ctx.table || 'nama_tabel';
  const archiveTable = `${table}_archived_backup`;

  const expandPhase: MigrationPhase = {
    phase: 1,
    title: 'Fase Perluas (Expand): Pengarsipan dan Penandaan Deprecated',
    description: `Jangan langsung menghapus tabel '${table}'. Buat salinan arsip atau alihkan ketergantungan tanpa mengganggu kueri aktif.`,
    script: [
      `-- Langkah 1: Buat tabel arsip jika data historis masih diperlukan`,
      `CREATE TABLE IF NOT EXISTS ${archiveTable} AS SELECT * FROM ${table};`,
      `-- Langkah 2: Berikan komentar skema sebagai penanda deprecation`,
      `COMMENT ON TABLE ${table} IS 'DEPRECATED: Tabel ini dijadwalkan untuk dihapus. Jangan gunakan pada fitur baru.';`
    ].join('\n')
  };

  const contractPhase: MigrationPhase = {
    phase: 2,
    title: 'Fase Susutkan (Contract): Penghapusan Aman Setelah Pembersihan Kueri',
    description: `Setelah seluruh layanan aplikasi berhenti mengakses tabel '${table}', lakukan penghapusan permanen.`,
    script: [
      `-- Verifikasi tidak ada koneksi aktif atau foreign key yang mengarah ke tabel ini`,
      `DROP TABLE IF EXISTS ${table} CASCADE;`
    ].join('\n')
  };

  return {
    issueId: 'DROP_TABLE',
    title: `Mitigasi Zero-Downtime untuk DROP TABLE '${table}'`,
    target: table,
    description: `Menghapus tabel '${table}' secara langsung berisiko fatal jika masih ada replika, kueri analitik, atau layanan mikro lama yang membacanya.`,
    expandPhase,
    contractPhase,
    transitionNotes: [
      `Pastikan seluruh layanan backend telah menghapus referensi entitas / model '${table}'.`,
      `Periksa log kueri basis data untuk memastikan frekuensi akses ke '${table}' telah mencapai 0 RPS selama minimal 7 hari.`,
      `Hapus ketergantungan foreign key atau view yang mengikat '${table}' sebelum fase contract dijalankan.`
    ]
  };
}

/**
 * Template: DROP COLUMN
 */
export function createDropColumnRecommendation(ctx: ColumnContext): MigrationRecommendation {
  const table = ctx.table || 'nama_tabel';
  const column = ctx.column || 'nama_kolom';

  const expandPhase: MigrationPhase = {
    phase: 1,
    title: 'Fase Perluas (Expand): Penghapusan Akses pada Lapisan Aplikasi',
    description: `Pertahankan kolom '${column}' pada skema fisik, namun hentikan seluruh akses pembacaan dan penulisan dari aplikasi.`,
    script: [
      `-- Pastikan kolom bersifat nullable agar aplikasi versi lama tidak gagal saat tidak mengisi kolom ini`,
      `ALTER TABLE ${table} ALTER COLUMN ${column} DROP NOT NULL;`,
      `COMMENT ON COLUMN ${table}.${column} IS 'DEPRECATED: Kolom tidak lagi digunakan oleh aplikasi aktif.';`
    ].join('\n')
  };

  const contractPhase: MigrationPhase = {
    phase: 2,
    title: 'Fase Susutkan (Contract): Penghapusan Kolom Fisik dari Skema',
    description: `Hapus kolom '${column}' setelah seluruh pod atau instance aplikasi versi baru berjalan penuh.`,
    script: [
      `-- Kolom aman dihapus karena kode produksi sudah 100% tidak lagi membaca atau menulis kolom ini`,
      `ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column};`
    ].join('\n')
  };

  return {
    issueId: 'DROP_COLUMN',
    title: `Mitigasi Zero-Downtime untuk DROP COLUMN '${table}.${column}'`,
    target: `${table}.${column}`,
    description: `Penghapusan kolom '${column}' langsung akan memicu galat runtime kueri (e.g. SELECT * atau INSERT eksplisit) pada aplikasi versi sebelumnya yang masih beroperasi.`,
    expandPhase,
    contractPhase,
    transitionNotes: [
      `Rilis v1: Modifikasi kode aplikasi agar tidak menyertakan kolom '${column}' dalam skema ORM, SELECT, atau INSERT.`,
      `Lakukan deployment kode v1 hingga 100% armada server selesai diperbarui.`,
      `Rilis v2: Eksekusi skrip fase Contract pada skema basis data.`
    ]
  };
}

/**
 * Template: ALTER COLUMN TYPE
 */
export function createAlterColumnTypeRecommendation(ctx: ColumnContext): MigrationRecommendation {
  const table = ctx.table || 'nama_tabel';
  const column = ctx.column || 'nama_kolom';
  const newType = ctx.newDataType || 'TIPE_BARU';
  const shadowCol = `${column}_new`;

  const expandPhase: MigrationPhase = {
    phase: 1,
    title: 'Fase Perluas (Expand): Tambah Kolom Baru dan Sinkronisasi Data Ganda',
    description: `Tambahkan kolom '${shadowCol}' dengan tipe '${newType}', lakukan backfill data historis, dan aktifkan dual-write.`,
    script: [
      `-- Langkah 1: Tambahkan kolom baru dengan tipe target`,
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${shadowCol} ${newType};`,
      ``,
      `-- Langkah 2: Backfill data bertahap dari kolom lama ke kolom baru`,
      `UPDATE ${table} SET ${shadowCol} = CAST(${column} AS ${newType}) WHERE ${shadowCol} IS NULL;`,
      ``,
      `-- Langkah 3 (Opsi Database Trigger): Sinkronkan penulisan data baru secara otomatis`,
      `CREATE OR REPLACE FUNCTION sync_${table}_${column}() RETURNS TRIGGER AS $$`,
      `BEGIN`,
      `  NEW.${shadowCol} := CAST(NEW.${column} AS ${newType});`,
      `  RETURN NEW;`,
      `END;`,
      `$$ LANGUAGE plpgsql;`,
      ``,
      `CREATE OR REPLACE TRIGGER trg_sync_${table}_${column}`,
      `BEFORE INSERT OR UPDATE ON ${table}`,
      `FOR EACH ROW EXECUTE FUNCTION sync_${table}_${column}();`
    ].join('\n')
  };

  const contractPhase: MigrationPhase = {
    phase: 2,
    title: 'Fase Susutkan (Contract): Alihkan Pembacaan, Hapus Kolom Lama, dan Ganti Nama',
    description: `Setelah seluruh aplikasi membaca '${shadowCol}', bersihkan trigger sinkronisasi dan ganti nama kolom menjadi nama asli.`,
    script: [
      `-- Langkah 1: Hapus trigger sinkronisasi`,
      `DROP TRIGGER IF EXISTS trg_sync_${table}_${column} ON ${table};`,
      `DROP FUNCTION IF EXISTS sync_${table}_${column}();`,
      ``,
      `-- Langkah 2: Hapus kolom lama`,
      `ALTER TABLE ${table} DROP COLUMN ${column};`,
      ``,
      `-- Langkah 3: Ganti nama kolom bayangan menjadi nama definitif`,
      `ALTER TABLE ${table} RENAME COLUMN ${shadowCol} TO ${column};`
    ].join('\n')
  };

  return {
    issueId: 'ALTER_COLUMN_TYPE',
    title: `Mitigasi Zero-Downtime untuk ALTER COLUMN TYPE '${table}.${column}' ke '${newType}'`,
    target: `${table}.${column}`,
    description: `Mengubah tipe data kolom secara langsung menyebabkan table lock eksklusif serta kegagalan konversi tipe instan pada baris berjumlah besar.`,
    expandPhase,
    contractPhase,
    transitionNotes: [
      `Terapkan aplikasi versi A: Mendukung penulisan ganda (dual-writing) ke '${column}' dan '${shadowCol}'.`,
      `Jalankan skrip migrasi backfill dalam batch kecil (misal: LIMIT 1000) untuk menghindari saturasi I/O basis data.`,
      `Terapkan aplikasi versi B: Alihkan pembacaan (reads) sepenuhnya ke '${shadowCol}'.`,
      `Jalankan skrip fase Contract untuk merapikan skema.`
    ]
  };
}

/**
 * Template: RENAME COLUMN
 */
export function createRenameColumnRecommendation(ctx: ColumnContext): MigrationRecommendation {
  const table = ctx.table || 'nama_tabel';
  const oldCol = ctx.oldColumn || ctx.column || 'kolom_lama';
  const newCol = ctx.newColumn || `${oldCol}_baru`;
  const dataType = ctx.dataType || 'TEXT';

  const expandPhase: MigrationPhase = {
    phase: 1,
    title: 'Fase Perluas (Expand): Tambah Kolom Baru dan Salin Data',
    description: `Tambahkan kolom '${newCol}' berdampingan dengan '${oldCol}' untuk menjaga kompatibilitas aplikasi lama dan baru.`,
    script: [
      `-- Langkah 1: Tambahkan kolom baru dengan nama target`,
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${newCol} ${dataType};`,
      ``,
      `-- Langkah 2: Salin data dari kolom lama`,
      `UPDATE ${table} SET ${newCol} = ${oldCol} WHERE ${newCol} IS NULL;`,
      ``,
      `-- Langkah 3: Buat sinkronisasi dua arah via trigger atau dual-write di kode aplikasi`,
      `CREATE OR REPLACE FUNCTION sync_rename_${table}_${oldCol}() RETURNS TRIGGER AS $$`,
      `BEGIN`,
      `  NEW.${newCol} := COALESCE(NEW.${newCol}, NEW.${oldCol});`,
      `  NEW.${oldCol} := COALESCE(NEW.${oldCol}, NEW.${newCol});`,
      `  RETURN NEW;`,
      `END;`,
      `$$ LANGUAGE plpgsql;`,
      ``,
      `CREATE OR REPLACE TRIGGER trg_rename_${table}_${oldCol}`,
      `BEFORE INSERT OR UPDATE ON ${table}`,
      `FOR EACH ROW EXECUTE FUNCTION sync_rename_${table}_${oldCol}();`
    ].join('\n')
  };

  const contractPhase: MigrationPhase = {
    phase: 2,
    title: 'Fase Susutkan (Contract): Hapus Sinkronisasi dan Hapus Kolom Lama',
    description: `Hapus kolom lama '${oldCol}' setelah semua aplikasi bermigrasi ke nama baru '${newCol}'.`,
    script: [
      `-- Langkah 1: Hapus trigger transisi`,
      `DROP TRIGGER IF EXISTS trg_rename_${table}_${oldCol} ON ${table};`,
      `DROP FUNCTION IF EXISTS sync_rename_${table}_${oldCol}();`,
      ``,
      `-- Langkah 2: Hapus kolom lama yang sudah tidak digunakan`,
      `ALTER TABLE ${table} DROP COLUMN IF EXISTS ${oldCol};`
    ].join('\n')
  };

  return {
    issueId: 'RENAME_COLUMN',
    title: `Mitigasi Zero-Downtime untuk RENAME COLUMN '${table}.${oldCol}' -> '${newCol}'`,
    target: `${table}.${oldCol}`,
    description: `Penggantian nama kolom instan akan langsung menggagalkan aplikasi versi aktif sebelum kode baru selesai diterapkan.`,
    expandPhase,
    contractPhase,
    transitionNotes: [
      `Versi Aplikasi 1: Menulis ke kedua kolom, membaca dari kolom lama.`,
      `Versi Aplikasi 2: Membaca dan menulis ke nama kolom baru.`,
      `Fase Contract: Hapus kolom lama dari basis data.`
    ]
  };
}

/**
 * Template: ADD NOT NULL WITHOUT DEFAULT
 */
export function createAddNotNullRecommendation(ctx: ColumnContext): MigrationRecommendation {
  const table = ctx.table || 'nama_tabel';
  const column = ctx.column || 'nama_kolom';
  const dataType = ctx.dataType || 'VARCHAR(255)';
  const defaultVal = ctx.defaultValue || "''";

  const expandPhase: MigrationPhase = {
    phase: 1,
    title: 'Fase Perluas (Expand): Tambah Kolom sebagai Nullable atau dengan DEFAULT',
    description: `Tambahkan kolom '${column}' sebagai nullable atau sertakan nilai DEFAULT yang tidak merusak aplikasi lama.`,
    script: [
      `-- Langkah 1: Tambahkan kolom dengan klausul DEFAULT yang aman`,
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${dataType} DEFAULT ${defaultVal};`,
      ``,
      `-- Langkah 2: Isi nilai bawaan untuk baris yang sudah ada jika belum terisi`,
      `UPDATE ${table} SET ${column} = ${defaultVal} WHERE ${column} IS NULL;`
    ].join('\n')
  };

  const contractPhase: MigrationPhase = {
    phase: 2,
    title: 'Fase Susutkan (Contract): Kunci Batasan NOT NULL Tanpa Tabel Lock Penuh',
    description: `Terapkan batasan NOT NULL secara aman setelah seluruh baris terbukti memiliki nilai valid.`,
    script: [
      `-- Terapkan batasan NOT NULL setelah seluruh data terverifikasi`,
      `ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL;`
    ].join('\n')
  };

  return {
    issueId: 'ADD_NOT_NULL_WITHOUT_DEFAULT',
    title: `Mitigasi Zero-Downtime untuk ADD NOT NULL '${table}.${column}'`,
    target: `${table}.${column}`,
    description: `Menambahkan kolom NOT NULL tanpa nilai default akan menggagalkan seluruh perintah INSERT dari aplikasi versi lama yang belum mengenal kolom baru tersebut.`,
    expandPhase,
    contractPhase,
    transitionNotes: [
      `Selalu definisikan nilai DEFAULT yang bermakna bisnis (misalnya false untuk boolean, 0 untuk angka, atau '' untuk teks).`,
      `Pastikan aplikasi telah merilis model yang secara eksplisit mengisi kolom '${column}'.`,
      `Jalankan penetapan batasan NOT NULL setelah memastikan tidak ada data bernilai NULL tersisa.`
    ]
  };
}

/**
 * Template: CREATE INDEX NON-CONCURRENTLY
 */
export function createIndexRecommendation(ctx: IndexContext): MigrationRecommendation {
  const indexName = ctx.indexName || 'idx_nama_indeks';
  const table = ctx.table || 'nama_tabel';
  const columns = ctx.columns || 'nama_kolom';

  const expandPhase: MigrationPhase = {
    phase: 1,
    title: 'Fase Perluas (Expand): Buat Indeks Menggunakan Mode Non-Pemblokiran (CONCURRENTLY)',
    description: `Gunakan instruksi CONCURRENTLY agar proses pengindeksan tidak mengunci operasi INSERT/UPDATE/DELETE pada tabel.`,
    script: [
      `-- Buat indeks di luar blok transaksi (PostgreSQL CONCURRENTLY)`,
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName} ON ${table} (${columns});`
    ].join('\n')
  };

  const contractPhase: MigrationPhase = {
    phase: 2,
    title: 'Fase Susutkan (Contract): Verifikasi Status Keabsahan Indeks',
    description: `Pastikan indeks berhasil dibuat dengan status valid dan siap digunakan oleh perencana kueri.`,
    script: [
      `-- Periksa apakah indeks berstatus valid (PostgreSQL)`,
      `SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid = '${indexName}'::regclass;`,
      `-- Jika indisvalid bernilai false, jalankan: REINDEX INDEX CONCURRENTLY ${indexName};`
    ].join('\n')
  };

  return {
    issueId: 'CREATE_INDEX_NON_CONCURRENTLY',
    title: `Mitigasi Pembuatan Indeks Tanpa Kunci untuk '${indexName}' pada '${table}'`,
    target: `${table} (${indexName})`,
    description: `Pembuatan indeks standar mengunci tabel untuk operasi tulis sampai proses indeks selesai, memicu lonjakan latensi atau timeout di produksi.`,
    expandPhase,
    contractPhase,
    transitionNotes: [
      `Eksekusi pembuatan indeks CONCURRENTLY harus dijalankan di luar blok transaksi tunggal (autocommit aktif).`,
      `Pantau metrik CPU dan Disk I/O selama proses pembuatan indeks berjalan.`,
      `Jika pembuatan indeks dibatalkan di tengah jalan, bersihkan indeks tidak valid sebelum mencoba kembali.`
    ]
  };
}

/**
 * Template: RENAME TABLE
 */
export function createRenameTableRecommendation(ctx: TableContext): MigrationRecommendation {
  const oldTable = ctx.table || 'tabel_lama';
  const newTable = ctx.newTable || `${oldTable}_v2`;

  const expandPhase: MigrationPhase = {
    phase: 1,
    title: 'Fase Perluas (Expand): Buat VIEW atau Alias Jembatan',
    description: `Ganti nama tabel fisik dan pertahankan VIEW dengan nama lama agar aplikasi versi lama tetap dapat membacanya.`,
    script: [
      `-- Langkah 1: Ganti nama tabel fisik`,
      `ALTER TABLE ${oldTable} RENAME TO ${newTable};`,
      ``,
      `-- Langkah 2: Buat VIEW dengan nama lama mengarah ke nama baru`,
      `CREATE VIEW ${oldTable} AS SELECT * FROM ${newTable};`
    ].join('\n')
  };

  const contractPhase: MigrationPhase = {
    phase: 2,
    title: 'Fase Susutkan (Contract): Hapus VIEW Jembatan Transisi',
    description: `Hapus VIEW '${oldTable}' setelah seluruh aplikasi dan kueri analitik bermigrasi ke tabel '${newTable}'.`,
    script: [`DROP VIEW IF EXISTS ${oldTable};`].join('\n')
  };

  return {
    issueId: 'RENAME_TABLE',
    title: `Mitigasi Zero-Downtime untuk RENAME TABLE '${oldTable}' -> '${newTable}'`,
    target: oldTable,
    description: `Mengubah nama tabel secara langsung memutus semua koneksi kueri aktif yang mengacu pada nama tabel lama.`,
    expandPhase,
    contractPhase,
    transitionNotes: [
      `VIEW jembatan mendukung operasi SELECT langsung, namun jika aplikasi lama melakukan INSERT/UPDATE/DELETE, pastikan INSTEAD OF trigger ditambahkan pada VIEW.`,
      `Perbarui referensi di seluruh konfigurasi microservice.`,
      `Hapus VIEW jembatan pada rilis stabil berikutnya.`
    ]
  };
}

/**
 * Template: ADD COLUMN WITH DEFAULT (Volatile Default)
 */
export function createAddColumnWithDefaultRecommendation(
  ctx: ColumnContext
): MigrationRecommendation {
  const table = ctx.table || 'nama_tabel';
  const column = ctx.column || 'nama_kolom';
  const dataType = ctx.dataType || 'TIMESTAMP';

  const expandPhase: MigrationPhase = {
    phase: 1,
    title: 'Fase Perluas (Expand): Tambah Kolom sebagai Nullable dan Backfill Bertahap',
    description: `Tambahkan kolom '${column}' sebagai NULLABLE terlebih dahulu tanpa volatile DEFAULT untuk menghindari table rewrite dan AccessExclusiveLock panjang.`,
    script: [
      `-- Langkah 1: Tambahkan kolom baru tanpa volatile default`,
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${dataType} NULL;`,
      ``,
      `-- Langkah 2: Backfill data dalam batch kecil di luar jam sibuk`,
      `UPDATE ${table} SET ${column} = now() WHERE ${column} IS NULL;`
    ].join('\n')
  };

  const contractPhase: MigrationPhase = {
    phase: 2,
    title: 'Fase Susutkan (Contract): Tetapkan Nilai Default untuk Baris Baru',
    description: `Terapkan DEFAULT clause untuk baris mendatang setelah seluruh baris historis terisi.`,
    script: [`ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT now();`].join('\n')
  };

  return {
    issueId: 'ADD_COLUMN_WITH_DEFAULT',
    title: `Mitigasi Volatile Default untuk '${table}.${column}'`,
    target: `${table}.${column}`,
    description: `Menambahkan kolom dengan nilai default dinamis (seperti now() atau random()) memicu penulisan ulang tabel penuh di PostgreSQL.`,
    expandPhase,
    contractPhase,
    transitionNotes: [
      `Gunakan batch backfill berukuran kecil (LIMIT 1000-5000) agar tidak menahan transaksi konkurensi.`,
      `Terapkan default clause hanya untuk kueri INSERT mendatang.`
    ]
  };
}

/**
 * Template: VALIDATE CONSTRAINT (NOT VALID)
 */
export function createValidateConstraintRecommendation(
  ctx: ConstraintContext
): MigrationRecommendation {
  const table = ctx.table || 'nama_tabel';
  const constraint = ctx.constraintName || 'fk_nama_constraint';

  const expandPhase: MigrationPhase = {
    phase: 1,
    title: 'Fase Perluas (Expand): Tambahkan Batasan Menggunakan Klausa NOT VALID',
    description: `Tambahkan batasan relasi atau validasi dengan klausa NOT VALID agar PostgreSQL tidak memindai seluruh tabel saat memperoleh lock.`,
    script: [
      `-- Tambahkan batasan dengan flag NOT VALID (hanya memerlukan lock singkat)`,
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} ... NOT VALID;`
    ].join('\n')
  };

  const contractPhase: MigrationPhase = {
    phase: 2,
    title: 'Fase Susutkan (Contract): Validasi Batasan Secara Terpisah',
    description: `Jalankan validasi secara asinkron/terpisah tanpa memblokir penulisan konkuren.`,
    script: [`ALTER TABLE ${table} VALIDATE CONSTRAINT ${constraint};`].join('\n')
  };

  return {
    issueId: 'VALIDATE_CONSTRAINT',
    title: `Mitigasi Validasi Constraint Dua Tahap untuk '${table}.${constraint}'`,
    target: `${table}.${constraint}`,
    description: `Memvalidasi tabel penuh secara inline mengunci tabel dari operasi tulis konkuren (ShareRowExclusiveLock).`,
    expandPhase,
    contractPhase,
    transitionNotes: [
      `Klausa NOT VALID hanya memvalidasi baris data baru sejak constraint dibuat.`,
      `Langkah VALIDATE CONSTRAINT dapat dijalankan kapan saja di latar belakang tanpa menahan penulisan data.`
    ]
  };
}

/**
 * Template: API Breaking Changes
 */
export function createApiBreakingChangeRecommendation(
  ctx: ApiContext
): MigrationRecommendation {
  const endpoint = ctx.path || '/api/resource';
  const method = (ctx.method || 'ALL').toUpperCase();

  const expandPhase: MigrationPhase = {
    phase: 1,
    title: 'Fase Perluas (Expand): Dukungan Multiversi dan Header Deprecation',
    description: `Pertahankan endpoint dan skema lama berdampingan dengan endpoint baru (misal: /v2) dan kirimkan header Sunset.`,
    script: [
      `// Contoh konfigurasi gateway / router (Express / Fastify / Nginx):`,
      `// Tambahkan header deprecation pada rute ${method} ${endpoint}`,
      `response.setHeader('Deprecation', 'true');`,
      `response.setHeader('Sunset', new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString()); // 90 hari transisi`,
      `response.setHeader('Link', '<${endpoint}/v2>; rel="successor-version"');`
    ].join('\n')
  };

  const contractPhase: MigrationPhase = {
    phase: 2,
    title: 'Fase Susutkan (Contract): Penghentian (Sunset) Versi Lama',
    description: `Setelah periode masa tenggang (grace period) selesai dan trafik klien lama bernilai nol, nonaktifkan rute lama.`,
    script: [
      `// Hapus rute lama atau kembalikan respons 410 Gone`,
      `app.${(ctx.method || 'get').toLowerCase()}('${endpoint}', (req, res) => {`,
      `  res.status(410).json({ error: 'Endpoint ini telah ditutup permanen. Silakan gunakan versi v2.' });`,
      `});`
    ].join('\n')
  };

  return {
    issueId: 'API_BREAKING_CHANGE',
    title: `Strategi Migrasi Transisi API untuk ${method} ${endpoint}`,
    target: `${method} ${endpoint}`,
    description:
      ctx.details ||
      `Perubahan merusak pada kontrak API tanpa versi baru akan memutus integrasi klien web, seluler, atau pihak ketiga.`,
    expandPhase,
    contractPhase,
    transitionNotes: [
      `Kirimkan pemberitahuan ke pengembang konsumen API minimal 30-90 hari sebelum penutupan rute.`,
      `Pantau header User-Agent pada log request untuk mengidentifikasi klien mana yang masih memanggil versi lama.`,
      `Aktifkan respons 410 Gone sebelum menghapus rute secara total.`
    ]
  };
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

    case 'ADD_COLUMN_WITH_DEFAULT': {
      const ctx: ColumnContext = { table, column };
      return createAddColumnWithDefaultRecommendation(ctx);
    }

    case 'VALIDATE_CONSTRAINT': {
      const ctx: ConstraintContext = { table, constraintName: column || 'constraint_name' };
      return createValidateConstraintRecommendation(ctx);
    }

    default: {
      return {
        issueId: issue.ruleId,
        title: `Mitigasi Operasi Berisiko: ${issue.ruleName || issue.ruleId}`,
        target: table,
        description:
          issue.description || 'Operasi skema berpotensi mengunci tabel atau merusak konsistensi data.',
        expandPhase: {
          phase: 1,
          title: 'Fase Perluas (Expand): Analisis Dampak dan Penyiapan Lingkungan Transisi',
          description:
            'Uji eksekusi skema pada staging dengan volume data riil dan gunakan flag fitur (feature flags).',
          script: `-- Evaluasi kueri alternatif:\n-- ${issue.statement}`
        },
        contractPhase: {
          phase: 2,
          title: 'Fase Susutkan (Contract): Penerapan Skema Definitif',
          description:
            'Jalankan penerapan perubahan setelah trafik di luar jam sibuk (low-traffic maintenance window).',
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

