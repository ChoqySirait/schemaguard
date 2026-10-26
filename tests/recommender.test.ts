import { describe, it, expect } from 'vitest';
import { RiskLevel, DatabaseIssue, ApiIssue } from '../src/types';
import {
  generateRecommendationForDatabaseIssue,
  generateRecommendationForApiIssue,
  generateDatabaseRecommendations,
  generateApiRecommendations,
  generateAllRecommendations,
  createDropTableRecommendation,
  createDropColumnRecommendation,
  createAlterColumnTypeRecommendation,
  createRenameColumnRecommendation,
  createAddNotNullRecommendation,
  createIndexRecommendation,
  createRenameTableRecommendation,
  createAddColumnWithDefaultRecommendation,
  createValidateConstraintRecommendation,
  createApiBreakingChangeRecommendation
} from '../src/recommender/expandContract';

describe('Recommender Templates (Expand and Contract)', () => {
  it('harus menghasilkan rekomendasi pola Expand and Contract untuk DROP TABLE', () => {
    const rec = createDropTableRecommendation({ table: 'users' });
    expect(rec.issueId).toBe('DROP_TABLE');
    expect(rec.target).toBe('users');
    expect(rec.expandPhase.phase).toBe(1);
    expect(rec.expandPhase.script).toContain('users_archived_');
    expect(rec.contractPhase.phase).toBe(2);
    expect(rec.contractPhase.script).toContain('DROP TABLE IF EXISTS users');
    expect(rec.transitionNotes.length).toBeGreaterThan(0);
  });

  it('harus menghasilkan rekomendasi dua fase untuk DROP COLUMN', () => {
    const rec = createDropColumnRecommendation({ table: 'users', column: 'avatar' });
    expect(rec.issueId).toBe('DROP_COLUMN');
    expect(rec.target).toBe('users.avatar');
    expect(rec.expandPhase.script).toContain('DROP NOT NULL');
    expect(rec.contractPhase.script).toContain('DROP COLUMN IF EXISTS avatar');
  });

  it('harus menghasilkan rekomendasi shadow column untuk ALTER COLUMN TYPE', () => {
    const rec = createAlterColumnTypeRecommendation({
      table: 'orders',
      column: 'amount',
      newDataType: 'BIGINT'
    });
    expect(rec.issueId).toBe('ALTER_COLUMN_TYPE');
    expect(rec.target).toBe('orders.amount');
    expect(rec.expandPhase.script).toContain('amount_new BIGINT');
    expect(rec.contractPhase.script).toContain('RENAME COLUMN amount_new TO amount');
  });

  it('harus menghasilkan rekomendasi untuk RENAME COLUMN', () => {
    const rec = createRenameColumnRecommendation({
      table: 'accounts',
      column: 'usr_nm',
      oldColumn: 'usr_nm',
      newColumn: 'username',
      dataType: 'VARCHAR(100)'
    });
    expect(rec.issueId).toBe('RENAME_COLUMN');
    expect(rec.expandPhase.script).toContain('ADD COLUMN IF NOT EXISTS username');
    expect(rec.contractPhase.script).toContain('DROP COLUMN IF EXISTS usr_nm');
  });

  it('harus menghasilkan rekomendasi nilai bawaan untuk ADD NOT NULL WITHOUT DEFAULT', () => {
    const rec = createAddNotNullRecommendation({
      table: 'profiles',
      column: 'status',
      dataType: 'VARCHAR(20)',
      defaultValue: "'ACTIVE'"
    });
    expect(rec.issueId).toBe('ADD_NOT_NULL_WITHOUT_DEFAULT');
    expect(rec.expandPhase.script).toContain("DEFAULT 'ACTIVE'");
    expect(rec.contractPhase.script).toContain('SET NOT NULL');
  });

  it('harus menghasilkan rekomendasi CONCURRENTLY untuk CREATE INDEX', () => {
    const rec = createIndexRecommendation({
      indexName: 'idx_orders_created',
      table: 'orders',
      columns: 'created_at'
    });
    expect(rec.issueId).toBe('CREATE_INDEX_NON_CONCURRENTLY');
    expect(rec.expandPhase.script).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_created');
  });

  it('harus menghasilkan rekomendasi VIEW jembatan untuk RENAME TABLE', () => {
    const rec = createRenameTableRecommendation({
      table: 'old_logs',
      newTable: 'system_logs'
    });
    expect(rec.issueId).toBe('RENAME_TABLE');
    expect(rec.expandPhase.script).toContain('CREATE VIEW old_logs AS SELECT * FROM system_logs');
    expect(rec.contractPhase.script).toContain('DROP VIEW IF EXISTS old_logs');
  });

  it('harus menghasilkan rekomendasi backfill bertahap untuk ADD_COLUMN_WITH_DEFAULT', () => {
    const rec = createAddColumnWithDefaultRecommendation({
      table: 'audit_logs',
      column: 'logged_at',
      dataType: 'TIMESTAMP'
    });
    expect(rec.issueId).toBe('ADD_COLUMN_WITH_DEFAULT');
    expect(rec.expandPhase.script).toContain('ADD COLUMN IF NOT EXISTS logged_at TIMESTAMP NULL');
    expect(rec.expandPhase.script).toContain('UPDATE audit_logs SET logged_at = now()');
    expect(rec.contractPhase.script).toContain('ALTER COLUMN logged_at SET DEFAULT now()');
  });

  it('harus menghasilkan rekomendasi dua tahap NOT VALID untuk VALIDATE_CONSTRAINT', () => {
    const rec = createValidateConstraintRecommendation({
      table: 'order_items',
      constraintName: 'fk_order_id'
    });
    expect(rec.issueId).toBe('VALIDATE_CONSTRAINT');
    expect(rec.expandPhase.script).toContain('NOT VALID');
    expect(rec.contractPhase.script).toContain('VALIDATE CONSTRAINT fk_order_id');
  });

  it('harus menghasilkan rekomendasi transisi Sunset untuk API Breaking Changes', () => {
    const rec = createApiBreakingChangeRecommendation({
      path: '/api/v1/users',
      method: 'DELETE',
      details: 'Rute dihapus.'
    });
    expect(rec.issueId).toBe('API_BREAKING_CHANGE');
    expect(rec.expandPhase.script).toContain('Sunset');
    expect(rec.contractPhase.script).toContain('410');
  });
});

