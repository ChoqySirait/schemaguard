/**
 * Parser Statis Berkas Migrasi SQL
 * Bertanggung jawab menguraikan teks skrip SQL menjadi daftar pernyataan (statements)
 * secara deterministik tanpa mengeksekusinya ke basis data nyata.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ParsedSqlStatement {
  statement: string;
  raw: string;
  startLine: number;
  endLine: number;
  operationType: string;
  table?: string;
  column?: string;
}

export interface ParsedSqlFile {
  filePath: string;
  fileName: string;
  statements: ParsedSqlStatement[];
}

/**
 * Membersihkan komentar SQL (single line dan multi line) untuk analisis yang akurat
 */
export function stripComments(sql: string): string {
  // Menghilangkan komentar multi-line /* ... */
  let cleaned = sql.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    // Pertahankan baris baru agar kalkulasi line number tetap sinkron
    return '\n'.repeat((match.match(/\n/g) || []).length);
  });

  // Menghilangkan komentar single line -- ...
  cleaned = cleaned.replace(/--.*$/gm, '');

  return cleaned;
}

/**
 * Mengekstrak nama tabel dan operasi dari sebuah pernyataan SQL
 */
export function extractStatementMetadata(statement: string): { operationType: string; table?: string; column?: string } {
  const normalized = statement.trim().replace(/\s+/g, ' ');

  // Deteksi DROP TABLE
  const dropTableMatch = normalized.match(/\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([`"']?[\w.]+[`"']?)/i);
  if (dropTableMatch) {
    const table = dropTableMatch[1].replace(/[`"']/g, '');
    return { operationType: 'DROP_TABLE', table };
  }

  // Deteksi ALTER TABLE
  const alterTableMatch = normalized.match(/\bALTER\s+TABLE\s+(?:ONLY\s+)?([`"']?[\w.]+[`"']?)\s+(.*)/i);
  if (alterTableMatch) {
    const table = alterTableMatch[1].replace(/[`"']/g, '');
    const clause = alterTableMatch[2];

    // DROP COLUMN
    const dropColMatch = clause.match(/\bDROP\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)/i);
    if (dropColMatch) {
      return { operationType: 'ALTER_TABLE_DROP_COLUMN', table, column: dropColMatch[1].replace(/[`"']/g, '') };
    }

    // ALTER COLUMN TYPE
    const alterColMatch = clause.match(/\bALTER\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)\s+(?:SET\s+DATA\s+)?TYPE\b/i);
    if (alterColMatch) {
      return { operationType: 'ALTER_TABLE_ALTER_COLUMN_TYPE', table, column: alterColMatch[1].replace(/[`"']/g, '') };
    }

    // RENAME COLUMN
    const renameColMatch = clause.match(/\bRENAME\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)\s+TO\s+([`"']?[\w]+[`"']?)/i);
    if (renameColMatch) {
      return { operationType: 'ALTER_TABLE_RENAME_COLUMN', table, column: renameColMatch[1].replace(/[`"']/g, '') };
    }

    // ADD COLUMN NOT NULL
    const addColMatch = clause.match(/\bADD\s+(?:COLUMN\s+)?([`"']?[\w]+[`"']?)/i);
    if (addColMatch) {
      return { operationType: 'ALTER_TABLE_ADD_COLUMN', table, column: addColMatch[1].replace(/[`"']/g, '') };
    }

    return { operationType: 'ALTER_TABLE', table };
  }

  // Deteksi CREATE INDEX
  const createIndexMatch = normalized.match(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([`"']?[\w]+[`"']?)?\s+ON\s+([`"']?[\w.]+[`"']?)/i);
  if (createIndexMatch) {
    const table = createIndexMatch[2].replace(/[`"']/g, '');
    return { operationType: 'CREATE_INDEX', table };
  }

  // Deteksi CREATE TABLE
  const createTableMatch = normalized.match(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"']?[\w.]+[`"']?)/i);
  if (createTableMatch) {
    const table = createTableMatch[1].replace(/[`"']/g, '');
    return { operationType: 'CREATE_TABLE', table };
  }

  return { operationType: 'UNKNOWN' };
}

/**
 * Menguraikan teks SQL utuh menjadi deretan pernyataan individual dengan nomor baris
 */
export function parseSqlStatements(rawSql: string): ParsedSqlStatement[] {
  const statements: ParsedSqlStatement[] = [];
  const lines = rawSql.split(/\r?\n/);

  let currentStatement = '';
  let currentRaw = '';
  let startLine = 1;
  let inMultiLineComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    let processedLine = line;

    // Sederhanakan tracking comment per line
    if (inMultiLineComment) {
      const endCommentIdx = processedLine.indexOf('*/');
      if (endCommentIdx !== -1) {
        inMultiLineComment = false;
        processedLine = processedLine.slice(endCommentIdx + 2);
      } else {
        processedLine = '';
      }
    }

    if (!inMultiLineComment) {
      // Periksa start comment
      const startCommentIdx = processedLine.indexOf('/*');
      if (startCommentIdx !== -1) {
        const endCommentIdx = processedLine.indexOf('*/', startCommentIdx + 2);
        if (endCommentIdx !== -1) {
          processedLine = processedLine.slice(0, startCommentIdx) + ' ' + processedLine.slice(endCommentIdx + 2);
        } else {
          inMultiLineComment = true;
          processedLine = processedLine.slice(0, startCommentIdx);
        }
      }

      // Hapus komentar single-line
      const singleCommentIdx = processedLine.indexOf('--');
      if (singleCommentIdx !== -1) {
        processedLine = processedLine.slice(0, singleCommentIdx);
      }
    }

    if (!currentStatement.trim() && processedLine.trim()) {
      startLine = lineNum;
    }

    currentStatement += (currentStatement ? '\n' : '') + processedLine;
    currentRaw += (currentRaw ? '\n' : '') + line;

    // Pemisah pernyataan adalah tanda titik koma (;)
    if (processedLine.includes(';')) {
      const parts = currentStatement.split(';');
      // Ada kemungkinan lebih dari 1 pernyataan dalam satu baris atau baris berakhir dengan ;
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
            column: meta.column
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

  // Jika tersisa pernyataan tanpa titik koma di akhir berkas
  if (currentStatement.trim()) {
    const meta = extractStatementMetadata(currentStatement.trim());
    statements.push({
      statement: currentStatement.trim(),
      raw: currentRaw.trim(),
      startLine,
      endLine: lines.length,
      operationType: meta.operationType,
      table: meta.table,
      column: meta.column
    });
  }

  return statements;
}

/**
 * Membaca dan menguraikan berkas migrasi SQL dari file path
 */
export function parseSqlFile(filePath: string): ParsedSqlFile {
  const absolutePath = path.resolve(filePath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const statements = parseSqlStatements(content);

  return {
    filePath: absolutePath,
    fileName: path.basename(absolutePath),
    statements
  };
}

/**
 * Membaca semua berkas SQL dari sebuah direktori migrasi
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
