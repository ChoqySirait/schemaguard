# Rencana Implementasi SchemaGuard

Aturan Pengerjaan:
- Kerjakan satu berkas per tugas.
- Jalankan komit Git atomik di terminal setelah berkas selesai dibuat/dimodifikasi.
- Tandai status [x] pada daftar periksa ini.

### Fase 1: Pemodelan Tipe Data & Aturan Penguncian
- [x] **Tugas 1.1**: Definisi tipe audit skema, kontrak API, dan laporan visual (`src/types/index.ts`).
  - *Komit*: `feat(tipe): mendefinisikan struktur data audit migrasi dan kontrak api`
- [x] **Tugas 1.2**: Katalog aturan penguncian DDL PostgreSQL dan MySQL (`src/rules/sqlRules.ts`).
  - *Komit*: `feat(aturan): menyusun daftar aturan mitigasi lock contention ddl`

### Fase 2: Analisis Statis Migrasi SQL
- [x] **Tugas 2.1**: Parser berkas DDL SQL untuk ekstraksi operasi tabel (`src/analyzer/sqlParser.ts`).
  - *Komit*: `feat(parser): menambahkan parser berkas migrasi ddl sql`
- [x] **Tugas 2.2**: Mesin pemeriksa anomali penguncian tabel (`src/analyzer/sqlDiff.ts`).
  - *Komit*: `feat(analisis): mengimplementasikan deteksi access exclusive lock`
- [x] **Tugas 2.3**: Pengujian unit audit DDL SQL (`tests/sqlDiff.test.ts`).
  - *Komit*: `test(sql): menambahkan unit test validasi aturan migrasi berbahaya`

### Fase 3: Deteksi Breaking Changes OpenAPI
- [x] **Tugas 3.1**: Parser spesifikasi OpenAPI format JSON/YAML (`src/analyzer/apiParser.ts`).
  - *Komit*: `feat(parser): menyusun parser spesifikasi openapi`
- [x] **Tugas 3.2**: Mesin pembanding kompatibilitas kontrak API (`src/analyzer/apiDiff.ts`).
  - *Komit*: `feat(analisis): membangun deteksi breaking changes endpoint api`
- [x] **Tugas 3.3**: Pemetaan dampak perubahan kolom SQL ke endpoint API (`src/analyzer/crossImpact.ts`).
  - *Komit*: `feat(analisis): memetakan keterkaitan kolom sql terhadap rute api`
- [x] **Tugas 3.4**: Pengujian unit kompatibilitas API (`tests/apiDiff.test.ts`).
  - *Komit*: `test(api): menambahkan pengujian unit deteksi pemutusan kontrak api`

### Fase 4: Template Migrasi Aman (Expand-Contract)
- [x] **Tugas 4.1**: Generator skrip transisi migrasi Expand-Contract (`src/recommender/expandContract.ts`).
  - *Komit*: `feat(mitigasi): menambahkan generator template pola expand and contract`
- [x] **Tugas 4.2**: Pengujian unit generator mitigasi migrasi (`tests/recommender.test.ts`).
  - *Komit*: `test(mitigasi): memvalidasi hasil pembuatan skrip migrasi bertahap`

### Fase 5: Generator Laporan Web HTML & Antarmuka CLI
- [ ] **Tugas 5.1**: Template generator dasbor HTML statis mandiri (`src/reporter/htmlReport.ts`).
  - *Komit*: `feat(pelaporan): membangun generator laporan web visual statis`
- [ ] **Tugas 5.2**: Pemformat ringkasan terminal dan Markdown PR (`src/reporter/terminal.ts`).
  - *Komit*: `feat(pelaporan): menambahkan format keluaran tabel konsol terminal`
- [ ] **Tugas 5.3**: Penggabungan perintah CLI dan opsi eksekusi (`src/index.ts`).
  - *Komit*: `feat(cli): menghubungkan seluruh alur audit ke antarmuka cli`
- [ ] **Tugas 5.4**: Dokumentasi lengkap README berbasis studi kasus industri (`README.md`).
  - *Komit*: `docs(readme): merilis dokumentasi berbasis referensi teknis industri`