describe('Recommender Engine', () => {
  it('harus menghasilkan rekomendasi tepat dari DatabaseIssue DROP_TABLE', () => {
    const issue: DatabaseIssue = {
      ruleId: 'DROP_TABLE',
      ruleName: 'Drop Table Statement',
      description: 'Menghapus tabel',
      statement: 'DROP TABLE customers;',
      riskLevel: RiskLevel.CRITICAL,
      table: 'customers'
    };

    const rec = generateRecommendationForDatabaseIssue(issue);
    expect(rec.issueId).toBe('DROP_TABLE');
    expect(rec.target).toBe('customers');
  });

  it('harus menghasilkan rekomendasi dari DatabaseIssue ALTER_COLUMN_TYPE dengan parsing tipe', () => {
    const issue: DatabaseIssue = {
      ruleId: 'ALTER_COLUMN_TYPE',
      ruleName: 'Alter Column Type',
      description: 'Mengubah tipe',
      statement: 'ALTER TABLE products ALTER COLUMN price TYPE NUMERIC(10,2);',
      riskLevel: RiskLevel.CRITICAL,
      table: 'products',
      column: 'price'
    };

    const rec = generateRecommendationForDatabaseIssue(issue);
    expect(rec.issueId).toBe('ALTER_COLUMN_TYPE');
    expect(rec.expandPhase.script).toContain('price_new NUMERIC(10,2)');
  });

  it('harus menghasilkan rekomendasi mitigasi untuk ADD_COLUMN_WITH_DEFAULT', () => {
    const issue: DatabaseIssue = {
      ruleId: 'ADD_COLUMN_WITH_DEFAULT',
      ruleName: 'Add Column With Default',
      description: 'Default volatile',
      statement: 'ALTER TABLE events ADD COLUMN created_at TIMESTAMP DEFAULT now();',
      riskLevel: RiskLevel.WARNING,
      table: 'events',
      column: 'created_at'
    };

    const rec = generateRecommendationForDatabaseIssue(issue);
    expect(rec.issueId).toBe('ADD_COLUMN_WITH_DEFAULT');
    expect(rec.target).toBe('events.created_at');
  });

  it('harus menghasilkan rekomendasi mitigasi untuk VALIDATE_CONSTRAINT', () => {
    const issue: DatabaseIssue = {
      ruleId: 'VALIDATE_CONSTRAINT',
      ruleName: 'Validate Constraint',
      description: 'Constraint tanpa not valid',
      statement: 'ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);',
      riskLevel: RiskLevel.WARNING,
      table: 'orders',
      column: 'fk_user'
    };

    const rec = generateRecommendationForDatabaseIssue(issue);
    expect(rec.issueId).toBe('VALIDATE_CONSTRAINT');
    expect(rec.target).toBe('orders.fk_user');
  });

  it('harus menghasilkan rekomendasi dari ApiIssue', () => {
    const issue: ApiIssue = {
      ruleId: 'ENDPOINT_REMOVED',
      path: '/api/v1/checkout',
      method: 'POST',
      riskLevel: RiskLevel.CRITICAL,
      description: 'Endpoint checkout dihapus'
    };

    const rec = generateRecommendationForApiIssue(issue);
    expect(rec.target).toBe('POST /api/v1/checkout');
    expect(rec.expandPhase.script).toContain('Sunset');
  });

  it('harus mengabaikan issue berisiko SAFE pada generateDatabaseRecommendations', () => {
    const issues: DatabaseIssue[] = [
      {
        ruleId: 'DROP_TABLE',
        ruleName: 'Drop Table',
        description: 'Drop',
        statement: 'DROP TABLE t1;',
        riskLevel: RiskLevel.CRITICAL,
        table: 't1'
      },
      {
        ruleId: 'SAFE_OP',
        ruleName: 'Safe Op',
        description: 'Safe',
        statement: 'SELECT 1;',
        riskLevel: RiskLevel.SAFE,
        table: 't2'
      }
    ];

    const recs = generateDatabaseRecommendations(issues);
    expect(recs.length).toBe(1);
    expect(recs[0].target).toBe('t1');
  });

  it('harus memfilter isu aman pada generateApiRecommendations', () => {
    const issues: ApiIssue[] = [
      {
        ruleId: 'ENDPOINT_REMOVED',
        path: '/v1/users',
        method: 'DELETE',
        riskLevel: RiskLevel.CRITICAL,
        description: 'Endpoint dihapus'
      },
      {
        ruleId: 'SAFE_PARAM',
        path: '/v1/items',
        method: 'GET',
        riskLevel: RiskLevel.SAFE,
        description: 'Parameter opsional baru'
      }
    ];

    const recs = generateApiRecommendations(issues);
    expect(recs.length).toBe(1);
    expect(recs[0].target).toBe('DELETE /v1/users');
  });

  it('harus menggabungkan seluruh rekomendasi dengan generateAllRecommendations', () => {
    const dbIssues: DatabaseIssue[] = [
      {
        ruleId: 'DROP_COLUMN',
        ruleName: 'Drop Col',
        description: 'Drop',
        statement: 'ALTER TABLE users DROP COLUMN bio;',
        riskLevel: RiskLevel.CRITICAL,
        table: 'users',
        column: 'bio'
      }
    ];

    const apiIssues: ApiIssue[] = [
      {
        ruleId: 'REQUIRED_PARAMETER_ADDED',
        path: '/users',
        method: 'GET',
        riskLevel: RiskLevel.CRITICAL,
        description: 'Param api_key required'
      }
    ];

    const recs = generateAllRecommendations({
      databaseIssues: dbIssues,
      apiIssues
    });

    expect(recs.length).toBe(2);
    expect(recs[0].issueId).toBe('DROP_COLUMN');
    expect(recs[1].issueId).toBe('API_BREAKING_CHANGE');
  });
});
