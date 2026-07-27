import { describe, expect, it } from 'vitest'
import { duplicateSkipMessage, duplicateSkipReason } from '../duplicateSkipMessages'

describe('duplicateSkipMessages', () => {
  it('labels saved-library duplicates', () => {
    expect(duplicateSkipReason(true)).toBe('library')
    expect(duplicateSkipMessage('model.bbmodel', 'library')).toBe(
      'model.bbmodel — skipped: already in saved library',
    )
  })

  it('labels in-ZIP duplicates', () => {
    expect(duplicateSkipReason(false)).toBe('zip')
    expect(duplicateSkipMessage('pack__model.bbmodel', 'zip')).toBe(
      'pack__model.bbmodel — skipped: duplicate in this ZIP',
    )
  })
})
