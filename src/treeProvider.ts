import * as vscode from "vscode";
import { BranchSummary, CommitSummary, GitService, RepositoryStatus } from "./gitService";

type NodeKind = "status" | "branches" | "branch" | "commits" | "commit" | "action";

export class GitrismTreeProvider implements vscode.TreeDataProvider<GitrismNode> {
  private readonly emitter = new vscode.EventEmitter<GitrismNode | undefined>();
  public readonly onDidChangeTreeData = this.emitter.event;
  private status?: RepositoryStatus;
  private branches: BranchSummary[] = [];
  private commits: CommitSummary[] = [];

  public constructor(private readonly git: GitService, private readonly onError: (error: unknown) => void) {}

  public async refresh(): Promise<void> {
    try {
      [this.status, this.branches, this.commits] = await Promise.all([
        this.git.status(),
        this.git.branches(),
        this.git.log(12)
      ]);
      this.emitter.fire(undefined);
    } catch (error) {
      this.onError(error);
    }
  }

  public getTreeItem(node: GitrismNode): vscode.TreeItem {
    return node;
  }

  public getChildren(node?: GitrismNode): GitrismNode[] {
    if (!node) {
      const statusLabel = this.status
        ? `当前分支: ${this.status.branch} · ${this.status.files.length} 个变更`
        : "正在读取仓库状态…";
      return [
        new GitrismNode(statusLabel, "status", vscode.TreeItemCollapsibleState.None, "gitrism.showStatus"),
        new GitrismNode("提交图", "action", vscode.TreeItemCollapsibleState.None, "gitrism.openGraph"),
        new GitrismNode("底部工作区", "action", vscode.TreeItemCollapsibleState.None, "gitrism.openPanel"),
        new GitrismNode("分支", "branches", vscode.TreeItemCollapsibleState.Collapsed),
        new GitrismNode("最近提交", "commits", vscode.TreeItemCollapsibleState.Collapsed)
      ];
    }
    if (node.kind === "branches") {
      return this.branches.map((branch) => {
        const item = new GitrismNode(`${branch.current ? "● " : "○ "}${branch.name}`, "branch", vscode.TreeItemCollapsibleState.None, "gitrism.showBranches");
        item.description = branch.remote ? `跟踪 ${branch.remote}` : undefined;
        item.tooltip = branch.current ? "当前分支" : "点击打开分支切换面板";
        return item;
      });
    }
    if (node.kind === "commits") {
      return this.commits.map((commit) => {
        const item = new GitrismNode(commit.subject, "commit", vscode.TreeItemCollapsibleState.None, "gitrism.showCommit");
        item.description = `${commit.hash.slice(0, 8)} · ${commit.author} · ${formatDate(commit.date)}`;
        item.command = { command: "gitrism.showCommit", title: "查看提交", arguments: [commit.hash] };
        return item;
      });
    }
    return [];
  }
}

export class GitrismNode extends vscode.TreeItem {
  public constructor(
    label: string,
    public readonly kind: NodeKind,
    state: vscode.TreeItemCollapsibleState,
    commandId?: string
  ) {
    super(label, state);
    if (commandId) this.command = { command: commandId, title: label };
    this.contextValue = kind;
    if (kind === "status") this.iconPath = new vscode.ThemeIcon("source-control");
    if (kind === "branches") this.iconPath = new vscode.ThemeIcon("git-branch");
    if (kind === "commits") this.iconPath = new vscode.ThemeIcon("history");
    if (kind === "commit") this.iconPath = new vscode.ThemeIcon("git-commit");
    if (kind === "action") this.iconPath = new vscode.ThemeIcon("graph");
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}
