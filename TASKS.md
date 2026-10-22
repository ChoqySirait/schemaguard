# Daftar Tugas Pengembangan SchemaGuard

Setiap tugas wajib diselesaikan dengan pola:
1. Kerjakan atau modifikasi satu berkas sesuai nomor tugas.
2. Jalankan perintah komit Git atomik di terminal sesuai konvensi pesan.
3. Centang `[x]` pada nomor tugas yang bersangkutan.

---

### Fase 1: Inisialisasi Proyek dan Kerangka CLI
- [ ] **Tugas 1.1**: Inisialisasi konfigurasi proyek (`package.json` / dependensi parser).
  - *Komit*: `chore(proyek): inisialisasi package.json dan dependensi awal`
- [ ] **Tugas 1.2**: Konfigurasi TypeScript dan linter (`tsconfig.json`).
  - *Komit*: `chore(konfigurasi): menambahkan konfigurasi tsconfig`
- [ ] **Tugas 1.3**: Tipe data dasar hasil analisis skema dan kontrak (`src/types/index.ts`).
  - *Komit*: `feat(tipe): mendefinisikan tipe data hasil analisis risiko`
- [ ] **Tugas 1.4**: Titik masuk CLI utama dan parsing argumen (`src/index.ts`).
  - *Komit*: `feat(cli): menambahkan antarmuka baris perintah dasar`

---

### Fase 2: Mesin Analisis Migrasi Basis Data (SQL)
- [ ] **Tugas 2.1**: Definisi aturan anti-pola skema SQL (`src/rules/sqlRules.ts`).
  - *Komit*: `feat(aturan): menyusun daftar aturan perubahan berbahaya sql`
- [ ] **Tugas 2.2**: Parser statis berkas migrasi SQL (`src/analyzer/sqlParser.ts`).
  - *Komit*: `feat(parser): mengimplementasikan parser berkas sql statis`
- [ ] **Tugas 2.3**: Mesin pendeteksi pelanggaran skema SQL (`src/analyzer/sqlDiff.ts`).
  - *Komit*: `feat(analisis): membangun mesin pendeteksi breaking change basis data`
- [ ] **Tugas 2.4**: Pengujian unit untuk analisis migrasi basis data (`tests/sqlDiff.test.ts`).
  - *Komit*: `test(sql): menambahkan unit test deteksi perubahan skema`

---

### Fase 3: Mesin Kompatibilitas Kontrak API (OpenAPI)
- [ ] **Tugas 3.1**: Parser berkas OpenAPI YAML/JSON (`src/analyzer/apiParser.ts`).
  - *Komit*: `feat(parser): menambahkan parser spesifikasi openapi`
- [ ] **Tugas 3.2**: Detektor pelanggaran kompatibilitas API (`src/analyzer/apiDiff.ts`).
  - *Komit*: `feat(analisis): mengimplementasikan deteksi breaking changes api`
- [ ] **Tugas 3.3**: Pengujian unit untuk kompatibilitas API (`tests/apiDiff.test.ts`).
  - *Komit*: `test(api): menambahkan unit test pemeriksaan kontrak openapi`

---

### Fase 4: Generator Mitigasi Migrasi Bertahap (Recommender)
- [ ] **Tugas 4.1**: Template logika pola Expand and Contract (`src/recommender/templates.ts`).
  - *Komit*: `feat(mitigasi): menambahkan template strategi migrasi tanpa downtime`
- [ ] **Tugas 4.2**: Mesin penyusun rekomendasi skrip transisi (`src/recommender/engine.ts`).
  - *Komit*: `feat(mitigasi): membangun generator rekomendasi strategi aman`

---

### Fase 5: Pelaporan Terminal dan Integrasi GitHub Action
- [ ] **Tugas 5.1**: Formatter tabel keluaran terminal (`src/reporter/terminal.ts`).
  - *Komit*: `feat(pelaporan): membuat pemformat laporan tabel konsol terminal`
- [ ] **Tugas 5.2**: Formatter ringkasan Markdown untuk PR GitHub (`src/reporter/markdown.ts`).
  - *Komit*: `feat(pelaporan): menambahkan pembuat laporan komentar pull request`
- [ ] **Tugas 5.3**: Definisi metadata GitHub Action (`action.yml`).
  - *Komit*: `chore(ci): mendefinisikan konfigurasi github action`
- [ ] **Tugas 5.4**: Dokumentasi lengkap penggunaan dan diagram alur (`README.md`).
  - *Komit*: `docs(readme): merilis dokumentasi lengkap penggunaan schemaguard`