import { describe, it, expect } from 'vitest'
import { historyColumns, generateHistoryColumns } from '@/db/history-columns'
import { iterations } from '@/db/schema'

describe('project history projection', () => {
  it('keeps the columns the workspace renders', () => {
    for (const k of [
      'id', 'projectId', 'userMessage', 'imageBlobUrl', 'jscadCode',
      'strategy', 'meshBlobUrl', 'status', 'error', 'slicedBlobUrl',
      'slicedMeta', 'slicedAt', 'baseMode', 'createdAt',
    ]) {
      expect(historyColumns).toHaveProperty(k)
    }
  })

  it('keeps validation_report (workspace needs design.kind + replay)', () => {
    expect(historyColumns).toHaveProperty('validationReport')
  })

  it('projects validation_report as a cache-stripped SQL expression, not the raw column', () => {
    // The raw column would be the iterations.validationReport reference; the
    // projection is a jsonb-minus-keys SQL expression, so they are not the same.
    expect(historyColumns.validationReport).not.toBe(iterations.validationReport)
  })

  it('drops the dead parent_iteration_id from list reads', () => {
    expect(historyColumns).not.toHaveProperty('parentIterationId')
  })
})

describe('generate-route history projection', () => {
  it('keeps the columns the generate route reads', () => {
    for (const k of [
      'id', 'projectId', 'userMessage', 'imageBlobUrl', 'imageDescription',
      'meshBlobUrl', 'status', 'createdAt',
    ]) {
      expect(generateHistoryColumns).toHaveProperty(k)
    }
  })

  it('strips ONLY _previews from validation_report — _faces stays for the segmentation cache', () => {
    expect(generateHistoryColumns.validationReport).not.toBe(iterations.validationReport)
    // Inspect the SQL string chunks (column refs are circular — no JSON.stringify):
    // the expression must subtract '_previews' but NOT '_faces'.
    const aliased = generateHistoryColumns.validationReport as unknown as {
      sql: { queryChunks: unknown[] }
    }
    const text = aliased.sql.queryChunks
      .map((c) => (c && typeof c === 'object' && 'value' in c ? String((c as { value: unknown }).value) : ''))
      .join(' ')
    expect(text).toContain('_previews')
    expect(text).not.toContain('_faces')
  })

  it('leaves heavy/unused columns out (lean read)', () => {
    for (const k of ['jscadCode', 'slicedMeta', 'slicedBlobUrl', 'error', 'parentIterationId']) {
      expect(generateHistoryColumns).not.toHaveProperty(k)
    }
  })
})
