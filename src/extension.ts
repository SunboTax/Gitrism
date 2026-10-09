import { t, setLanguage, getLocale } from "./localization";
import * as vscode from "vscode";
import * as path from "node:path";
import { BlameLine, GitError, GitService } from "./gitService";
import { GitrismTreeProvider } from "./treeProvider";
import { CommitGraphPanel } from "./commitGraphPanel";
import { GitrismPanelView } from "./gitrismPanelView";
import { RevisionProvider } from "./revisionProvider";
import { executeGitMutation } from "./workspaceController";
import { GitrismCodeLensProvider, CodeAuthor } from "./codeLensProvider";
import { migrateLegacySettings } from "./settingsMigration";

let git: GitService | undefined;
let output: vscode.OutputChannel | undefined;
let blameDecoration: vscode.TextEditorDecorationType | undefined;
let currentTree: GitrismTreeProvider | undefined;
let treeRegistration: vscode.Disposable | undefined;
let activeFolderPath: string | undefined;
let inlineBlameEnabled = false;
let panelView: GitrismPanelView | undefined;
let extensionContext: vscode.ExtensionContext;
let repositories: GitService[] = [];
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let blameTimer: ReturnType<typeof setTimeout> | undefined;
let blameRequest = 0;
let repositoryRequest = 0;
let codeLens: GitrismCodeLensProvider | undefined;
let blameCache: { key: string; lines: BlameLine[] } | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  setLanguage(vscode.env.language);
  extensionContext = context;
  await migrateLegacySettings(context);
  output = vscode.window.createOutputChannel("Gitrism");
  context.subscriptions.push(output);

  panelView = new GitrismPanelView(context.extensionUri, refreshWorkspace);
  context.subscriptions.push(
    panelView,
    vscode.workspace.registerTextDocumentContentProvider("gitrism", new RevisionProvider()),
    vscode.window.registerWebviewViewProvider("gitrism.bottomPanel", panelView, { webviewOptions: { retainContextWhenHidden: true } })
  );

  blameDecoration = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor("editorCodeLens.foreground"), margin: "0 0 0 2em" },
    isWholeLine: true
  });
  context.subscriptions.push(blameDecoration);

  codeLens = new GitrismCodeLensProvider(() => repositories);
  context.subscriptions.push(codeLens, vscode.languages.registerCodeLensProvider({ scheme: "file" }, codeLens));
  const register = (command: string, callback: (...args: any[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  };
  register("gitrism.refresh", async () => {
    await ensureWorkspace(context);
    await refreshWorkspace();
  });
  register("gitrism.showStatus", async () => {
    if (await ensureWorkspace(context)) await showStatus();
  });
  register("gitrism.showBranches", async () => {
    const tree = await ensureWorkspace(context);
    if (tree) await showBranches(tree);
  });
  register("gitrism.showHistory", async (uri?: vscode.Uri) => {
    if (await ensureWorkspace(context)) await showHistory(uri);
  });
  register("gitrism.showCodeAuthors", async (authors: CodeAuthor[] = [], root?: string) => {
    const choice = await vscode.window.showQuickPick(authors.map(author => ({
      label: author.name, description: author.email,
      detail: t("{0} retained lines · {1}", author.lines, author.commit.summary), hash: author.commit.hash
    })), { placeHolder: t("Authors of current retained lines; select an author to view a related commit") });
    if (choice) await vscode.commands.executeCommand("gitrism.showCommit", choice.hash, root);
  });
  register("gitrism.showLineBlame", async () => {
    if (await ensureWorkspace(context)) await showLineBlame();
  });
  register("gitrism.toggleBlame", async () => {
    if (await ensureWorkspace(context)) await toggleBlame();
  });
  register("gitrism.showCommit", async (hash?: string, root?: string) => {
    if (await ensureWorkspace(context)) {
      const repository = root ? repositories.find(repo => repo.cwd === root) : undefined;
      if (repository && repository.cwd !== git?.cwd) await selectRepository(repository, context);
      await showCommit(hash);
    }
  });
  register("gitrism.sync", async () => {
    const tree = await ensureWorkspace(context);
    if (tree) await syncRepository(tree);
  });
  register("gitrism.openGraph", async () => {
    if (await ensureWorkspace(context) && git) await CommitGraphPanel.createOrShow(git, context.extensionUri, refreshWorkspace);
  });
  register("gitrism.openPanel", async () => {
    await ensureWorkspace(context);
    await vscode.commands.executeCommand("workbench.view.extension.gitrismPanel");
  });
  register("gitrism.chooseRepository", async () => {
    await discoverRepositories();
    const choice = await vscode.window.showQuickPick(repositories.map(repo => ({ label: path.basename(repo.cwd), description: repo.cwd, repo })), { placeHolder: t("Choose a Git repository in this workspace") });
    if (choice) await selectRepository(choice.repo, context);
  });
  register("gitrism.showLineHistory", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file" || !(await ensureWorkspace(context)) || !git) return;
    try {
      await selectEditorRepository(editor);
      const file = path.relative(git.cwd, editor.document.uri.fsPath);
      const details = await git.lineHistory(file, editor.selection.start.line + 1, editor.selection.end.line + 1);
      const document = await vscode.workspace.openTextDocument({ content: details, language: "diff" });
      await vscode.window.showTextDocument(document, { preview: true });
    } catch (error) { reportError(error); }
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void initializeWorkspace(context, true);
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      scheduleBlame();
    }),
    vscode.workspace.onDidSaveTextDocument(() => codeLens?.invalidate()),
    vscode.workspace.onDidChangeTextDocument((event) => {
      codeLens?.invalidate();
      if (inlineBlameEnabled && vscode.window.activeTextEditor?.document === event.document) {
        scheduleBlame();
      }
    }),
    vscode.window.onDidChangeTextEditorSelection(() => {
      scheduleBlame();
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("gitrism.codeLens")) codeLens?.invalidate();
      if (event.affectsConfiguration("gitrism.inlineBlame")) {
        inlineBlameEnabled = vscode.workspace.getConfiguration("gitrism.inlineBlame").get("enabled", false);
        vscode.window.visibleTextEditors.forEach(editor => editor.setDecorations(blameDecoration!, []));
        scheduleBlame();
      }
      if (event.affectsConfiguration("gitrism.sshProxy")) void initializeWorkspace(context, true);
    })
  );
  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { void refreshWorkspace(); }, 800);
  };
  context.subscriptions.push(watcher, watcher.onDidChange(scheduleRefresh), watcher.onDidCreate(scheduleRefresh), watcher.onDidDelete(scheduleRefresh));

  inlineBlameEnabled = vscode.workspace.getConfiguration("gitrism.inlineBlame").get("enabled", false);
  await initializeWorkspace(context);
  if (inlineBlameEnabled) void updateInlineBlame();
}

