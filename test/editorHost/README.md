# Editor host acceptance

`npm run test:cursor` tests an installed VSIX in an actual official Cursor runtime. See [the Cursor guide](../../docs/cursor.md) for prerequisites and environment variables. The probe extension is development-only and excluded from both distribution packages.

`suite.cjs` executes native editor APIs and opens the graph; `ui.cjs` drives actual webviews and the editor using CDP. Both must succeed. Cursor can exit with status zero after a test assertion fails, so the driver requires `result.json` in addition to a successful launch.

## Remote SSH probe

Use an isolated test account/profile, a disposable repository, and a host whose SSH key you have verified. Install Cursor's official Remote - SSH extension in that profile and the tested Gitrism VSIX on the remote Extension Host. Do not run the fixture in your working repository.

1. Prepare the same five-commit fixture as `fixture()` in `driver.cjs`: Ava Lin's initial greeting, two branches, a merge, and Leo Park's final greeting. Copy `test/editorHost` to an absolute path on the remote host. Its `extensionKind` is `workspace`.
2. Launch the actual Cursor executable with isolated `--user-data-dir` and `--extensions-dir`, `--remote ssh-remote+ALIAS`, and a disposable remote folder. Enable `--remote-debugging-port=PORT` only for the test. Point `remote.SSH.configFile` at your test SSH configuration if needed.
3. Pass remote URIs for **both** probe paths:

   ```text
   --extensionDevelopmentPath=vscode-remote://ssh-remote+ALIAS/absolute/path/test/editorHost
   --extensionTestsPath=vscode-remote://ssh-remote+ALIAS/absolute/path/test/editorHost/suite.cjs
   ```

   Local file paths run the test in the local host even when the workspace is remote. The probe must report `host.remoteName === "ssh-remote"`, `host.extensionKind === 2`, and the tested package version.

4. The remote probe writes its mailbox and `ready.json` to `<fixture>/.gitrism-host-state`. For the loopback SSH acceptance run, that directory is also accessible locally, so run:

   ```bash
   GITRISM_CDP_PORT=PORT \
   GITRISM_HOST_STATE=/absolute/path/to/fixture/.gitrism-host-state \
   GITRISM_HOST_OUTPUT=/absolute/path/to/evidence \
   node test/editorHost/ui.cjs
   ```

   For another machine, the mailbox needs a file transport; the current UI driver assumes local/shared access. This procedure is a real SSH extension-host check on loopback, not a network-performance test.

5. Require both mailbox `result.json` and output `ui-result.json`; save the host metadata and screenshots. Stop the test editor, private SSH server, and test-owned Cursor remote processes. Remove disposable repositories and profiles. Clear mailbox JSON files before another run so stale results cannot pass a later test.

Runtime logs are private evidence and may contain connection tokens. Do not commit them or distribute Cursor binaries. This harness uses public extension APIs and Chromium's debugging protocol; it does not modify the editor or implement authentication workarounds.
