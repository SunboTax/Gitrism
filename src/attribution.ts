import { BlameLine } from "./gitService";

export interface CodeAuthor { name: string; email?: string; lines: number; commit: BlameLine }
export function authorsForRange(lines: BlameLine[], start: number, end: number): { authors: CodeAuthor[]; latest?: BlameLine; uncommitted: number } {
  const groups = new Map<string, CodeAuthor>(); let latest: BlameLine | undefined, uncommitted = 0;
  for (const line of lines.slice(start, end+1)) {
    if (/^0+$/.test(line.hash)) { uncommitted++; continue; }
    const identity = line.email?.toLowerCase() || line.author;
    const group = groups.get(identity);
    if (!group) groups.set(identity, {name: line.author, email: line.email, lines: 1, commit: line});
    else { group.lines++; if (line.date > group.commit.date) group.commit = line; }
    if (!latest || line.date > latest.date) latest = line;
  }
  return { authors: [...groups.values()].sort((a,b)=>b.lines-a.lines), latest, uncommitted };
}
