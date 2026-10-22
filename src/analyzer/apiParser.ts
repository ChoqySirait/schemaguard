/**
 * Parser Spesifikasi OpenAPI (YAML / JSON)
 * Bertanggung jawab membaca, memvalidasi sintaks, dan menyusun struktur data
 * dokumen spesifikasi OpenAPI 3.x (dan Swagger 2.0) untuk analisis kompatibilitas API.
 */

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

export interface OpenApiParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie' | string;
  required?: boolean;
  description?: string;
  schema?: any;
}

export interface OpenApiMediaType {
  schema?: any;
}

export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description?: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
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
    schemas?: Record<string, any>;
  };
}

/**
 * Menguraikan string konten JSON atau YAML menjadi objek OpenApiSpec
 */
export function parseOpenApiContent(content: string): OpenApiSpec {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Konten spesifikasi OpenAPI kosong.');
  }

  let parsed: any;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      parsed = JSON.parse(trimmed);
    } catch (err: any) {
      throw new Error(`Gagal menguraikan JSON OpenAPI: ${err.message}`);
    }
  } else {
    try {
      parsed = YAML.parse(trimmed);
    } catch (err: any) {
      throw new Error(`Gagal menguraikan YAML OpenAPI: ${err.message}`);
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Format spesifikasi OpenAPI tidak valid: harus berupa objek.');
  }

  if (!parsed.openapi && !parsed.swagger) {
    throw new Error('Dokumen bukan spesifikasi OpenAPI atau Swagger yang valid (field openapi/swagger tidak ditemukan).');
  }

  parsed.paths = parsed.paths || {};

  return parsed as OpenApiSpec;
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

/**
 * Daftar metode HTTP standar yang dipindai
 */
export const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
