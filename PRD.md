# Dokumen Kebutuhan Produk: SchemaGuard

## 1. Ringkasan Eksekutif
SchemaGuard adalah perkakas baris perintah dan aksi otomatisasi alur kerja pengembang yang berfungsi mendeteksi perubahan merusak pada migrasi basis data dan spesifikasi antarmuka pemrograman aplikasi secara otomatis pada cabang pull request. Selain memblokir penggabungan kode yang berisiko, SchemaGuard memanfaatkan agen cerdas untuk merancang strategi mitigasi migrasi bertahap tanpa waktu henti.

## 2. Masalah yang Diselesaikan
- Perubahan skema basis data berbahaya (penghapusan kolom, perubahan tipe data, penguncian tabel) yang menyebabkan kegagalan sistem di lingkungan produksi.
- Perubahan kontrak antarmuka pemrograman aplikasi tanpa versi baru yang merusak integrasi aplikasi klien.
- Beban tim perekayasa perangkat lunak dalam menyusun skrip migrasi kompatibilitas ke belakang secara manual.

## 3. Cakupan Sistem
Sistem dibangun dalam bentuk perkakas antarmuka baris perintah yang dapat dijalankan secara lokal maupun diintegrasikan ke dalam alur kerja GitHub Actions.

### Modul Utama
1. **Database Migration Diff Engine**:
   - Memindai berkas migrasi SQL atau berkas skema pada cabang kerja terhadap cabang utama.
   - Mendeteksi operasi berbahaya: DROP TABLE, DROP COLUMN, ALTER COLUMN TYPE, RENAME COLUMN, ADD NOT NULL tanpa nilai bawaan, dan pembuatan indeks tanpa mode non-pemblokiran.
   - Menghasilkan laporan tingkat keparahan risiko: Kritis, Peringatan, atau Aman.

2. **API Contract Compatibility Engine**:
   - Membandingkan berkas spesifikasi OpenAPI format JSON atau YAML antara cabang kerja dan cabang utama.
   - Mendeteksi perubahan merusak: penghapusan rute, perubahan format respons, penambahan parameter wajib pada permintaan, atau penghapusan kode status keberhasilan.

3. **Autonomous Migration Recommender**:
   - Menganalisis operasi berbahaya yang terdeteksi.
   - Menghasilkan rancangan skrip mitigasi menggunakan pola perluas dan susutkan secara otomatis.
   - Menyediakan langkah transisi dua fase agar kode lama dan kode baru dapat berjalan berdampingan selama penerapan.

4. **Reporter & GitHub Commenter**:
   - Mencetak ringkasan visual pada terminal saat dijalankan secara lokal.
   - Mengunggah komentar terstruktur berisi tabel evaluasi risiko dan usulan solusi langsung pada pull request GitHub jika dijalankan pada alur kerja integrasi berkelanjutan.

## 4. Persyaratan Non-Fungsional
- Eksekusi deterministik: Modul analisis statis harus berjalan cepat tanpa dependensi ke jaringan luar.
- Modularitas: Parser basis data dan parser kontrak API harus terisolasi agar mudah diperluas ke dialek atau format lain.
- Keamanan: Tidak mengeksekusi skrip SQL secara langsung ke basis data nyata saat fase pemindaian; seluruh evaluasi berbasis penguraian teks dan pohon sintaksis statis.

## 5. Rencana Fase Pengembangan
- **Fase 1**: Inisialisasi struktur proyek, perkakas baris perintah dasar, dan parser berkas migrasi SQL.
- **Fase 2**: Implementasi mesin pendeteksi aturan perubahan skema basis data berbahaya beserta pengujian unit.
- **Fase 3**: Implementasi mesin pembanding spesifikasi OpenAPI dan deteksi perubahan kontrak antarmuka pemrograman aplikasi.
- **Fase 4**: Integrasi logika agen untuk pembuatan rekomendasi mitigasi pola transisi skema.
- **Fase 5**: Pembuatan format keluaran pelaporan terminal dan aksi integrasi GitHub Actions.