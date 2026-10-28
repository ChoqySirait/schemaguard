# 🛡️ SchemaGuard

> **Perkakas Evaluasi Statis Migrasi DDL (Lock Contention) dan Kompatibilitas Kontrak API (OpenAPI) dengan Rekomendasi Pola Expand-Contract.**

[![CI Quality Gate](https://github.com/ChoqySirait/schemaguard/actions/workflows/ci.yml/badge.svg)](https://github.com/ChoqySirait/schemaguard/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict%20Mode-blue.svg)](https://www.typescriptlang.org/)
[![Tests Coverage](https://img.shields.io/badge/Tests-56%20Passed-success.svg)](https://vitest.dev/)

---

## 📌 Latar Belakang Masalah Industri

Pada ekosistem rekayasa perangkat lunak berskala tinggi (*high-traffic systems*), pembaruan skema basis data dan kontrak API yang berjalan pada *Pull Request* sering kali lolos dari peninjauan kode manual (*code review*). Kelalaian ini menjadi penyebab utama dua insiden kritis di lingkungan produksi (*cascading outage*):

1. **Downtime Akibat Penguncian Eksklusif Tabel (*DDL Lock Contention*):**
   - Pernyataan DDL sederhana seperti `ALTER TABLE ... ALTER COLUMN TYPE`, `DROP COLUMN`, atau `ADD COLUMN ... NOT NULL` tanpa nilai bawaan mengakuisisi `AccessExclusiveLock` di PostgreSQL atau *Metadata Lock* (MDL) di MySQL.
   - Mode penguncian ini memblokir seluruh operasi baca (`SELECT`) dan tulis (`INSERT`, `UPDATE`, `DELETE`). Kueri baru tertahan dalam antrean, menghabiskan kolam koneksi (*connection pool*) dalam hitungan detik, dan melumpuhkan peladen aplikasi.
   - *Referensi*: [PostgreSQL Explicit Locking Documentation](https://www.postgresql.org/docs/current/explicit-locking.html).

2. **Pemutusan Kontrak API Diam-Diam (*Silent Breaking API Changes*):**
   - Modifikasi kolom basis data sering kali dilakukan tanpa menyadari bahwa properti tersebut terhubung langsung ke serialisasi JSON pada spesifikasi OpenAPI yang dikonsumsi oleh aplikasi web, seluler, atau layanan pihak ketiga.
   - *Solusi Standar Industri*: Menghindari *downtime* dengan menerapkan pola migrasi bertahap **Expand & Contract** (*Parallel Change*).
   - *Referensi*: [Martin Fowler — Parallel Change Pattern](https://martinfowler.com/bliki/ParallelChange.html) & [Stripe Engineering — Online Migrations at Scale](https://stripe.com/blog/online-migrations).

SchemaGuard bertindak sebagai gerbang kualitas (*quality gate*) deterministik di *pipeline* CI/CD untuk mendeteksi potensi *lock contention*, memetakan dampak silang ke rute API, dan menyintesis skrip mitigasi sebelum kode digabungkan ke cabang utama.

---

## 🏗️ Alur Kerja Sistem (Workflow Architecture)

```text
[ Berkas Migrasi DDL ] ──┐
                         ├─► [ SQL DDL Parser ] ──► [ Lock Matrix ] ──┐
[ Spesifikasi OpenAPI ] ─┘            │                               │
                                      ▼                               ▼
                           [ OpenAPI Diff Engine ] ────► [ Cross-Impact Mapper ]
                                                                      │
                         ┌────────────────────────────────────────────┴────────────────────────────────────────────┐
                         ▼                                                         ▼                               ▼
              [ Console Tree Reporter ]                               [ Standalone HTML Report ]              [ Expand-Contract Generator ]
             (Ringkasan Cepat Terminal)                                (schemaguard-report.html)                 (Skrip Migrasi Aman)
```

---

## ✨ Fitur Utama

- **Audit Migrasi SQL & Deteksi Penguncian:**
  - Parser deterministik yang kebal terhadap batas string literal dan komentar SQL (`--`, `/* ... */`).
  - Klasifikasi mode kunci PostgreSQL & MySQL: `ACCESS_EXCLUSIVE` (blokir penuh), `SHARE_ROW_EXCLUSIVE` / `SHARE` (blokir penulisan konkuren), dan `METADATA_LOCK`.

- **Validasi Kompatibilitas OpenAPI:**
  - Mendukung spesifikasi OpenAPI 3.x dan Swagger 2.0 (format JSON/YAML).
  - Resolusi skema `$ref` lokal (`#/components/schemas/...`) hingga pemetaan properti bersarang dalam larik (*array*).
  - Mendeteksi rute/metode yang dihapus, penambahan parameter wajib baru, dan perubahan tipe properti respons.

- **Pelacakan Dampak Silang (Cross-Impact Mapping):**
  - Mengorelasikan modifikasi kolom basis data terhadap endpoint API yang mengekspos data tersebut.
  - Normalisasi otomatis penamaan lintas batas (konversi `snake_case` di basis data ke `camelCase` di kontrak API).

- **Generator Mitigasi Zero-Downtime (Expand & Contract):**
  - **Fase Expand:** Penambahan kolom bayangan (*shadow column*), registrasi pemicu sinkronisasi ganda (*dual-writing trigger*), dan panduan *batch backfill* berpaginasi (1.000–5.000 baris/iterasi).
  - **Fase Contract:** Skrip pengalihan kueri baca, pembersihan pemicu, dan pelepasan kolom usang secara aman.

- **Laporan Visual HTML Mandiri (Offline-Ready):**
  - Menghasilkan berkas dasbor visual `schemaguard-report.html` (antarmuka *dark mode*, responsif, tanpa dependensi peladen atau CDN eksternal).

---

## ⚡ Panduan Cepat (Quickstart)

### 1. Instalasi dan Kompilasi

```bash
git clone https://github.com/ChoqySirait/schemaguard.git
cd schemaguard
npm install
npm run build
```

### 2. Jalankan Demonstrasi Satu Langkah

Gunakan berkas sampel uji yang tersedia pada repositori:

```bash
npm run demo
```

Perintah di atas memindai berkas migrasi SQL dan kontrak OpenAPI di folder `examples/`, mencetak hierarki temuan di konsol, serta menghasilkan laporan statis `schemaguard-report.html`.

---

## 💻 Penggunaan Baris Perintah (CLI)

```bash
schemaguard check \
  --migrations ./migrations \
  --api ./openapi.yaml \
  --html-report ./schemaguard-report.html \
  --fail-on CRITICAL
```

### Opsi Parameter

| Opsi | Deskripsi | Nilai Bawaan |
| :--- | :--- | :---: |
| `-m, --migrations <path>` | Jalur direktori atau berkas migrasi SQL | - |
| `-a, --api <path>` | Jalur berkas spesifikasi OpenAPI (YAML/JSON) | - |
| `--api-base <path>` | Berkas OpenAPI pembanding cabang utama (*base*) | - |
| `--api-head <path>` | Berkas OpenAPI cabang fitur (*head*) | - |
| `--html-report <path>` | Lokasi penyimpanan laporan visual HTML mandiri | `./schemaguard-report.html` |
| `--fail-on <level>` | Batas toleransi kegagalan exit code (`CRITICAL` / `WARNING`) | `CRITICAL` |
| `--ignore-rule <id>` | Mengabaikan kode aturan tertentu yang disetujui tim | - |

---

## 🖥️ Contoh Tampilan Terminal

```text
Laporan visual HTML berhasil disimpan ke: ./schemaguard-report.html

🛡️ SCHEMAGUARD AUDIT: [BLOCKED] KRITIS (Total 3 isu)
Skor Risiko: TINGGI (Downtime/Breaking) │ DDL Berisiko: 3 │ API Terdampak: 2
────────────────────────────────────────────────────────────────────────────────
🗄️ STRUKTUR HIERARKI TEMUAN PENGUNCIAN & DAMPAK API:
  📦 users (Tabel)
     ├── 🔴 Drop Column Statement [avatar_url] (ACCESS_EXCLUSIVE lock)
     │   └── 🔗 GET /api/users (properti 'avatar_url')
     └── 🔴 Alter Column Type [age] (ACCESS_EXCLUSIVE lock)
         └── 🔗 GET /api/users (properti 'age')
  📦 orders (Tabel)
     └── 🟡 Non-concurrent Index Creation [idx_orders_user] (SHARE lock)

⚠ Kontrak berkas OpenAPI tidak mengalami perubahan langsung, namun terdapat 2 endpoint yang terancam rusak akibat perubahan skema SQL.

🛡️ PANDUAN LANGKAH MITIGASI RINGKAS (EXPAND & CONTRACT):
1. users.avatar_url:
   - Expand : Hentikan akses pada kode aplikasi terlebih dahulu, jadikan nullable/deprecated.
   - Contract: Hapus fisik dari basis data setelah 100% armada rilis baru beroperasi.
2. users.age:
   - Expand : Tambah kolom bayangan ➔ pasang pemicu dual-write ➔ backfill bertahap (1k-5k baris/batch).
   - Contract: Alihkan kueri baca ke kolom baru ➔ bersihkan pemicu & kolom lama ➔ ganti nama definitif.
3. orders (idx_orders_user):
   - Tindakan: Buat indeks di luar blok transaksi tunggal menggunakan mode non-pemblokiran (CONCURRENTLY).
────────────────────────────────────────────────────────────────────────────────
📄 Buka laporan lengkap & skrip SQL mandiri : file://./schemaguard-report.html
💡 Lewati aturan jika terbukti aman         : schemaguard check --ignore-rule <id>
────────────────────────────────────────────────────────────────────────────────
```

---

## 🤖 Integrasi GitHub Actions (CI/CD Quality Gate)

Pasang SchemaGuard sebagai penentu kelulusan *merge* pada berkas `.github/workflows/schemaguard.yml`:

```yaml
name: SchemaGuard Quality Gate

on:
  pull_request:
    branches: [ main ]

jobs:
  audit:
    name: Schema & API Audit
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write

    steps:
      - name: Checkout Repositori
        uses: actions/checkout@v4

      - name: Pasang Lingkungan Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Pasang Dependensi
        run: npm ci

      - name: Kompilasi Proyek
        run: npm run build

      - name: Jalankan Audit SchemaGuard
        run: |
          node dist/index.js check \
            --migrations ./examples \
            --api ./examples/openapi.yaml \
            --html-report ./schemaguard-report.html \
            --fail-on CRITICAL

      - name: Unggah Artefak Laporan Visual
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: schemaguard-audit-report
          path: ./schemaguard-report.html
```

---

## 🧪 Pengujian Unit

SchemaGuard diverifikasi menggunakan Vitest dengan cakupan pengujian modul menyeluruh:

```bash
# Menjalankan seluruh rangkaian tes
npm test

# Menjalankan pengujian spesifik per domain
npx vitest run tests/sqlDiff.test.ts        # Parser DDL, Mode Kunci, Dialek SQL
npx vitest run tests/apiDiff.test.ts        # Perbedaan OpenAPI, Resolusi $ref, Dampak Silang
npx vitest run tests/recommender.test.ts    # Template Expand-Contract & Skrip Sintesis
```

---

## 📚 Referensi Praktik Rekayasa Industri

- **PostgreSQL Explicit Locking Documentation**: [postgresql.org/docs/current/explicit-locking.html](https://www.postgresql.org/docs/current/explicit-locking.html)
- **Martin Fowler — Parallel Change (Expand and Contract Pattern)**: [martinfowler.com/bliki/ParallelChange.html](https://martinfowler.com/bliki/ParallelChange.html)
- **Stripe Engineering — Online Migrations at Scale**: [stripe.com/blog/online-migrations](https://stripe.com/blog/online-migrations)
- **GitLab Database Guides — Avoiding Downtime in Migrations**: [docs.gitlab.com/ee/development/database/avoiding_downtime_in_migrations.html](https://docs.gitlab.com/ee/development/database/avoiding_downtime_in_migrations.html)

---

## 👨‍💻 Penulis & Pengembang

Proyek ini dirancang dan dikembangkan secara independen oleh:

- **Choqy Sirait** — Software / Information Systems Engineer
- **GitHub**: [@ChoqySirait](https://github.com/ChoqySirait)
- **LinkedIn**: [linkedin.com/in/choqysirait](https://linkedin.com/in/choqysirait)
- **Repositori**: [github.com/ChoqySirait/schemaguard](https://github.com/ChoqySirait/schemaguard)

Terbuka untuk kolaborasi, diskusi arsitektur keandalan data (*database reliability*), serta peningkatan fitur perkakas pengembang.

---

## 📄 Lisensi

Proyek ini didistribusikan di bawah lisensi MIT License. Hak Cipta © 2026 SchemaGuard Contributors. Lihat berkas [LICENSE](./LICENSE) untuk detail ketentuan lisensi.
