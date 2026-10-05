import * as vscode from "vscode";
import { GitService } from "./gitService";
import { randomUUID } from "node:crypto";

export class RevisionProvider implements vscode.TextDocumentContentProvider {
  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { root, ref, file } = JSON.parse(uri.query) as { root: string; ref: string; file: string };
    return new GitService(root).contentAt(ref, file);
  }
}
export function revisionUri(git: GitService, ref: string, file: string): vscode.Uri {
  return vscode.Uri.from({ scheme: "gitrism", path: "/" + file, query: JSON.stringify({ root: git.cwd, ref, file, ...(ref === "INDEX" ? { snapshot: randomUUID() } : {}) }) });
}
export async function openDiff(git: GitService, from: string, to: string, file: string, oldFile = file): Promise<void> {
  const left = revisionUri(git, from, oldFile);
  const right = to === "WORKING" ? vscode.Uri.file(git.filePath(file)) : revisionUri(git, to, file);
  await vscode.commands.executeCommand("vscode.diff", left, right, `${file} · ${from.slice(0, 8)} ↔ ${to.slice(0, 8)}`, { preview: true });
}
