import { describe, it, expect } from 'vitest';
import { parseOpenApiContent } from '../src/analyzer/apiParser';
import { compareOpenApiSpecs } from '../src/analyzer/apiDiff';
import { RiskLevel } from '../src/types';

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
});

describe('OpenAPI Breaking Changes Detector', () => {
  const baseSpec = {
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
    const headSpec = JSON.parse(JSON.stringify(baseSpec));
    delete headSpec.paths['/orders'];

    const result = compareOpenApiSpecs(baseSpec as any, headSpec);
    expect(result.passed).toBe(false);
    expect(result.criticalCount).toBe(1);
    expect(result.issues[0].ruleId).toBe('ENDPOINT_REMOVED');
    expect(result.issues[0].path).toBe('/orders');
  });

  it('harus mendeteksi penghapusan metode HTTP (METHOD_REMOVED)', () => {
    const headSpec = JSON.parse(JSON.stringify(baseSpec));
    delete headSpec.paths['/products'].post;

    const result = compareOpenApiSpecs(baseSpec as any, headSpec);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'METHOD_REMOVED')).toBe(true);
    expect(result.issues[0].method).toBe('POST');
  });

  it('harus mendeteksi penambahan parameter wajib baru (REQUIRED_PARAMETER_ADDED)', () => {
    const headSpec = JSON.parse(JSON.stringify(baseSpec));
    headSpec.paths['/products'].get.parameters.push({
      name: 'category_id',
      in: 'query',
      required: true
    });

    const result = compareOpenApiSpecs(baseSpec as any, headSpec);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'REQUIRED_PARAMETER_ADDED')).toBe(true);
    expect(result.issues[0].riskLevel).toBe(RiskLevel.CRITICAL);
  });

  it('harus mendeteksi penghapusan kode status keberhasilan (STATUS_CODE_REMOVED)', () => {
    const headSpec = JSON.parse(JSON.stringify(baseSpec));
    delete headSpec.paths['/products'].get.responses['200'];

    const result = compareOpenApiSpecs(baseSpec as any, headSpec);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'STATUS_CODE_REMOVED')).toBe(true);
  });

  it('harus mendeteksi penghapusan properti pada respons (RESPONSE_SCHEMA_CHANGED)', () => {
    const headSpec = JSON.parse(JSON.stringify(baseSpec));
    delete headSpec.paths['/products'].get.responses['200'].content['application/json'].schema.properties.name;

    const result = compareOpenApiSpecs(baseSpec as any, headSpec);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'RESPONSE_SCHEMA_CHANGED')).toBe(true);
    expect(result.issues[0].description).toContain("'name'");
  });

  it('harus mendeteksi perubahan tipe properti respons (PROPERTY_TYPE_CHANGED)', () => {
    const headSpec = JSON.parse(JSON.stringify(baseSpec));
    headSpec.paths['/products'].get.responses['200'].content['application/json'].schema.properties.price.type = 'string';

    const result = compareOpenApiSpecs(baseSpec as any, headSpec);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'PROPERTY_TYPE_CHANGED')).toBe(true);
  });

  it('harus lulus jika hanya menambahkan rute baru dan parameter opsional', () => {
    const headSpec = JSON.parse(JSON.stringify(baseSpec));
    // Tambah rute baru
    headSpec.paths['/customers'] = {
      get: { responses: { '200': { description: 'OK' } } }
    };
    // Tambah parameter opsional
    headSpec.paths['/products'].get.parameters.push({
      name: 'sort',
      in: 'query',
      required: false
    });

    const result = compareOpenApiSpecs(baseSpec as any, headSpec);
    expect(result.passed).toBe(true);
    expect(result.criticalCount).toBe(0);
    expect(result.issues.length).toBe(0);
  });
});
