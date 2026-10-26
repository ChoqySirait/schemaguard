/**
 * Parser Spesifikasi OpenAPI (YAML / JSON)
 * Bertanggung jawab membaca, memvalidasi sintaks, menyelesaikan referensi skema lokal ($ref),
 * dan menyusun struktur data dokumen spesifikasi OpenAPI 3.x serta Swagger 2.0
 * untuk analisis kompatibilitas API dan pemetaan dampak silang (cross-impact).
 */

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

export interface OpenApiSchemaProperty {
  type?: string;
  format?: string;
  description?: string;
  $ref?: string;
  items?: OpenApiSchemaProperty;
  properties?: Record<string, OpenApiSchemaProperty>;
  required?: string[];
  enum?: (string | number | boolean)[];
  [key: string]: unknown;
}

export interface OpenApiSchemaObject {
  type?: string;
  format?: string;
  description?: string;
  $ref?: string;
  properties?: Record<string, OpenApiSchemaProperty>;
  required?: string[];
  items?: OpenApiSchemaProperty;
  allOf?: OpenApiSchemaObject[];
  oneOf?: OpenApiSchemaObject[];
  anyOf?: OpenApiSchemaObject[];
  [key: string]: unknown;
}

export interface OpenApiParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie' | string;
  required?: boolean;
  description?: string;
  schema?: OpenApiSchemaObject;
}

export interface OpenApiMediaType {
  schema?: OpenApiSchemaObject;
}

export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description?: string;
  content?: Record<string, OpenApiMediaType>;
  schema?: OpenApiSchemaObject; // Swagger 2.0 format
}

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
  tags?: string[];
}

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';

export interface OpenApiPathItem {
  summary?: string;
  description?: string;
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  delete?: OpenApiOperation;
  patch?: OpenApiOperation;
  options?: OpenApiOperation;
  head?: OpenApiOperation;
  parameters?: OpenApiParameter[];
}

export interface OpenApiSpec {
  openapi?: string;
  swagger?: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, OpenApiSchemaObject>;
  };
  definitions?: Record<string, OpenApiSchemaObject>; // Swagger 2.0
}

export interface EndpointOperationInfo {
  path: string;
  method: HttpMethod;
  operation: OpenApiOperation;
}

/**
 * Daftar metode HTTP standar yang dipindai
 */
export const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

/**
 * Menyelesaikan referensi skema lokal ($ref) seperti #/components/schemas/User atau #/definitions/User
 */
export function resolveSchemaRef(
  schema: OpenApiSchemaObject | OpenApiSchemaProperty | undefined,
  spec: OpenApiSpec
): OpenApiSchemaObject | undefined {
  if (!schema) return undefined;

  if (schema.$ref && typeof schema.$ref === 'string') {
    const ref = schema.$ref;
    if (ref.startsWith('#/components/schemas/')) {
      const schemaName = ref.replace('#/components/schemas/', '');
      const found = spec.components?.schemas?.[schemaName];
      if (found) {
        return resolveSchemaRef(found, spec);
      }
    } else if (ref.startsWith('#/definitions/')) {
      const defName = ref.replace('#/definitions/', '');
      const found = spec.definitions?.[defName];
      if (found) {
        return resolveSchemaRef(found, spec);
      }
    }
  }

  return schema as OpenApiSchemaObject;
}

/**
 * Mengekstrak seluruh daftar rute dan operasi yang terdaftar pada spesifikasi OpenAPI
 */
export function extractAllOperations(spec: OpenApiSpec): EndpointOperationInfo[] {
  const operations: EndpointOperationInfo[] = [];
  const paths = spec.paths || {};

  for (const pathKey of Object.keys(paths)) {
    const pathItem = paths[pathKey];
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      const op = pathItem[method as keyof OpenApiPathItem] as OpenApiOperation | undefined;
      if (op) {
        operations.push({
          path: pathKey,
          method,
          operation: op
        });
      }
    }
  }

  return operations;
}

/**
 * Menguraikan string konten JSON atau YAML menjadi objek OpenApiSpec
 */
export function parseOpenApiContent(content: string): OpenApiSpec {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Konten spesifikasi OpenAPI kosong.');
  }

  let parsed: Record<string, unknown> | null = null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Gagal menguraikan JSON OpenAPI: ${message}`);
    }
  } else {
    try {
      parsed = YAML.parse(trimmed) as Record<string, unknown>;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Gagal menguraikan YAML OpenAPI: ${message}`);
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Format spesifikasi OpenAPI tidak valid: harus berupa objek.');
  }

  if (!parsed.openapi && !parsed.swagger) {
    throw new Error(
      'Dokumen bukan spesifikasi OpenAPI atau Swagger yang valid (field openapi/swagger tidak ditemukan).'
    );
  }

  parsed.paths = (parsed.paths as Record<string, OpenApiPathItem>) || {};

  return parsed as unknown as OpenApiSpec;
}

/**
 * Membaca dan menguraikan berkas spesifikasi OpenAPI dari disk
 */
export function parseOpenApiFile(filePath: string): OpenApiSpec {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Berkas spesifikasi API tidak ditemukan: ${filePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  return parseOpenApiContent(content);
}
