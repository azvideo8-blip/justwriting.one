import { describe, it, expect } from 'vitest';
import {
  CENSUS_TABLES,
  TEST_FIXTURE_DOC_UUIDS,
  TEST_FIXTURE_USER_IDS,
  getFixtureFilter,
} from '../../../../scripts/postulates.mjs';

describe('AU-5: исключение тестовых фикстур из обхода базы в постулатах', () => {
  it('экспортирует известные идентификаторы фикстур rls.test.sql', () => {
    expect(TEST_FIXTURE_DOC_UUIDS).toContain('bob-doc-001');
    expect(TEST_FIXTURE_DOC_UUIDS).toContain('alice-tombstone-doc');
    expect(TEST_FIXTURE_DOC_UUIDS).toContain('rpc-counter-doc');
    expect(TEST_FIXTURE_DOC_UUIDS).toContain('quota-normal');

    expect(TEST_FIXTURE_USER_IDS).toContain('00000000-0000-0000-0000-000000000001');
    expect(TEST_FIXTURE_USER_IDS).toContain('00000000-0000-0000-0000-000000000002');
  });

  it('CENSUS_TABLES исключает тестовые фикстуры документов и пользователей', () => {
    const docCensus = CENSUS_TABLES.find(t => t.table === 'documents');
    expect(docCensus).toBeDefined();
    expect(docCensus!.unencrypted).toContain('bob-doc-001');
    expect(docCensus!.unencrypted).toContain('00000000-0000-0000-0000-000000000002');

    const draftCensus = CENSUS_TABLES.find(t => t.table === 'drafts');
    expect(draftCensus).toBeDefined();
    expect(draftCensus!.unencrypted).toContain('00000000-0000-0000-0000-000000000002');
  });

  it('getFixtureFilter генерирует предикат исключения фикстур для каждой таблицы', () => {
    expect(getFixtureFilter('documents')).toContain('bob-doc-001');
    expect(getFixtureFilter('versions')).toContain('bob-doc-001');
    expect(getFixtureFilter('drafts')).toContain('00000000-0000-0000-0000-000000000002');
  });
});
