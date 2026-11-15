/**
 * Orders overlapping async reads of one value. Each read takes a ticket from
 * {@link begin}; a successful read is applied only when it is newer than the
 * last applied one, so a slow old success can't overwrite a newer one and a
 * newer failure can't discard an older success. The value is unsettled from
 * {@link invalidate} (or a failed read) until a read begun after that point
 * succeeds; callers fail closed while it is unsettled.
 */
export class ReadSequence {
  private issued = 0;
  private applied = 0;
  private needed = 0;

  /** Starts a read and returns its ticket. */
  begin(): number {
    return ++this.issued;
  }

  /** Records a successful read. True when the caller should apply its result. */
  succeed(ticket: number): boolean {
    if (ticket <= this.applied) return false;
    this.applied = ticket;
    return true;
  }

  /** Records a failed read: unsettled until a read begun after it succeeds. */
  fail(ticket: number): void {
    this.needed = Math.max(this.needed, ticket + 1);
  }

  /** The value may have changed: unsettled until a read begun from now on succeeds. */
  invalidate(): void {
    this.needed = this.issued + 1;
  }

  /** Whether the applied read is known to be current. */
  get settled(): boolean {
    return this.applied >= this.needed;
  }
}
