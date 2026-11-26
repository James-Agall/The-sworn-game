// A small line diff (LCS) for the Area tab's "diff vs git HEAD" view of the building interior files. Editor tooling
// only: nothing here is game data or a game rule.
export type DiffLine = { op: " " | "-" | "+"; text: string; a?: number; b?: number };

/** Line-by-line diff of `a` (old) and `b` (new), every line kept (" " same, "-" removed, "+" added). */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split("\n"), B = b.split("\n");
  const n = A.length, m = B.length;
  // LCS table (the interior files are a few hundred lines: n * m stays small)
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { out.push({ op: " ", text: A[i], a: i + 1, b: j + 1 }); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] > L[i + 1][j])) { out.push({ op: "+", text: B[j], b: j + 1 }); j++; }
    else { out.push({ op: "-", text: A[i], a: i + 1 }); i++; }
  }
  return out;
}

/** Only the changed lines with `context` lines around them; null when the texts are equal. */
export function diffHunks(a: string, b: string, context = 3): DiffLine[][] | null {
  if (a === b) return null;
  const d = diffLines(a, b);
  const keep = new Uint8Array(d.length);
  d.forEach((l, k) => { if (l.op !== " ") for (let q = Math.max(0, k - context); q <= Math.min(d.length - 1, k + context); q++) keep[q] = 1; });
  const hunks: DiffLine[][] = [];
  let cur: DiffLine[] | null = null;
  d.forEach((l, k) => {
    if (!keep[k]) { cur = null; return; }
    if (!cur) { cur = []; hunks.push(cur); }
    cur.push(l);
  });
  return hunks;
}
