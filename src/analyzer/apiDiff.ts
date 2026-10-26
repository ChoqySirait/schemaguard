/**
 * Mesin Kompatibilitas Kontrak API (OpenAPI Diff Engine)
 * Membandingkan dua spesifikasi OpenAPI (base vs head) untuk mendeteksi
 * perubahan kontrak yang memutus kompatibilitas ke belakang (breaking changes).
 *
 * Mendukung deteksi penghapusan rute, penghapusan metode HTTP, penambahan parameter wajib,
 * penghapusan status code sukses (2xx), resolusi skema komponen ($ref),
 * dan pemutusan tipe properti respons atau array items.
 */

import { ApiIssue, RiskLevel } from '../types';
import {
  HTTP_METHODS,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiSchemaObject,
  OpenApiSpec,
  parseOpenApiFile,
  resolveSchemaRef
} from './apiParser';

export interface ApiAnalysisResult {
  issues: ApiIssue[];
  criticalCount: number;
  warningCount: number;
  safeCount: number;
  passed: boolean;
}

/**
 * Membandingkan dua skema respons (termasuk resolusi $ref dan array items)
 * untuk mendeteksi perubahan tipe properti atau penghapusan properti.
 */
export function compareResponseSchemas(
  rawBaseSchema: OpenApiSchemaObject | undefined,
  rawHeadSchema: OpenApiSchemaObject | undefined,
  path: string,
  method: string,
  statusCode: string,
  baseSpec?: OpenApiSpec,
  headSpec?: OpenApiSpec
): ApiIssue[] {
  const issues: ApiIssue[] = [];
  if (!rawBaseSchema || !rawHeadSchema) {
    return issues;
  }

  // Selesaikan referensi skema jika menggunakan $ref
  const baseSchema = baseSpec ? resolveSchemaRef(rawBaseSchema, baseSpec) : rawBaseSchema;
  const headSchema = headSpec ? resolveSchemaRef(rawHeadSchema, headSpec) : rawHeadSchema;

  if (!baseSchema || !headSchema) {
    return issues;
  }

  // 1. Jika tipe data level atas diubah (misal: object -> array atau string)
  if (baseSchema.type && headSchema.type && baseSchema.type !== headSchema.type) {
    issues.push({
      ruleId: 'RESPONSE_SCHEMA_CHANGED',
      path,
      method: method.toUpperCase(),
      riskLevel: RiskLevel.CRITICAL,
      description: `Tipe respons pada kode status ${statusCode} berubah dari '${baseSchema.type}' menjadi '${headSchema.type}'.`,
      details: `Perubahan skema dasar merusak deserialisasi data pada klien lama.`
    });
    return issues;
  }

  // 2. Evaluasi properti skema objek
  const baseProps = baseSchema.properties || {};
  const headProps = headSchema.properties || {};

  for (const propName of Object.keys(baseProps)) {
    const baseProp = baseProps[propName];
    const headProp = headProps[propName];

    if (!headProp) {
      // Properti yang sebelumnya ada dihapus dari respons
      issues.push({
        ruleId: 'RESPONSE_SCHEMA_CHANGED',
        path,
        method: method.toUpperCase(),
        riskLevel: RiskLevel.CRITICAL,
        property: propName,
        description: `Properti '${propName}' pada respons ${statusCode} telah dihapus.`,
        details: `Klien yang mengandalkan properti '${propName}' akan mengalami kegagalan parsing.`
      });
    } else if (baseProp) {
      // Periksa perubahan tipe data primitif properti
      const basePropType = baseProp.type;
      const headPropType = headProp.type;
      if (basePropType && headPropType && basePropType !== headPropType) {
        issues.push({
          ruleId: 'PROPERTY_TYPE_CHANGED',
          path,
          method: method.toUpperCase(),
          riskLevel: RiskLevel.CRITICAL,
          property: propName,
          description: `Tipe data untuk properti '${propName}' pada respons ${statusCode} berubah dari '${basePropType}' ke '${headPropType}'.`,
          details: `Perubahan tipe data properti menyebabkan runtime type error di klien.`
        });
      }
    }
  }

  // 3. Evaluasi skema item array jika tipe adalah array
  if (baseSchema.type === 'array' && headSchema.type === 'array' && baseSchema.items && headSchema.items) {
    const itemIssues = compareResponseSchemas(
      baseSchema.items as OpenApiSchemaObject,
      headSchema.items as OpenApiSchemaObject,
      path,
      method,
      statusCode,
      baseSpec,
      headSpec
    );
    issues.push(...itemIssues);
  }

  return issues;
}

