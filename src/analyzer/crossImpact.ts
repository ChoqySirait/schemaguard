/**
 * Mesin Pemetaan Dampak Silang (Cross-Impact Mapper)
 * Memetakan hubungan langsung antara modifikasi kolom SQL (seperti DROP COLUMN,
 * RENAME COLUMN, atau ALTER COLUMN TYPE) terhadap properti respons pada endpoint OpenAPI.
 *
 * Mencegah insiden di mana perubahan DDL basis data secara diam-diam
 * merusak kontrak payload API yang dikonsumsi oleh aplikasi klien.
 */

import { CrossImpactLink, DatabaseIssue, RiskLevel } from '../types';
import {
  extractAllOperations,
  OpenApiSchemaObject,
  OpenApiSpec,
  parseOpenApiFile,
  resolveSchemaRef
} from './apiParser';

/**
 * Normalisasi nama identifier untuk membandingkan snake_case dan camelCase
 * Contoh: 'user_avatar_url' -> 'useravatarurl', 'userAvatarUrl' -> 'useravatarurl'
 */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Mengekstrak seluruh nama properti dari skema respons (termasuk referensi komponen dan item array)
 */
function extractResponseProperties(
  schema: OpenApiSchemaObject | undefined,
  spec: OpenApiSpec
): string[] {
  if (!schema) return [];

  const resolved = resolveSchemaRef(schema, spec);
  if (!resolved) return [];

  const properties: string[] = [];

  // Jika schema objek dengan properties
  if (resolved.properties) {
    for (const propName of Object.keys(resolved.properties)) {
      properties.push(propName);
    }
  }

  // Jika schema array of objects
  if (resolved.type === 'array' && resolved.items) {
    const itemProps = extractResponseProperties(resolved.items as OpenApiSchemaObject, spec);
    properties.push(...itemProps);
  }

  return properties;
}

/**
 * Memetakan keterkaitan langsung antara daftar temuan SQL dan spesifikasi rute OpenAPI
 */
export function mapCrossImpact(
  dbIssues: DatabaseIssue[],
  apiSpec: OpenApiSpec
): CrossImpactLink[] {
  const links: CrossImpactLink[] = [];
  const operations = extractAllOperations(apiSpec);

  // Ambil hanya isu SQL yang melibatkan modifikasi kolom tertentu
  const columnIssues = dbIssues.filter(
    (issue) => issue.column && issue.table && issue.riskLevel !== RiskLevel.SAFE
  );

  for (const issue of columnIssues) {
    const sqlTable = issue.table as string;
    const sqlCol = issue.column as string;
    const normalizedCol = normalizeName(sqlCol);

    for (const { path: apiPath, method, operation } of operations) {
      const responses = operation.responses || {};

      // Kumpulkan seluruh properti respons yang dikembalikan oleh endpoint ini
      const endpointProperties = new Set<string>();

      for (const statusCode of Object.keys(responses)) {
        if (statusCode.startsWith('2')) {
          const resp = responses[statusCode];
          const jsonSchema = resp?.content?.['application/json']?.schema || resp?.schema;
          if (jsonSchema) {
            const props = extractResponseProperties(jsonSchema, apiSpec);
            for (const p of props) {
              endpointProperties.add(p);
            }
          }
        }
      }

      // Periksa apakah ada properti respons yang cocok dengan kolom SQL yang diubah
      for (const propName of endpointProperties) {
        const normalizedProp = normalizeName(propName);

        if (normalizedCol === normalizedProp) {
          let impactDesc = '';
          if (issue.ruleId === 'DROP_COLUMN') {
            impactDesc = `Kolom '${sqlTable}.${sqlCol}' dihapus di SQL, berpotensi menghilangkan nilai properti '${propName}' pada respons API.`;
          } else if (issue.ruleId === 'ALTER_COLUMN_TYPE') {
            impactDesc = `Tipe kolom '${sqlTable}.${sqlCol}' diubah di SQL, memicu inkonsistensi tipe data pada properti respons '${propName}'.`;
          } else if (issue.ruleId === 'RENAME_COLUMN') {
            impactDesc = `Kolom '${sqlTable}.${sqlCol}' diubah namanya di SQL, berisiko mengembalikan nilai null/undefined untuk properti '${propName}'.`;
          } else {
            impactDesc = `Perubahan kolom '${sqlTable}.${sqlCol}' (${issue.ruleId}) berdampak langsung pada endpoint API.`;
          }

          links.push({
            sqlTable,
            sqlColumn: sqlCol,
            apiPath,
            apiMethod: method.toUpperCase(),
            propertyName: propName,
            impactDescription: impactDesc,
            riskLevel: issue.riskLevel
          });
        }
      }
    }
  }

  return links;
}

/**
 * Memetakan dampak silang langsung dari berkas spesifikasi OpenAPI
 */
export function mapCrossImpactFromApiFile(
  dbIssues: DatabaseIssue[],
  apiFilePath: string
): CrossImpactLink[] {
  const apiSpec = parseOpenApiFile(apiFilePath);
  return mapCrossImpact(dbIssues, apiSpec);
}

/**
 * Menyusun ringkasan status kompatibilitas API yang selaras dengan temuan dampak silang.
 * Menghilangkan kontradiksi ketika berkas spesifikasi API tidak diubah langsung namun
 * memiliki rute yang terancam rusak oleh penghapusan/perubahan kolom di SQL.
 */
export function getApiCompatibilityStatus(
  apiIssuesCount: number,
  crossImpactsCount: number = 0
): {
  isCompatible: boolean;
  statusText: string;
  hasIndirectBreakage: boolean;
} {
  if (apiIssuesCount === 0) {
    if (crossImpactsCount > 0) {
      return {
        isCompatible: false,
        hasIndirectBreakage: true,
        statusText: `Kontrak berkas OpenAPI tidak mengalami perubahan langsung, namun terdapat ${crossImpactsCount} endpoint yang terancam rusak akibat perubahan skema SQL.`
      };
    }
    return {
      isCompatible: true,
      hasIndirectBreakage: false,
      statusText: 'Kontrak spesifikasi API sepenuhnya kompatibel ke belakang (backward-compatible).'
    };
  }

  return {
    isCompatible: false,
    hasIndirectBreakage: crossImpactsCount > 0,
    statusText: `Ditemukan ${apiIssuesCount} pelanggaran kontrak API langsung${
      crossImpactsCount > 0 ? ` dan ${crossImpactsCount} endpoint terdampak perubahan skema SQL` : ''
    }.`
  };
}
