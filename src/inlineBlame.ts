import { BlameLine, GitService } from "./gitService";

export interface LineAttribution { line: number; entry: BlameLine }

/** Cache bounded blame reads, including pending reads for the same document/line. */
export class InlineBlameCache {
  private readonly entries = new Map<string, Promise<LineAttribution[]>>();
  public clear(): void { this.entries.clear(); }
  public query(repository: Pick<GitService, "cwd" | "blame">, file: string, version: number, line: number, allLines: boolean): Promise<LineAttribution[]> {
    const key = JSON.stringify([repository.cwd, file, version, allLines ? "all" : line]);
    const cached = this.entries.get(key);
    if (cached) return cached;
    if (this.entries.size >= 64) this.entries.delete(this.entries.keys().next().value!);
    const pending = (allLines ? repository.blame(file) : repository.blame(file, line + 1, line + 1))
      .then(lines => lines.map((entry, index) => ({ line: allLines ? index : line, entry })));
    this.entries.set(key, pending);
    void pending.catch(() => { if (this.entries.get(key) === pending) this.entries.delete(key); });
    return pending;
  }
}
