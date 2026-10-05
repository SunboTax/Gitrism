import * as vscode from "vscode";
import { GitService } from "./gitService";
import { WorkspaceController } from "./workspaceController";
export class CommitGraphPanel {
  private static current?: { panel: vscode.WebviewPanel; controller: WorkspaceController };
  public static setGit(git: GitService | undefined): void { this.current?.controller.setGit(git); }
  public static async refresh(): Promise<void> { await this.current?.controller.refresh(); }
  public static async createOrShow(git: GitService, extensionUri: vscode.Uri, changed: () => Promise<void>, hash?: string, file?: string): Promise<void> {
    if (!this.current) {
      const panel = vscode.window.createWebviewPanel("gitrism.commitGraph", "Gitrism", vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
      const controller = new WorkspaceController(extensionUri, git, changed);
      this.current = { panel, controller };
      controller.attach(panel.webview);
      const listener = panel.webview.onDidReceiveMessage(message => {
        if (message?.type === "ready") { if (hash) void controller.revealCommit(hash); if (file) controller.revealTimeline(file); listener.dispose(); }
      });
      panel.onDidDispose(() => { listener.dispose(); controller.dispose(); this.current = undefined; });
    } else {
      this.current.panel.reveal(vscode.ViewColumn.One);
      this.current.controller.setGit(git);
      if (hash) await this.current.controller.revealCommit(hash);
      if (file) this.current.controller.revealTimeline(file);
    }
  }
}
