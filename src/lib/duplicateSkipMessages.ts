export type DuplicateSkipReason = 'zip' | 'library'

export function duplicateSkipMessage(filename: string, reason: DuplicateSkipReason): string {
  const detail =
    reason === 'zip' ? 'skipped: duplicate in this ZIP' : 'skipped: already in saved library'
  return `${filename} — ${detail}`
}

export function duplicateSkipReason(inLibrary: boolean): DuplicateSkipReason {
  return inLibrary ? 'library' : 'zip'
}