/**
 * Memeriksa parameter permintaan antara versi dasar dan target
 */
export function compareParameters(
  baseParams: OpenApiParameter[] = [],
  headParams: OpenApiParameter[] = [],
  path: string,
  method: string
): ApiIssue[] {
  const issues: ApiIssue[] = [];
  const baseParamMap = new Map<string, OpenApiParameter>();

  for (const p of baseParams) {
    baseParamMap.set(`${p.in}:${p.name}`, p);
  }

  for (const headParam of headParams) {
    const key = `${headParam.in}:${headParam.name}`;
    const baseParam = baseParamMap.get(key);

    // Kasus 1: Parameter baru ditambahkan dan bersifat wajib (required: true)
    if (!baseParam && headParam.required) {
      issues.push({
        ruleId: 'REQUIRED_PARAMETER_ADDED',
        path,
        method: method.toUpperCase(),
        riskLevel: RiskLevel.CRITICAL,
        property: headParam.name,
        description: `Parameter wajib baru '${headParam.name}' (${headParam.in}) ditambahkan ke ${method.toUpperCase()} ${path}.`,
        details: `Klien lama yang memanggil endpoint tanpa parameter ini akan menerima respons 400 Bad Request.`
      });
    }

    // Kasus 2: Parameter opsional diubah menjadi wajib
    if (baseParam && !baseParam.required && headParam.required) {
      issues.push({
        ruleId: 'REQUIRED_PARAMETER_ADDED',
        path,
        method: method.toUpperCase(),
        riskLevel: RiskLevel.CRITICAL,
        property: headParam.name,
        description: `Parameter '${headParam.name}' (${headParam.in}) diubah dari opsional menjadi wajib pada ${method.toUpperCase()} ${path}.`,
        details: `Permintaan dari versi lama tanpa parameter ini akan ditolak server.`
      });
    }
  }

  return issues;
}

/**
 * Membandingkan satu operasi endpoint spesifik antara base dan head
 */
export function compareOperation(
  baseOp: OpenApiOperation,
  headOp: OpenApiOperation,
  path: string,
  method: string,
  baseSpec?: OpenApiSpec,
  headSpec?: OpenApiSpec
): ApiIssue[] {
  const issues: ApiIssue[] = [];

  // 1. Evaluasi parameter
  issues.push(...compareParameters(baseOp.parameters, headOp.parameters, path, method));

  // 2. Evaluasi request body: jika tadinya opsional atau tidak ada, lalu menjadi wajib
  const baseReqRequired = baseOp.requestBody?.required === true;
  const headReqRequired = headOp.requestBody?.required === true;
  if (!baseReqRequired && headReqRequired) {
    issues.push({
      ruleId: 'REQUIRED_PARAMETER_ADDED',
      path,
      method: method.toUpperCase(),
      riskLevel: RiskLevel.CRITICAL,
      description: `Request body pada ${method.toUpperCase()} ${path} diubah menjadi wajib (required: true).`,
      details: `Permintaan lama tanpa payload body akan ditolak.`
    });
  }

  // 3. Evaluasi responses
  const baseResponses = baseOp.responses || {};
  const headResponses = headOp.responses || {};

  for (const statusCode of Object.keys(baseResponses)) {
    // Periksa apakah kode status keberhasilan (2xx) dihapus
    if (statusCode.startsWith('2')) {
      if (!headResponses[statusCode]) {
        issues.push({
          ruleId: 'STATUS_CODE_REMOVED',
          path,
          method: method.toUpperCase(),
          riskLevel: RiskLevel.CRITICAL,
          description: `Kode status respons keberhasilan '${statusCode}' dihapus dari ${method.toUpperCase()} ${path}.`,
          details: `Klien yang memvalidasi atau berekspektasi terhadap status code ${statusCode} akan mengalami error.`
        });
        continue;
      }

      // Bandingkan skema konten respons jika ada (OpenAPI 3.x application/json)
      const baseContent = baseResponses[statusCode]?.content?.['application/json'];
      const headContent = headResponses[statusCode]?.content?.['application/json'];

      if (baseContent?.schema && headContent?.schema) {
        issues.push(
          ...compareResponseSchemas(
            baseContent.schema,
            headContent.schema,
            path,
            method,
            statusCode,
            baseSpec,
            headSpec
          )
        );
      } else if (baseResponses[statusCode]?.schema && headResponses[statusCode]?.schema) {
        // Dukungan Swagger 2.0 schema langsung di bawah respons
        issues.push(
          ...compareResponseSchemas(
            baseResponses[statusCode].schema,
            headResponses[statusCode].schema,
            path,
            method,
            statusCode,
            baseSpec,
            headSpec
          )
        );
      }
    }
  }

  return issues;
}

