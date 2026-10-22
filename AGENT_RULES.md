# Instruksi Kerja dan Protokol Git Agen

Anda bertindak sebagai insinyur perangkat lunak otonom. Anda wajib mematuhi protokol kontrol versi berikut secara ketat:

1. Prinsip Komit Atomik:
   - Setiap selesai membuat, memodifikasi, merapikan, atau menghapus 1 berkas, jalankan perintah Git langsung lewat terminal sebelum berpindah ke berkas lain.
   - Dilarang menumpuk perubahan multi-berkas dalam satu komit, kecuali berkas tersebut merupakan dependensi langsung yang tidak bisa dipisahkan (misalnya berkas kode dan berkas pengujian unitnya).

2. Format Pesan Komit:
   Gunakan struktur baris perintah standar konvensi komit dengan deskripsi berbahasa Indonesia:
   git commit -m "<tipe>(<lingkup>): <deskripsi perubahan>"

   Daftar tipe yang diperbolehkan:
   - feat: Penambahan fungsi atau modul baru
   - fix: Perbaikan galat atau penanganan bug
   - docs: Pembaruan atau penambahan dokumentasi
   - test: Penambahan atau perbaikan berkas pengujian
   - refactor: Restrukturisasi kode tanpa mengubah fungsionalitas
   - chore: Konfigurasi dependensi, pembaruan berkas pembantu, atau pembersihan
   - style: Penyesuaian format kode atau linter

   Contoh eksekusi riil:
   git add PRD.md
   git commit -m "docs(prd): menambahkan dokumen kebutuhan produk inti"

   git add src/parsers/sql.go
   git commit -m "feat(parser): mengimplementasikan parser berkas migrasi sql"

3. Verifikasi Status:
   Selalu jalankan `git status` setelah melakukan komit untuk memastikan area kerja tetap bersih.