async function discoverRepositories(): Promise<void> {
  const roots = new Set<string>();
  const proxy = vscode.workspace.getConfiguration("gitrism").get<string>("sshProxy", "");
  const gitExtension = vscode.extensions.getExtension<{ getAPI(version: number): { repositories: { rootUri: vscode.Uri }[] } }>("vscode.git");
  const gitApi = gitExtension ? await gitExtension.activate() : undefined;
  const candidates = [...(vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) || []), ...(gitApi?.getAPI(1).repositories.map(repo => repo.rootUri.fsPath) || [])];
  const results = await Promise.allSettled(candidates.map(async candidate => new GitService(candidate, proxy).repositoryRoot()));
  for (const result of results) if (result.status === "fulfilled") roots.add(result.value);
  repositories = [...roots].map(root => new GitService(root, proxy));
  codeLens?.invalidate();
}

async function selectRepository(repo: GitService, context: vscode.ExtensionContext): Promise<GitrismTreeProvider> {
  treeRegistration?.dispose();
  git = repo; activeFolderPath = repo.cwd; blameCache = undefined;
  await context.workspaceState.update("gitrism.repository", repo.cwd);
  panelView?.setGit(git); CommitGraphPanel.setGit(git);
  currentTree = new GitrismTreeProvider(git, reportError);
  treeRegistration = vscode.window.registerTreeDataProvider("gitrism.repository", currentTree);
  await currentTree.refresh();
  void vscode.commands.executeCommand("setContext", "gitrism.workspaceReady", true);
  scheduleBlame(); return currentTree;
}

async function initializeWorkspace(context: vscode.ExtensionContext, force = false): Promise<GitrismTreeProvider | undefined> {
  if (!force && currentTree && git && vscode.workspace.workspaceFolders?.length) return currentTree;
  const request = ++repositoryRequest;
  await discoverRepositories();
  if (request !== repositoryRequest) return currentTree;
  if (!repositories.length) {
    git = undefined;
    currentTree = undefined;
    activeFolderPath = undefined;
    treeRegistration?.dispose();
    treeRegistration = undefined;
    panelView?.setGit(undefined);
    CommitGraphPanel.setGit(undefined);
    void vscode.commands.executeCommand("setContext", "gitrism.workspaceReady", false);
    output?.appendLine("Gitrism is waiting for a workspace folder.");
    return undefined;
  }

  const preferred = context.workspaceState.get<string>("gitrism.repository");
  return selectRepository(repositories.find(repo => repo.cwd === preferred) || repositories[0], context);
}

