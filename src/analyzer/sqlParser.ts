/**
 * Parser Statis Berkas Migrasi SQL
 * Bertanggung jawab menguraikan teks skrip SQL menjadi daftar pernyataan (statements)
 * secara deterministik tanpa mengeksekusinya ke basis data nyata.
 *
 * Mendukung dialek PostgreSQL dan MySQL, pembersihan komentar,
 * pemisahan pernyataan berdasar titik koma dengan pemahaman string literal,
 * serta ekstraksi metadata operasi tabel dan kolom.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DatabaseDialect } from '../types';

export interface ParsedSqlStatement {
  statement: string;
  raw: string;
  startLine: number;
  endLine: number;
  operationType: string;
  table?: string;
  column?: string;
  newColumn?: string;
  targetType?: string;
  dialect?: DatabaseDialect;
}

export interface ParsedSqlFile {
  filePath: string;
  fileName: string;
  statements: ParsedSqlStatement[];
}

export interface StatementMetadata {
  operationType: string;
  table?: string;
  column?: string;
  newColumn?: string;
  targetType?: string;
  dialect?: DatabaseDialect;
}

/**
 * Membersihkan tanda kutip pengenal (quotes) SQL seperti backtick, tanda petik ganda, atau kurung siku
 */
export function cleanIdentifier(identifier: string): string {
  if (!identifier) return '';
  const cleaned = identifier.trim().replace(/^[`"'\[]+|[`"'\]]+$/g, '');
  // Jika identifier berbentuk schema.table, ambil bagian tabelnya jika perlu atau pertahankan
  const dotParts = cleaned.split('.');
  return dotParts[dotParts.length - 1].replace(/[`"'\[\]]/g, '');
}

/**
 * Membersihkan komentar SQL (single line -- dan multi line /* *\/)
 * dengan mempertahankan jumlah baris untuk akurasi penomoran baris.
 */
export function stripComments(sql: string): string {
  let cleaned = sql.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    return '\n'.repeat((match.match(/\n/g) || []).length);
  });

  cleaned = cleaned.replace(/--.*$/gm, '');
  return cleaned;
}

/**
 * Mengekstrak nama tabel, kolom, dan jenis operasi dari pernyataan DDL SQL
 */
export function extractStatementMetadata(statement: string): StatementMetadata {
  const normalized = statement.trim().replace(/\s+/g, ' ');

  // 1. Deteksi DROP TABLE
  const dropTableMatch = normalized.match(/\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([`"']?[\w.]+[`"']?)/i);
  if (dropTableMatch) {
    return {
      operationType: 'DROP_TABLE',
      table: cleanIdentifier(dropTableMatch[1]),
      dialect: 'generic'
    };
  }

  // 2. Deteksi RENAME TABLE (Sintaks MySQL / Oracle: RENAME TABLE old TO new)
  const renameTableMysqlMatch = normalized.match(/\bRENAME\s+TABLE\s+([`"']?[\w.]+[`"']?)\s+TO\s+([`"']?[\w.]+[`"']?)/i);
  if (renameTableMysqlMatch) {
    return {
      operationType: 'RENAME_TABLE',
      table: cleanIdentifier(renameTableMysqlMatch[1]),
      column: cleanIdentifier(renameTableMysqlMatch[2]),
      dialect: 'mysql'
    };
  }

  // 3. Deteksi ALTER TABLE
  const alterTableMatch = normalized.match(/\bALTER\s+TABLE\s+(?:ONLY\s+)?([`"']?[\w.]+[`"']?)\s+(.*)/i);
  if (alterTableMatch) {
    const table = cleanIdentifier(alterTableMatch[1]);
    const clause = alterTableMatch[2];

    // ALTER TABLE ... RENAME TO new_table
    const renameToMatch = clause.match(/\bRENAME\s+TO\s+([`"']?[\w.]+[`"']?)/i);
    if (renameToMatch) {
      return {
        operationType: 'RENAME_TABLE',
        table,
        column: cleanIdentifier(renameToMatch[1]),
        dialect: 'generic'
      };
    }

    // ALTER TABLE ... DROP COLUMN col
    const dropColMatch = clause.match(/\bDROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?([`"']?[\w]+[`"']?)/i);
    if (dropColMatch) {
      return {
        operationType: 'ALTER_TABLE_DROP_COLUMN',
        table,
        column: cleanIdentifier(dropColMatch[1]),
        dialect: 'generic'
      };
    }

    // ALTER TABLE ... ALTER COLUMN col TYPE target_type (PostgreSQL)
    const alterColTypeMatch = clause.match(/\bALTER\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)\s+(?:SET\s+DATA\s+)?TYPE\s+([^;]+)/i);
    if (alterColTypeMatch) {
      return {
        operationType: 'ALTER_TABLE_ALTER_COLUMN_TYPE',
        table,
        column: cleanIdentifier(alterColTypeMatch[1]),
        targetType: alterColTypeMatch[2].trim(),
        dialect: 'postgresql'
      };
    }

    // ALTER TABLE ... MODIFY COLUMN col target_type (MySQL)
    const modifyColMatch = clause.match(/\bMODIFY\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)\s+([^;]+)/i);
    if (modifyColMatch) {
      return {
        operationType: 'ALTER_TABLE_ALTER_COLUMN_TYPE',
        table,
        column: cleanIdentifier(modifyColMatch[1]),
        targetType: modifyColMatch[2].trim(),
        dialect: 'mysql'
      };
    }

    // ALTER TABLE ... CHANGE COLUMN old_col new_col target_type (MySQL)
    const changeColMatch = clause.match(/\bCHANGE\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)\s+([`"']?[\w]+[`"']?)\s+([^;]+)/i);
    if (changeColMatch) {
      return {
        operationType: 'ALTER_TABLE_RENAME_COLUMN',
        table,
        column: cleanIdentifier(changeColMatch[1]),
        newColumn: cleanIdentifier(changeColMatch[2]),
        targetType: changeColMatch[3].trim(),
        dialect: 'mysql'
      };
    }

    // ALTER TABLE ... RENAME COLUMN old_col TO new_col (PostgreSQL)
    const renameColMatch = clause.match(/\bRENAME\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)\s+TO\s+([`"']?[\w]+[`"']?)/i);
    if (renameColMatch) {
      return {
        operationType: 'ALTER_TABLE_RENAME_COLUMN',
        table,
        column: cleanIdentifier(renameColMatch[1]),
        newColumn: cleanIdentifier(renameColMatch[2]),
        dialect: 'postgresql'
      };
    }

    // ALTER TABLE ... ADD CONSTRAINT constraint_name (CHECK / FOREIGN KEY)
    const addConstraintMatch = clause.match(/\bADD\s+CONSTRAINT\s+([`"']?[\w]+[`"']?)/i);
    if (addConstraintMatch) {
      return {
        operationType: 'ALTER_TABLE_ADD_CONSTRAINT',
        table,
        column: cleanIdentifier(addConstraintMatch[1]),
        dialect: 'generic'
      };
    }

    // ALTER TABLE ... ADD COLUMN col
    const addColMatch = clause.match(/\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([`"']?[\w]+[`"']?)/i);
    if (addColMatch) {
      return {
        operationType: 'ALTER_TABLE_ADD_COLUMN',
        table,
        column: cleanIdentifier(addColMatch[1]),
        dialect: 'generic'
      };
    }

    return {
      operationType: 'ALTER_TABLE',
      table,
      dialect: 'generic'
    };
  }

  // 4. Deteksi CREATE INDEX
  const createIndexMatch = normalized.match(
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([`"']?[\w]+[`"']?)?\s+ON\s+([`"']?[\w.]+[`"']?)/i
  );
  if (createIndexMatch) {
    return {
      operationType: 'CREATE_INDEX',
      table: cleanIdentifier(createIndexMatch[2]),
      column: createIndexMatch[1] ? cleanIdentifier(createIndexMatch[1]) : undefined,
      dialect: normalized.toLowerCase().includes('concurrently') ? 'postgresql' : 'generic'
    };
  }

  // 5. Deteksi CREATE TABLE
  const createTableMatch = normalized.match(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"']?[\w.]+[`"']?)/i);
  if (createTableMatch) {
    return {
      operationType: 'CREATE_TABLE',
      table: cleanIdentifier(createTableMatch[1]),
      dialect: 'generic'
    };
  }

  return {
    operationType: 'UNKNOWN',
    dialect: 'generic'
  };
}

/**
 * Menguraikan teks SQL utuh menjadi deretan pernyataan individual dengan nomor baris yang tepat.
 * Memperhitungkan batas string literal ('...') dan komentar agar pemisahan titik koma (;)
 * tidak memecah nilai di dalam string atau ekspresi fungsi.
 */
export function parseSqlStatements(rawSql: string): ParsedSqlStatement[] {
  const statements: ParsedSqlStatement[] = [];
  const lines = rawSql.split(/\r?\n/);

  let currentStatement = '';
  let currentRaw = '';
  let startLine = 1;

  let inSingleQuote = false;
  let inMultiLineComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    let processedLine = '';
    let j = 0;

    while (j < line.length) {
      const char = line[j];
      const nextChar = line[j + 1];

      // Di dalam multi-line comment /* ... */
      if (inMultiLineComment) {
        if (char === '*' && nextChar === '/') {
          inMultiLineComment = false;
          j += 2;
        } else {
          j++;
        }
        continue;
      }

      // Di dalam string literal '...'
      if (inSingleQuote) {
        processedLine += char;
        if (char === "'") {
          // Tangani escape quote '' dalam SQL
          if (nextChar === "'") {
            processedLine += nextChar;
            j += 2;
            continue;
          }
          inSingleQuote = false;
        }
        j++;
        continue;
      }

      // Cek awal multi-line comment /*
      if (char === '/' && nextChar === '*') {
        inMultiLineComment = true;
        j += 2;
        continue;
      }

      // Cek komentar satu baris --
      if (char === '-' && nextChar === '-') {
        // Abaikan sisa baris
        break;
      }

      // Cek awal string literal '
      if (char === "'") {
        inSingleQuote = true;
        processedLine += char;
        j++;
        continue;
      }

      // Karakter biasa
      processedLine += char;
      j++;
    }

    if (!currentStatement.trim() && processedLine.trim()) {
      startLine = lineNum;
    }

    currentStatement += (currentStatement ? '\n' : '') + processedLine;
    currentRaw += (currentRaw ? '\n' : '') + line;

    // Jika baris mengandung titik koma di luar string/komentar
    if (processedLine.includes(';')) {
      // Pecah pernyataan berdasarkan ';' di luar quote
      const parts = splitStatementsBySemicolon(currentStatement);

      for (let p = 0; p < parts.length - 1; p++) {
        const stmtText = parts[p].trim();
        if (stmtText) {
          const meta = extractStatementMetadata(stmtText);
          statements.push({
            statement: stmtText,
            raw: currentRaw.trim(),
            startLine,
            endLine: lineNum,
            operationType: meta.operationType,
            table: meta.table,
            column: meta.column,
            newColumn: meta.newColumn,
            targetType: meta.targetType,
            dialect: meta.dialect
          });
        }
      }

      const remainder = parts[parts.length - 1];
      if (remainder.trim()) {
        currentStatement = remainder;
        currentRaw = remainder;
        startLine = lineNum;
      } else {
        currentStatement = '';
        currentRaw = '';
      }
    }
  }

  // Jika tersisa pernyataan tanpa titik koma penutup di akhir berkas
  if (currentStatement.trim()) {
    const meta = extractStatementMetadata(currentStatement.trim());
    statements.push({
      statement: currentStatement.trim(),
      raw: currentRaw.trim(),
      startLine,
      endLine: lines.length,
      operationType: meta.operationType,
      table: meta.table,
      column: meta.column,
      newColumn: meta.newColumn,
      targetType: meta.targetType,
      dialect: meta.dialect
    });
  }

  return statements;
}

/**
 * Memecah teks SQL berdasarkan titik koma (;) hanya ketika titik koma berada di luar string literal
 */
function splitStatementsBySemicolon(text: string): string[] {
  const parts: string[] = [];
  let currentPart = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === "'") {
      if (inQuote && nextChar === "'") {
        currentPart += "''";
        i++;
        continue;
      }
      inQuote = !inQuote;
      currentPart += char;
    } else if (char === ';' && !inQuote) {
      parts.push(currentPart);
      currentPart = '';
    } else {
      currentPart += char;
    }
  }

  parts.push(currentPart);
  return parts;
}

/**
 * Membaca dan menguraikan berkas migrasi SQL dari file path
 */
export function parseSqlFile(filePath: string): ParsedSqlFile {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Berkas SQL migrasi tidak ditemukan: ${filePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  const statements = parseSqlStatements(content);

  return {
    filePath: absolutePath,
    fileName: path.basename(absolutePath),
    statements
  };
}

/**
 * Membaca semua berkas SQL dari sebuah direktori migrasi secara urut (alfabetis)
 */
export function parseSqlDirectory(dirPath: string): ParsedSqlFile[] {
  const absoluteDir = path.resolve(dirPath);
  if (!fs.existsSync(absoluteDir) || !fs.statSync(absoluteDir).isDirectory()) {
    return [];
  }

  const files = fs.readdirSync(absoluteDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  return files.map((file) => parseSqlFile(path.join(absoluteDir, file)));
}
