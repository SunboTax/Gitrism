import * as vscode from "vscode";

export async function migrateLegacySettings(context: vscode.ExtensionContext): Promise<void> {
  if (context.workspaceState.get<boolean>("gitrism.settingsMigrated")) return;
  const keys = ["inlineBlame.enabled", "inlineBlame.mode", "inlineBlame.maxLines", "sshProxy"];
  const resources = [undefined, ...(vscode.workspace.workspaceFolders?.map(folder => folder.uri) ?? [])];
  for (const resource of resources) {
    const legacy = vscode.workspace.getConfiguration("gitAtlas", resource);
    const current = vscode.workspace.getConfiguration("gitrism", resource);
    for (const key of keys) {
      const old = legacy.inspect(key), next = current.inspect(key);
      if (!old) continue;
      if (resource) {
        if (old.workspaceFolderValue !== undefined && next?.workspaceFolderValue === undefined) await current.update(key, old.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder);
      } else {
        if (old.globalValue !== undefined && next?.globalValue === undefined) await current.update(key, old.globalValue, vscode.ConfigurationTarget.Global);
        if (old.workspaceValue !== undefined && next?.workspaceValue === undefined) await current.update(key, old.workspaceValue, vscode.ConfigurationTarget.Workspace);
      }
    }
  }
  await context.workspaceState.update("gitrism.settingsMigrated", true);
}
