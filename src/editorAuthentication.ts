import * as vscode from "vscode";
import { withGitAuthentication, GitNetworkAuthentication } from "./gitAuthentication";
import { t } from "./localization";

export const editorGitAuthentication: GitNetworkAuthentication = async operation => {
  let githubSession: vscode.AuthenticationSession | undefined;
  return withGitAuthentication(async (prompt, signal) => {
    if (signal.aborted || !vscode.workspace.isTrusted) return undefined;
    // Only share GitHub sessions with the exact HTTPS origin, never lookalike hosts.
    const address = prompt.match(/https?:\/\/[^'\s]+/i)?.[0];
    let github = false;
    try { github = !!address && new URL(address).origin === "https://github.com"; } catch { /* Generic credential prompt below. */ }
    if (github && /^(Username|Password) for '/.test(prompt)) {
      try {
        githubSession ??= await vscode.authentication.getSession("github", ["repo"], { createIfNone: true });
        if (signal.aborted) return undefined;
        return /^Username /i.test(prompt) ? "x-access-token" : githubSession.accessToken;
      } catch { return undefined; }
    }
    const cancellation = new vscode.CancellationTokenSource();
    const abort = () => cancellation.cancel();
    signal.addEventListener("abort", abort, { once: true });
    try {
      return await vscode.window.showInputBox({
        title: t("Gitrism: Git authentication"), prompt,
        password: !/^Username /i.test(prompt), ignoreFocusOut: true
      }, cancellation.token);
    } finally { signal.removeEventListener("abort", abort); cancellation.dispose(); }
  }, operation);
};
