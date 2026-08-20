import { describe, it, expect } from 'vitest'
import { buildCompactReferences, toReferenceRecordId, groupReferences } from './source-references'
import type { ReferenceData } from './source-references'

describe('buildCompactReferences', () => {
  it('replaces inline references with numbered citation links and appends no reference list', () => {
    const { markdown } = buildCompactReferences(
      'See [source:abc] and [note:xyz]. Also [source:abc] again.'
    )

    expect(markdown).toBe(
      'See [1](#ref-source-abc) and [2](#ref-note-xyz). Also [1](#ref-source-abc) again.'
    )
    // The old behaviour appended a "References:" text block — the redesign renders chips instead.
    expect(markdown).not.toContain('References')
  })

  it('returns the deduplicated references in first-seen order with stable numbers', () => {
    const { references } = buildCompactReferences(
      'See [source:abc] and [note:xyz]. Also [source:abc] again.'
    )

    expect(references).toEqual([
      { number: 1, type: 'source', id: 'abc' },
      { number: 2, type: 'note', id: 'xyz' },
    ])
  })

  it('normalises the insight alias to source_insight', () => {
    const { references } = buildCompactReferences('Per [insight:i1].')

    expect(references).toEqual([{ number: 1, type: 'source_insight', id: 'i1' }])
  })

  it('leaves reference-free text untouched and returns no references', () => {
    const { markdown, references } = buildCompactReferences('Plain answer with no citations.')

    expect(markdown).toBe('Plain answer with no citations.')
    expect(references).toEqual([])
  })
})

describe('toReferenceRecordId', () => {
  // The API resolves records by their full SurrealDB id (`table:id`); references
  // arrive with a bare id, so it must be qualified with its type before fetching.
  it('qualifies a bare reference id with its type table', () => {
    expect(toReferenceRecordId('source', 'abc123')).toBe('source:abc123')
    expect(toReferenceRecordId('note', 'n1')).toBe('note:n1')
    expect(toReferenceRecordId('source_insight', 'i1')).toBe('source_insight:i1')
  })

  it('leaves an already-qualified record id untouched', () => {
    expect(toReferenceRecordId('source', 'source:abc123')).toBe('source:abc123')
  })
})

describe('groupReferences', () => {
  it('groups by type in first-seen order, keeping members in citation-number order', () => {
    const refs: ReferenceData[] = [
      { number: 1, type: 'source', id: 'a' },
      { number: 2, type: 'note', id: 'b' },
      { number: 3, type: 'source', id: 'c' },
      { number: 4, type: 'source_insight', id: 'd' },
    ]

    expect(groupReferences(refs)).toEqual([
      {
        type: 'source',
        members: [
          { number: 1, type: 'source', id: 'a' },
          { number: 3, type: 'source', id: 'c' },
        ],
      },
      { type: 'note', members: [{ number: 2, type: 'note', id: 'b' }] },
      { type: 'source_insight', members: [{ number: 4, type: 'source_insight', id: 'd' }] },
    ])
  })

  it('returns an empty array when there are no references', () => {
    expect(groupReferences([])).toEqual([])
  })
})
