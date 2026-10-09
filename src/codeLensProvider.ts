import * as vscode from "vscode";
import * as path from "node:path";
import { GitService, BlameLine } from "./gitService";
import { t, getLocale } from "./localization";

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

/** Attribution of retained lines, using language-provider symbol ranges and Git blame. */
export class GitrismCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this.emitter.event;
  private generation = 0;
  private readonly cache = new Map<string, Promise<BlameLine[]>>();
  public constructor(private readonly repositories: () => GitService[]) {}
  public invalidate(): void { this.generation++; this.cache.clear(); this.emitter.fire(); }
  public dispose(): void { this.cache.clear(); this.emitter.dispose(); }
  public async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    const config = vscode.workspace.getConfiguration("gitrism.codeLens", document.uri);
    if (!config.get("enabled", true) || document.uri.scheme !== "file" || document.isDirty || document.isClosed || token.isCancellationRequested || document.lineCount > config.get("maxLines", 5000)) return [];
    const repository = this.repositories().filter(repo => document.uri.fsPath.startsWith(repo.cwd + path.sep)).sort((a,b)=>b.cwd.length-a.cwd.length)[0];
    if (!repository) return [];
    const version = document.version, generation = this.generation;
    const stale = () => token.isCancellationRequested || document.isDirty || document.isClosed || document.version !== version || generation !== this.generation;
    const file = path.relative(repository.cwd, document.uri.fsPath);
    try {
      let symbols: (vscode.DocumentSymbol | vscode.SymbolInformation)[] = [];
      try { symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>("vscode.executeDocumentSymbolProvider", document.uri) || []; } catch { /* File-level fallback. */ }
      if (stale()) return [];
      const ranges: { range: vscode.Range; anchor: vscode.Range }[] = [], anchors = new Set<number>();
      const kinds = new Set([vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor, vscode.SymbolKind.Class, vscode.SymbolKind.Interface, vscode.SymbolKind.Enum]);
      const maxSymbols = Math.max(1, Math.min(500, config.get("maxSymbols", 100)));
      function collect(items: (vscode.DocumentSymbol | vscode.SymbolInformation)[]): void {
        for (const symbol of items) {
          const range = "location" in symbol ? symbol.location.range : symbol.range;
          const anchor = "selectionRange" in symbol ? symbol.selectionRange : range;
          const sameFile = !("location" in symbol) || symbol.location.uri.toString() === document.uri.toString();
          if (sameFile && kinds.has(symbol.kind) && !anchors.has(anchor.start.line) && ranges.length < maxSymbols) { ranges.push({range, anchor}); anchors.add(anchor.start.line); }
          if ("children" in symbol && ranges.length < maxSymbols) collect(symbol.children);
        }
      }
      collect(symbols);
      if (!ranges.length) ranges.push({ range: new vscode.Range(0,0,document.lineCount-1,0), anchor: new vscode.Range(0,0,0,0) });
      const key = `${repository.cwd}:${file}:${version}`;
      let pending = this.cache.get(key);
      if (!pending) {
        if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
        pending = repository.blame(file); this.cache.set(key, pending);
        void pending.catch(() => { if (this.cache.get(key) === pending) this.cache.delete(key); });
      }
      const lines = await pending;
      if (stale()) return [];
      const lenses: vscode.CodeLens[] = [];
      for (const {range, anchor} of ranges) {
        const attribution = authorsForRange(lines, range.start.line, range.end.line - (range.end.character === 0 && range.end.line > range.start.line ? 1 : 0));
        const lensRange = new vscode.Range(anchor.start.line,0,anchor.start.line,0);
        const latest = attribution.latest;
        if (latest) lenses.push(new vscode.CodeLens(lensRange, {
          title: t("{0} · {1}", latest.author, new Date(latest.date).toLocaleDateString(getLocale())),
          tooltip: t("Latest commit represented in these retained lines: {0}", latest.summary),
          command: "gitrism.showCommit", arguments: [latest.hash, repository.cwd]
        }));
        if (attribution.authors.length || attribution.uncommitted) lenses.push(new vscode.CodeLens(lensRange, {
          title: attribution.uncommitted ? t("{0} authors · {1} uncommitted lines", attribution.authors.length, attribution.uncommitted) : t("{0} authors", attribution.authors.length),
          tooltip: t("Code attribution for current retained lines"), command: "gitrism.showCodeAuthors", arguments: [attribution.authors, repository.cwd]
        }));
      }
      lenses.push(new vscode.CodeLens(new vscode.Range(0,0,0,0), {title: t("File history"), command: "gitrism.showHistory", arguments: [document.uri]}));
      return lenses;
    } catch { return []; } // Untracked, ignored, binary, or unreadable files have no attribution.
  }
}
