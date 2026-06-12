import { describe, it, expect } from 'vitest'
import { historyColumns } from '@/db/history-columns'
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
