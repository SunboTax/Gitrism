import { t, getLocale, getLocalization } from "./localization";
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { GitError, GitService } from "./gitService";
import { openDiff } from "./revisionProvider";
import { WorkspaceSession, WorkspaceMessage } from "./workspaceSession";
import { withGitMutation } from "./mutationLock";
import { hostname } from "node:os";

export async function executeGitMutation(git: GitService, action: () => Promise<void>): Promise<void> {
  if (!vscode.workspace.isTrusted) throw new GitError(t("Trust this workspace before running Git operations"));
  await withGitMutation(git, action);
}
export class WorkspaceController implements vscode.Disposable {
  private webview?: vscode.Webview;
  private listener?: vscode.Disposable;
  private session: WorkspaceSession;
  public constructor(private readonly extensionUri: vscode.Uri, git: GitService | undefined, changed: () => Promise<void>) {
    this.session = new WorkspaceSession(git, {
      postMessage: message => { void this.webview?.postMessage(message); },
      isTrusted: () => vscode.workspace.isTrusted,
      confirm: async (message, detail) => await vscode.window.showWarningMessage(message, { modal: true, detail }, t("Execute")) === t("Execute"),
      input: async (prompt, value) => vscode.window.showInputBox({ prompt, value, ignoreFocusOut: true }),
      pick: async (items, placeHolder) => vscode.window.showQuickPick(items, { placeHolder }),
      chooseRepository: async () => { await vscode.commands.executeCommand("gitrism.chooseRepository"); },
      openGraph: async () => { await vscode.commands.executeCommand("gitrism.openGraph"); },
      activeHistory: async () => { await vscode.commands.executeCommand("gitrism.showHistory"); },
      openDiff,
      openFile: async file => { await vscode.window.showTextDocument(vscode.Uri.file(file)); },
      openWorktree: async directory => { await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(directory), { forceNewWindow: true }); },
      copy: async value => vscode.env.clipboard.writeText(value),
      networkInfo: () => ({ host: hostname(), remote: !!vscode.env.remoteName, scope: "workspace" }),
      saveNetworkProxy: async config => vscode.workspace.getConfiguration("gitrism").update("proxy", config, vscode.ConfigurationTarget.Workspace)
    }, changed);
  }
  public dispose(): void { this.listener?.dispose(); this.webview = undefined; this.session.dispose(); }
  public setGit(git: GitService | undefined): void { this.session.setGit(git); }
  public async revealCommit(hash: string): Promise<void> { await this.session.revealCommit(hash); }
  public revealTimeline(file: string): void { this.session.revealTimeline(file); }
  public async refresh(): Promise<void> { if (this.webview) await this.session.refresh(); }
  public attach(webview: vscode.Webview): void {
    this.listener?.dispose(); this.webview = webview;
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "resources")] };
    this.listener = webview.onDidReceiveMessage((message: unknown) => {
      if (message && typeof message === "object" && typeof (message as WorkspaceMessage).type === "string") void this.session.handle(message as WorkspaceMessage);
    });
    webview.html = this.html(webview);
  }
  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString("hex");
    const resource = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "resources", name));
    // Escape script terminators even if a future translation includes HTML-like text.
    const localization = JSON.stringify(getLocalization()).replace(/[<>&\u2028\u2029]/g, value => "\\u" + value.charCodeAt(0).toString(16).padStart(4, "0"));
    return `<!DOCTYPE html><html lang="${getLocale()}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${resource("workspace.css")}"><link rel="stylesheet" href="${resource("timeline.css")}"></head><body><main id="app" aria-busy="true"><div class="empty">${t("Loading local repository…")}</div></main><div id="toast" role="status" hidden></div><script id="gitrism-localization" type="application/json" nonce="${nonce}">${localization}</script><script nonce="${nonce}" src="${resource("i18n.js")}"></script><script nonce="${nonce}" src="${resource("graphLayout.js")}"></script><script nonce="${nonce}" src="${resource("activity.js")}"></script><script nonce="${nonce}" src="${resource("paneResize.js")}"></script><script nonce="${nonce}" src="${resource("workingTree.js")}"></script><script nonce="${nonce}" src="${resource("workspace.js")}"></script></body></html>`;
  }
}
