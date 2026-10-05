import * as vscode from "vscode";
import { GitService } from "./gitService";
import { WorkspaceController } from "./workspaceController";
export class GitrismPanelView implements vscode.WebviewViewProvider, vscode.Disposable {
  public readonly controller: WorkspaceController;
  public constructor(extensionUri: vscode.Uri, changed: () => Promise<void>) { this.controller = new WorkspaceController(extensionUri, undefined, changed); }
  public setGit(git: GitService | undefined): void { this.controller.setGit(git); }
  public resolveWebviewView(view: vscode.WebviewView): void { this.controller.attach(view.webview); }
  public dispose(): void { this.controller.dispose(); }
}
