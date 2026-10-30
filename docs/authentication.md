# Git authentication

Gitrism runs Git beside the repository. In Remote SSH, Git uses the remote host's configuration, credential helpers, SSH keys, and agent access.

## VS Code and Cursor

Fetch, pull, push, and sync first use Git's configured credential helpers. Gitrism does not disable credential-manager interaction. If Git still needs credentials:

- HTTPS GitHub remotes use the editor's GitHub authentication provider. An existing session can be reused; otherwise the editor offers sign-in and permission to share the session with Gitrism.
- Other hosts display native username and masked password/token prompts. For services that require a personal access token, enter the token as the password.
- SSH continues to use keys and agents. If OpenSSH invokes AskPass, Gitrism displays a masked prompt; a working SSH agent is recommended for encrypted keys.

The editor AskPass channel exists only for the current operation and replaces inherited, potentially stale editor sockets. Gitrism does not put credentials in settings, command arguments, logs, or temporary files. Git may save credentials through your configured credential helper; the editor manages GitHub sessions. Cancelling authentication stops the operation. Remote editor operations allow five minutes, including sign-in.

## Terminal and browser workspace

The standalone browser/CLI workspace uses existing Git helpers and inherited AskPass. It has no editor sign-in dialog and disables terminal prompts because the Git subprocess has no interactive terminal. Configure a credential helper or SSH agent before using remote operations there. Its Git operations retain the 60-second timeout.

## When terminal push works but the editor fails

1. Check that both use the same repository, remote URL, machine, and Git configuration. A Remote SSH window uses the remote machine's credentials.
2. Install Gitrism 0.6.2 or later on the correct Extension Host, then reload the window.
3. Retry the operation and complete any editor authentication prompt. For GitHub organization repositories, check repository access and any required SSO authorization.

A `vscode-git-*.sock` connection refusal usually indicates a stale terminal/editor AskPass environment. A fresh terminal often fixes terminal Git; Gitrism's editor remote operations use their own channel. Proxies control routing and do not grant repository access.
