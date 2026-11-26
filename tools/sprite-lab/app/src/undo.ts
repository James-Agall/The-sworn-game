// Snapshot undo/redo, one stack per document (each tab owns the stacks of what it edits).
// Snapshots must be immutable values (the Parts project uses JSON text + immutable image objects, so they are cheap).
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  limit: number;
  onChange: () => void = () => {};
  constructor(limit = 200) { this.limit = limit; }
  /** Record the state BEFORE a change. */
  push(before: T): void {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.onChange();
  }
  undo(current: T): T | null {
    const s = this.past.pop();
    if (s === undefined) return null;
    this.future.push(current);
    this.onChange();
    return s;
  }
  redo(current: T): T | null {
    const s = this.future.pop();
    if (s === undefined) return null;
    this.past.push(current);
    this.onChange();
    return s;
  }
  clear(): void { this.past = []; this.future = []; this.onChange(); }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}
