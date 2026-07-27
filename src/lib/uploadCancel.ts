/** Session-scoped upload cancellation (ZIP extract → parse → persist). */
export class UploadCancelGate {
  private cancelled = false

  get isCancelled(): boolean {
    return this.cancelled
  }

  reset(): void {
    this.cancelled = false
  }

  cancel(): void {
    this.cancelled = true
  }
}

export type ShouldCancelUpload = () => boolean