async function refreshWorkspace(): Promise<void> {
  blameCache = undefined;
  codeLens?.invalidate();
  await Promise.all([currentTree?.refresh(), panelView?.controller.refresh(), CommitGraphPanel.refresh()]);
  scheduleBlame();
}

function scheduleBlame(): void {
  clearTimeout(blameTimer);
  if (inlineBlameEnabled) blameTimer = setTimeout(() => { void updateInlineBlame(); }, 180);
}

async function ensureWorkspace(context: vscode.ExtensionContext): Promise<GitrismTreeProvider | undefined> {
  const tree = await initializeWorkspace(context);
  if (!tree) {
    void vscode.window.showInformationMessage(t("Gitrism: Open a workspace folder first."));
  }
  return tree;
}

async function showStatus(): Promise<void> {
  if (!git) return;
  try {
    const status = await git.status();
    const message = [
      t("Branch: {0}", status.branch),
      t("Staged: {0}", status.staged),
      t("Modified: {0}", status.changed),
      t("Untracked: {0}", status.untracked)
    ];
    if (status.ahead || status.behind) message.push(t("Remote: ahead {0}, behind {1}", status.ahead, status.behind));
    void vscode.window.showInformationMessage(message.join("  ·  "));
  } catch (error) {
    reportError(error);
  }
}

async function showBranches(tree: GitrismTreeProvider): Promise<void> {
  if (!git) return;
  const repository = git;
  try {
    const branches = await repository.branches();
    const choice = await vscode.window.showQuickPick(branches.map((branch) => ({
      label: `${branch.current ? "$(check) " : ""}${branch.name}`,
      description: branch.remote ? t("Tracking {0}", branch.remote) : undefined,
      branch: branch.name,
      current: branch.current
    })), { placeHolder: t("Choose a branch to switch to") });
    if (!choice || choice.current) return;
    await executeGitMutation(repository, () => repository.checkout(choice.branch));
    await refreshWorkspace();
    void vscode.window.showInformationMessage(t("Switched to {0}", choice.branch));
  } catch (error) {
    reportError(error);
  }
}

async function showHistory(uri?: vscode.Uri): Promise<void> {
  if (!git) return;
  const editor = vscode.window.activeTextEditor;
  const target = uri || editor?.document.uri;
  if (!target || target.scheme !== "file") return;
  try {
    const repository = repositories.filter(repo => target.fsPath.startsWith(repo.cwd + path.sep)).sort((a,b)=>b.cwd.length-a.cwd.length)[0];
    if (!repository) return;
    if (repository.cwd !== git.cwd) await selectRepository(repository, extensionContext);
    const relative = path.relative(repository.cwd, target.fsPath);
    git.filePath(relative);
    await CommitGraphPanel.createOrShow(git, extensionContext.extensionUri, refreshWorkspace, undefined, relative);
  } catch (error) {
    reportError(error);
  }
}

async function showLineBlame(): Promise<void> {
  if (!git) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  try {
    const line = editor.selection.active.line;
    await selectEditorRepository(editor);
    const relative = path.relative(git.cwd, editor.document.uri.fsPath);
    const blame = await git.blame(relative, line + 1, line + 1);
    const item = blame[0];
    if (!item) return;
    const short = item.hash.replace(/^\^/, "").slice(0, 8);
    const choice = await vscode.window.showInformationMessage(
      `${short} · ${item.author} · ${formatDate(item.date)}\n${item.summary}`,
      t("View commit")
    );
    if (choice && !/^0+$/.test(item.hash)) await showCommit(item.hash);
  } catch (error) {
    reportError(error);
  }
}

async function showCommit(hash?: string): Promise<void> {
  if (!git) return;
  try {
    const selected = hash ?? (await vscode.window.showInputBox({ prompt: t("Enter a commit hash") }));
    if (!selected) return;
    const resolved = await git.resolveCommit(selected);
    await CommitGraphPanel.createOrShow(git, extensionContext.extensionUri, refreshWorkspace, resolved);
  } catch (error) {
    reportError(error);
  }
}

