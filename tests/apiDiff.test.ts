import { describe, it, expect } from 'vitest';
import {
  OpenApiSpec,
  parseOpenApiContent,
  resolveSchemaRef
} from '../src/analyzer/apiParser';
import { compareOpenApiSpecs } from '../src/analyzer/apiDiff';
import { mapCrossImpact } from '../src/analyzer/crossImpact';
import { DatabaseIssue, RiskLevel } from '../src/types';

describe('OpenAPI Parser', () => {
  it('harus berhasil mengurai spesifikasi format JSON', () => {
    const jsonSpec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/users': {
          get: { responses: { '200': { description: 'Success' } } }
        }
      }
    });

    const parsed = parseOpenApiContent(jsonSpec);
    expect(parsed.info.title).toBe('Test API');
    expect(parsed.paths['/users']?.get).toBeDefined();
  });

  it('harus berhasil mengurai spesifikasi format YAML', () => {
    const yamlSpec = `
openapi: 3.0.0
info:
  title: YAML API
  version: 1.0.0
paths:
  /orders:
    post:
      summary: Buat pesanan
      responses:
        '201':
          description: Created
    `;

    const parsed = parseOpenApiContent(yamlSpec);
    expect(parsed.info.title).toBe('YAML API');
    expect(parsed.paths['/orders']?.post?.summary).toBe('Buat pesanan');
  });

  it('harus menyelesaikan referensi komponen ($ref) secara rekursif', () => {
    const spec: OpenApiSpec = {
      openapi: '3.0.0',
      info: { title: 'Ref API', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' }
            }
          }
        }
      }
    };

    const resolved = resolveSchemaRef({ $ref: '#/components/schemas/User' }, spec);
    expect(resolved).toBeDefined();
    expect(resolved?.properties?.email?.type).toBe('string');
  });
});

describe('OpenAPI Breaking Changes Detector', () => {
  const baseSpec: OpenApiSpec = {
    openapi: '3.0.0',
    info: { title: 'Store API', version: '1.0.0' },
    paths: {
      '/products': {
        get: {
          summary: 'Daftar produk',
          parameters: [
            { name: 'limit', in: 'query', required: false }
          ],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      price: { type: 'number' }
                    }
                  }
                }
              }
            }
          }
        },
        post: {
          summary: 'Tambah produk',
          responses: {
            '201': { description: 'Created' }
          }
        }
      },
      '/orders': {
        get: {
          responses: {
            '200': { description: 'Daftar order' }
          }
        }
      }
    }
  };

  it('harus mendeteksi penghapusan endpoint (ENDPOINT_REMOVED)', () => {
    const headSpec: OpenApiSpec = JSON.parse(JSON.stringify(baseSpec));
    delete headSpec.paths['/orders'];

    const result = compareOpenApiSpecs(baseSpec, headSpec);
    expect(result.passed).toBe(false);
    expect(result.criticalCount).toBe(1);
    expect(result.issues[0].ruleId).toBe('ENDPOINT_REMOVED');
    expect(result.issues[0].path).toBe('/orders');
  });

  it('harus mendeteksi penghapusan metode HTTP (METHOD_REMOVED)', () => {
    const headSpec: OpenApiSpec = JSON.parse(JSON.stringify(baseSpec));
    delete headSpec.paths['/products'].post;

    const result = compareOpenApiSpecs(baseSpec, headSpec);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'METHOD_REMOVED')).toBe(true);
    expect(result.issues[0].method).toBe('POST');
  });

  it('harus mendeteksi penambahan parameter wajib baru (REQUIRED_PARAMETER_ADDED)', () => {
    const headSpec: OpenApiSpec = JSON.parse(JSON.stringify(baseSpec));
    headSpec.paths['/products'].get?.parameters?.push({
      name: 'category_id',
      in: 'query',
      required: true
    });

    const result = compareOpenApiSpecs(baseSpec, headSpec);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'REQUIRED_PARAMETER_ADDED')).toBe(true);
    expect(result.issues[0].riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('harus mendeteksi request body yang berubah menjadi wajib (REQUIRED_PARAMETER_ADDED)', () => {
    const headSpec: OpenApiSpec = JSON.parse(JSON.stringify(baseSpec));
    if (headSpec.paths['/products'].post) {
      headSpec.paths['/products'].post.requestBody = {
        required: true,
        content: { 'application/json': {} }
      };
    }

    const result = compareOpenApiSpecs(baseSpec, headSpec);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'REQUIRED_PARAMETER_ADDED')).toBe(true);
  });

  it('harus mendeteksi penghapusan kode status keberhasilan (STATUS_CODE_REMOVED)', () => {
    const headSpec: OpenApiSpec = JSON.parse(JSON.stringify(baseSpec));
    if (headSpec.paths['/products'].get?.responses) {
      delete headSpec.paths['/products'].get.responses['200'];
    }

    const result = compareOpenApiSpecs(baseSpec, headSpec);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'STATUS_CODE_REMOVED')).toBe(true);
  });

  it('harus mendeteksi penghapusan properti pada respons (RESPONSE_SCHEMA_CHANGED)', () => {
    const headSpec: OpenApiSpec = JSON.parse(JSON.stringify(baseSpec));
    const schema = headSpec.paths['/products'].get?.responses?.['200']?.content?.['application/json']?.schema;
    if (schema?.properties) {
      delete schema.properties.name;
    }

    const result = compareOpenApiSpecs(baseSpec, headSpec);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'RESPONSE_SCHEMA_CHANGED')).toBe(true);
    expect(result.issues[0].description).toContain("'name'");
  });

  it('harus mendeteksi perubahan tipe properti respons (PROPERTY_TYPE_CHANGED)', () => {
    const headSpec: OpenApiSpec = JSON.parse(JSON.stringify(baseSpec));
    const schema = headSpec.paths['/products'].get?.responses?.['200']?.content?.['application/json']?.schema;
    if (schema?.properties?.price) {
      schema.properties.price.type = 'string';
    }

    const result = compareOpenApiSpecs(baseSpec, headSpec);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'PROPERTY_TYPE_CHANGED')).toBe(true);
  });

  it('harus mendeteksi breaking change pada properti dalam array items', () => {
    const arrayBaseSpec: OpenApiSpec = {
      openapi: '3.0.0',
      info: { title: 'Items API', version: '1.0.0' },
      paths: {
        '/items': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          sku: { type: 'string' }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };

    const arrayHeadSpec: OpenApiSpec = JSON.parse(JSON.stringify(arrayBaseSpec));
    const itemsSchema = arrayHeadSpec.paths['/items'].get?.responses?.['200']?.content?.['application/json']?.schema?.items;
    if (itemsSchema?.properties) {
      delete itemsSchema.properties.sku;
    }

    const result = compareOpenApiSpecs(arrayBaseSpec, arrayHeadSpec);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'RESPONSE_SCHEMA_CHANGED')).toBe(true);
  });

  it('harus lulus jika hanya menambahkan rute baru dan parameter opsional', () => {
    const headSpec: OpenApiSpec = JSON.parse(JSON.stringify(baseSpec));
    // Tambah rute baru
    headSpec.paths['/customers'] = {
      get: { responses: { '200': { description: 'OK' } } }
    };
    // Tambah parameter opsional
    headSpec.paths['/products'].get?.parameters?.push({
      name: 'sort',
      in: 'query',
      required: false
    });

    const result = compareOpenApiSpecs(baseSpec, headSpec);
    expect(result.passed).toBe(true);
    expect(result.criticalCount).toBe(0);
    expect(result.issues.length).toBe(0);
  });
});

