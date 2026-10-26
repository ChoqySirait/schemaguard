# Product Requirement Document (PRD): SchemaGuard

## 1. Masalah Rekayasa Perangkat Lunak
Di perusahaan teknologi, migrasi basis data dan perubahan kontrak API pada Pull Request sering kali lolos dari peninjauan kode manual, memicu dua insiden kritis di produksi:
1. **Downtime Akibat Kunci Tabel**: Menjalankan DDL berisiko (seperti mengubah tipe kolom, menambah NOT NULL tanpa nilai default, atau membuat indeks tanpa CONCURRENTLY) yang memicu Access Exclusive Lock pada tabel besar.
2. **Breaking API Changes**: Menghapus atau mengubah struktur kolom di SQL yang secara diam-diam memutus spesifikasi kontrak endpoint OpenAPI yang sedang digunakan oleh aplikasi klien.

SchemaGuard adalah perkakas baris perintah (CLI) dan aksi CI untuk mendeteksi anomali ini secara deterministik sebelum kode digabungkan ke cabang utama.

## 2. Alur Penggunaan (Developer Workflow)
1. Pengembang menjalankan `schemaguard check --migrations ./migrations --api ./openapi.yaml` secara lokal atau di alur kerja GitHub Actions.
2. Sistem menganalisis perbedaan perubahan skema (Git Diff).
3. Jika ditemukan operasi berbahaya:
   - CLI menghasilkan kode keluar gagal (`exit code 1`) untuk memblokir merge PR.
   - CLI mencetak tabel ringkasan risiko di terminal.
   - CLI membuat berkas laporan visual statis `schemaguard-report.html` untuk mempermudah audit visual tim pengembang.
   - CLI menyusun draf skrip mitigasi migrasi aman (pola Expand-Contract).

## 3. Komponen Utama
- **SQL Migration Auditor**: Memeriksa sintaksis DDL PostgreSQL dan MySQL terhadap aturan penguncian tabel berisiko.
- **OpenAPI Breaking Checker**: Membandingkan berkas OpenAPI cabang PR terhadap cabang utama untuk mendeteksi penghapusan rute, perubahan parameter, dan inkonsistensi tipe properti.
- **Cross-Impact Mapper**: Memetakan hubungan langsung antara kolom SQL yang dimodifikasi dengan properti respons pada OpenAPI.
- **HTML Report Generator**: Mengompilasi ringkasan audit ke dalam satu berkas HTML mandiri (dark-mode, tanpa dependensi server luar) yang dapat langsung dibuka di peramban.

## 4. Referensi Praktik Terbaik Industri
- Dokumentasi Penguncian PostgreSQL: https://www.postgresql.org/docs/current/explicit-locking.html
- Martin Fowler (Expand and Contract Pattern): https://martinfowler.com/bliki/ParallelChange.html
- Stripe Engineering (Online Migrations at Scale): https://stripe.com/blog/online-migrations