async function syncRepository(tree: GitrismTreeProvider): Promise<void> {
  if (!git) return;
  const repository = git;
  const choice = await vscode.window.showQuickPick([
    { label: t("$(sync) Sync"), description: t("Run pull --ff-only, then push"), action: "sync" },
    { label: t("$(cloud-download) Pull"), description: t("Run pull --ff-only"), action: "pull" },
    { label: t("$(cloud-upload) Push"), description: t("Run push"), action: "push" },
    { label: t("$(refresh) Fetch remote updates"), description: t("Run fetch --all --prune"), action: "fetch" }
  ], { placeHolder: t("Choose a remote Git operation") });
  if (!choice) return;
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Gitrism: " + choice.label, cancellable: false }, () => executeGitMutation(repository, async () => {
      if (choice.action === "sync") await repository.sync();
      if (choice.action === "pull") await repository.pull();
      if (choice.action === "push") await repository.push();
      if (choice.action === "fetch") await repository.fetch();
    }));
    await refreshWorkspace();
    void vscode.window.showInformationMessage(t("Gitrism: Remote operation completed"));
  } catch (error) {
    reportError(error);
  }
}

async function toggleBlame(): Promise<void> {
  if (!blameDecoration) return;
  inlineBlameEnabled = !inlineBlameEnabled;
  await vscode.workspace.getConfiguration("gitrism.inlineBlame").update(
    "enabled",
    inlineBlameEnabled,
    vscode.ConfigurationTarget.Workspace
  );
  if (!inlineBlameEnabled) {
    vscode.window.visibleTextEditors.forEach((editor) => editor.setDecorations(blameDecoration!, []));
  } else {
    await updateInlineBlame();
  }
}

async function updateInlineBlame(): Promise<void> {
  if (!git || !blameDecoration || !inlineBlameEnabled) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") return;
  const request = ++blameRequest;
  if (editor.document.isDirty) { editor.setDecorations(blameDecoration, []); return; }
  const repository = repositories.filter(repo => editor.document.uri.fsPath.startsWith(repo.cwd + path.sep)).sort((a,b) => b.cwd.length - a.cwd.length)[0];
  if (!repository) { editor.setDecorations(blameDecoration, []); return; }
  const maxLines = vscode.workspace.getConfiguration("gitrism.inlineBlame").get("maxLines", 1000);
  if (editor.document.lineCount > maxLines) {
    editor.setDecorations(blameDecoration, []);
    return;
  }
  try {
    const relative = path.relative(repository.cwd, editor.document.uri.fsPath);
    const version = editor.document.version;
    const key = repository.cwd + ":" + relative + ":" + version;
    const lines = blameCache?.key === key ? blameCache.lines : await repository.blame(relative);
    if (request !== blameRequest || editor.document.version !== version || editor.document.isDirty || !inlineBlameEnabled) return;
    blameCache = { key, lines };
    const allLines = vscode.workspace.getConfiguration("gitrism.inlineBlame").get<string>("mode", "currentLine") === "allLines";
    const decorations: vscode.DecorationOptions[] = [];
    lines.slice(0, editor.document.lineCount).forEach((item, index) => {
      if (!allLines && index !== editor.selection.active.line) return;
      const uncommitted = /^0+$/.test(item.hash);
      const hover = new vscode.MarkdownString();
      hover.appendText(`${item.author} · ${formatDate(item.date)}\n\n${item.summary}`);
      if (!uncommitted) {
        const uri = "command:gitrism.showCommit?" + encodeURIComponent(JSON.stringify([item.hash, repository.cwd]));
        hover.appendMarkdown(`\n\n[${t("View commit {0}", item.hash.slice(0,8))}](${uri})`);
        hover.isTrusted = { enabledCommands: ["gitrism.showCommit"] };
      }
      decorations.push({ range: new vscode.Range(index, 0, index, 0), hoverMessage: hover,
        renderOptions: { after: { contentText: uncommitted ? t(" Uncommitted") : ` ${item.author} · ${item.hash.replace(/^\^/, "").slice(0,8)} · ${item.summary}` } } });
    });
    editor.setDecorations(blameDecoration, decorations);
  } catch {
    if (request === blameRequest) editor.setDecorations(blameDecoration, []);
  }
}

async function selectEditorRepository(editor: vscode.TextEditor): Promise<void> {
  const repo = repositories.filter(repo => editor.document.uri.fsPath.startsWith(repo.cwd + path.sep)).sort((a,b) => b.cwd.length - a.cwd.length)[0];
  if (repo && repo.cwd !== git?.cwd) await selectRepository(repo, extensionContext);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(getLocale());
}

function reportError(error: unknown): void {
  const message = error instanceof GitError ? error.detail || error.message : String(error);
  output?.appendLine(message);
  void vscode.window.showErrorMessage(`Gitrism: ${message}`);
}

export function deactivate(): void {
  clearTimeout(refreshTimer); clearTimeout(blameTimer); blameRequest++;
  treeRegistration?.dispose();
  blameDecoration?.dispose();
}