describe('Cross-Impact Mapper (SQL to OpenAPI)', () => {
  const apiSpec: OpenApiSpec = {
    openapi: '3.0.0',
    info: { title: 'User Service', version: '1.0.0' },
    paths: {
      '/api/users': {
        get: {
          summary: 'Ambil daftar pengguna',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      phone: { type: 'string' },
                      avatarUrl: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  };

  it('harus memetakan DROP COLUMN ke endpoint yang mengembalikan properti tersebut', () => {
    const dbIssues: DatabaseIssue[] = [
      {
        ruleId: 'DROP_COLUMN',
        ruleName: 'Drop Column Statement',
        description: 'Menghapus kolom',
        statement: 'ALTER TABLE users DROP COLUMN phone;',
        riskLevel: RiskLevel.CRITICAL,
        table: 'users',
        column: 'phone'
      }
    ];

    const links = mapCrossImpact(dbIssues, apiSpec);
    expect(links.length).toBe(1);
    expect(links[0].sqlTable).toBe('users');
    expect(links[0].sqlColumn).toBe('phone');
    expect(links[0].apiPath).toBe('/api/users');
    expect(links[0].apiMethod).toBe('GET');
    expect(links[0].propertyName).toBe('phone');
    expect(links[0].impactDescription).toContain("Kolom 'users.phone' dihapus");
  });

  it('harus memetakan format snake_case SQL ke camelCase API (avatar_url <-> avatarUrl)', () => {
    const dbIssues: DatabaseIssue[] = [
      {
        ruleId: 'ALTER_COLUMN_TYPE',
        ruleName: 'Alter Column Type',
        description: 'Ubah tipe',
        statement: 'ALTER TABLE users ALTER COLUMN avatar_url TYPE text;',
        riskLevel: RiskLevel.CRITICAL,
        table: 'users',
        column: 'avatar_url'
      }
    ];

    const links = mapCrossImpact(dbIssues, apiSpec);
    expect(links.length).toBe(1);
    expect(links[0].sqlColumn).toBe('avatar_url');
    expect(links[0].propertyName).toBe('avatarUrl');
    expect(links[0].apiPath).toBe('/api/users');
  });

  it('tidak boleh menghasilkan keterkaitan jika kolom SQL tidak digunakan di API', () => {
    const dbIssues: DatabaseIssue[] = [
      {
        ruleId: 'DROP_COLUMN',
        ruleName: 'Drop Column Statement',
        description: 'Menghapus kolom internal',
        statement: 'ALTER TABLE users DROP COLUMN internal_secret_hash;',
        riskLevel: RiskLevel.CRITICAL,
        table: 'users',
        column: 'internal_secret_hash'
      }
    ];

    const links = mapCrossImpact(dbIssues, apiSpec);
    expect(links.length).toBe(0);
  });
});