/**
 * Membandingkan dua objek OpenApiSpec secara utuh
 */
export function compareOpenApiSpecs(
  baseSpec: OpenApiSpec,
  headSpec: OpenApiSpec
): ApiAnalysisResult {
  const issues: ApiIssue[] = [];

  const basePaths = baseSpec.paths || {};
  const headPaths = headSpec.paths || {};

  // Periksa rute yang ada di base
  for (const pathKey of Object.keys(basePaths)) {
    const basePathItem = basePaths[pathKey];
    const headPathItem = headPaths[pathKey];

    // Deteksi jika seluruh rute dihapus
    if (!headPathItem) {
      issues.push({
        ruleId: 'ENDPOINT_REMOVED',
        path: pathKey,
        riskLevel: RiskLevel.CRITICAL,
        description: `Rute API '${pathKey}' telah dihapus dari spesifikasi.`,
        details: `Semua pemanggilan ke rute ini akan menghasilkan respons 404 Not Found.`
      });
      continue;
    }

    // Periksa metode HTTP yang ada pada rute tersebut
    for (const method of HTTP_METHODS) {
      const baseOp = basePathItem[method as keyof OpenApiPathItem] as OpenApiOperation | undefined;
      const headOp = headPathItem[method as keyof OpenApiPathItem] as OpenApiOperation | undefined;

      if (baseOp && !headOp) {
        // Metode HTTP dihapus dari rute
        issues.push({
          ruleId: 'METHOD_REMOVED',
          path: pathKey,
          method: method.toUpperCase(),
          riskLevel: RiskLevel.CRITICAL,
          description: `Metode HTTP '${method.toUpperCase()}' dihapus dari rute '${pathKey}'.`,
          details: `Pemanggilan dengan metode ini akan menghasilkan respons 405 Method Not Allowed.`
        });
      } else if (baseOp && headOp) {
        // Bandingkan detail endpoint yang sama
        issues.push(...compareOperation(baseOp, headOp, pathKey, method, baseSpec, headSpec));
      }
    }
  }

  let criticalCount = 0;
  let warningCount = 0;
  let safeCount = 0;

  for (const issue of issues) {
    if (issue.riskLevel === RiskLevel.CRITICAL) {
      criticalCount++;
    } else if (issue.riskLevel === RiskLevel.WARNING) {
      warningCount++;
    } else {
      safeCount++;
    }
  }

  return {
    issues,
    criticalCount,
    warningCount,
    safeCount,
    passed: criticalCount === 0
  };
}

/**
 * Membandingkan dua berkas spesifikasi OpenAPI dari disk
 */
export function compareOpenApiFiles(
  baseFilePath: string,
  headFilePath: string
): ApiAnalysisResult {
  const baseSpec = parseOpenApiFile(baseFilePath);
  const headSpec = parseOpenApiFile(headFilePath);
  return compareOpenApiSpecs(baseSpec, headSpec);
}
