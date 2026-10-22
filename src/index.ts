#!/usr/bin/env node

/**
 * SchemaGuard CLI Entry Point
 * Titik masuk antarmuka baris perintah untuk SchemaGuard.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { CliOptions, RiskLevel } from './types';

export const program = new Command();

program
  .name('schemaguard')
  .description('Perkakas pendeteksi perubahan merusak pada migrasi basis data dan spesifikasi API')
  .version('0.1.0');

/**
 * Perintah: check-db
 * Memindai migrasi basis data untuk mendeteksi anti-pola skema berbahaya.
 */
program
  .command('check-db')
  .description('Pindai berkas migrasi basis data SQL untuk mendeteksi perubahan berisiko')
  .option('-f, --file <path>', 'Jalur ke berkas SQL migrasi')
  .option('-d, --dir <path>', 'Direktori berkas migrasi SQL')
  .option('--base <path>', 'Jalur ke skema dasar atau referensi cabang utama')
  .option('--format <type>', 'Format pelaporan (console, json, markdown)', 'console')
  .action((options) => {
    console.log(chalk.blue.bold('\n[SchemaGuard] Memulai analisis migrasi basis data...'));
    if (!options.file && !options.dir) {
      console.error(chalk.red('Galat: Harap tentukan --file atau --dir untuk dipindai.'));
      process.exitCode = 1;
      return;
    }

    console.log(chalk.gray(`Target: ${options.file || options.dir}`));
    console.log(chalk.yellow('Pemeriksaan selesai. (Modul analisis akan dihubungkan pada Fase 2)'));
  });

/**
 * Perintah: check-api
 * Membandingkan spesifikasi OpenAPI untuk mendeteksi perubahan kontrak merusak.
 */
program
  .command('check-api')
  .description('Bandingkan spesifikasi OpenAPI antara versi lama dan baru')
  .requiredOption('--base <path>', 'Jalur ke berkas OpenAPI dasar (JSON/YAML lama)')
  .requiredOption('--head <path>', 'Jalur ke berkas OpenAPI target (JSON/YAML baru)')
  .option('--format <type>', 'Format pelaporan (console, json, markdown)', 'console')
  .action((options) => {
    console.log(chalk.blue.bold('\n[SchemaGuard] Memulai analisis kompatibilitas kontrak API...'));
    console.log(chalk.gray(`Base: ${options.base}`));
    console.log(chalk.gray(`Head: ${options.head}`));
    console.log(chalk.yellow('Pemeriksaan selesai. (Modul analisis akan dihubungkan pada Fase 3)'));
  });

/**
 * Perintah: scan
 * Menjalankan evaluasi komprehensif (basis data dan kontrak API) serta menghasilkan rekomendasi mitigasi.
 */
program
  .command('scan')
  .description('Jalankan pemindaian penuh untuk basis data dan spesifikasi API')
  .option('--sql-file <path>', 'Berkas SQL migrasi')
  .option('--sql-dir <path>', 'Direktori berkas migrasi SQL')
  .option('--api-base <path>', 'Berkas OpenAPI dasar')
  .option('--api-head <path>', 'Berkas OpenAPI target')
  .option('--format <type>', 'Format pelaporan (console, json, markdown)', 'console')
  .option('--fail-on <level>', 'Gagalkan proses jika risiko mencapai batas ini (CRITICAL, WARNING)', 'CRITICAL')
  .action((options: CliOptions) => {
    console.log(chalk.cyan.bold('\n========================================='));
    console.log(chalk.cyan.bold('          SchemaGuard Scanner            '));
    console.log(chalk.cyan.bold('=========================================\n'));

    console.log(chalk.gray(`Format keluaran: ${options.format || 'console'}`));
    console.log(chalk.gray(`Ambang batas kegagalan: ${options.failOn || RiskLevel.CRITICAL}`));
    console.log(chalk.green('\nEvaluasi CLI diinisialisasi dengan sukses.'));
  });

/**
 * Jalankan parser perintah baris argumen
 */
export function runCli(args: string[] = process.argv): void {
  program.parse(args);
}

// Eksekusi langsung jika dipanggil sebagai script mandiri
if (require.main === module) {
  runCli();
}
