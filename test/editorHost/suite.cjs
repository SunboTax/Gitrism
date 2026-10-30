const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.run = async () => {
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const state = process.env.GITRISM_HOST_STATE || path.join(root, '.gitrism-host-state');
  await fs.mkdir(state, { recursive: true });
  const checks = [];
  const extension = vscode.extensions.getExtension('sunbotax.gitrism');
  assert.equal(vscode.env.appName, 'Cursor');
  assert.ok(extension, 'The packaged extension must be installed');
  if (vscode.env.remoteName) {
    assert.equal(vscode.env.remoteName, 'ssh-remote');
    assert.equal(extension.extensionKind, vscode.ExtensionKind.Workspace);
  }
  await extension.activate(); assert.ok(extension.isActive);
  checks.push('packaged VSIX activation');
  const commands = await vscode.commands.getCommands(true);
  for (const command of ['openGraph', 'openPanel', 'showHistory', 'toggleBlame', 'toggleCodeLens', 'showCommit']) {
    assert.ok(commands.includes('gitrism.' + command), command);
  }
  checks.push('public commands');
  const file = vscode.Uri.file(path.join(root, 'src/greeting.js'));
  const document = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(1, 0, 1, 0);
  await vscode.workspace.getConfiguration('gitrism.codeLens').update('enabled', true, vscode.ConfigurationTarget.Workspace);
  const symbols = vscode.languages.registerDocumentSymbolProvider({ language: 'javascript', scheme: 'file' }, {
    provideDocumentSymbols: () => [new vscode.DocumentSymbol('greet', '', vscode.SymbolKind.Function, new vscode.Range(0, 0, 2, 1), new vscode.Range(0, 9, 0, 14))],
  });
  try {
    let lenses = [];
    for (let i = 0; i < 100; i++) {
      lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', file) || [];
      if (lenses.some(lens => lens.command?.command === 'gitrism.showCommit')) break;
      await pause(100);
    }
    assert.ok(lenses.some(lens => lens.command?.command === 'gitrism.showCommit'));
    assert.ok(lenses.some(lens => lens.command?.command === 'gitrism.showCodeAuthors'));
    const latest = lenses.find(lens => lens.command?.command === 'gitrism.showCommit');
    assert.match(latest.command.title, /Leo Park/);
    const authors = lenses.find(lens => lens.command?.command === 'gitrism.showCodeAuthors').command.arguments[0];
    assert.deepEqual(new Set(authors.map(author => author.name)), new Set(['Ava Lin', 'Leo Park']));
    checks.push('function CodeLens and retained-line authors');
  } finally { symbols.dispose(); }
  await vscode.workspace.getConfiguration('gitrism.codeLens').update('enabled', false, vscode.ConfigurationTarget.Workspace);
  await vscode.commands.executeCommand('gitrism.openGraph');
  const host = { appName: vscode.env.appName, api: vscode.version, remoteName: vscode.env.remoteName || null, node: process.versions.node, extensionVersion: extension.packageJSON.version, extensionKind: extension.extensionKind };
  await fs.writeFile(path.join(state, 'ready.json'), JSON.stringify({ host, checks }));
  let serial = 0;
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    let request;
    try { request = JSON.parse(await fs.readFile(path.join(state, 'request.json'), 'utf8')); } catch {}
    if (!request || request.id === serial) { await pause(50); continue; }
    serial = request.id;
    let result;
    try {
      if (request.type === 'theme') {
        await vscode.workspace.getConfiguration('workbench').update('colorTheme', request.value, vscode.ConfigurationTarget.Global);
        const expected = request.value.includes('High Contrast Light') ? vscode.ColorThemeKind.HighContrastLight : request.value.includes('High Contrast') ? vscode.ColorThemeKind.HighContrast : request.value.includes('Light') ? vscode.ColorThemeKind.Light : vscode.ColorThemeKind.Dark;
        for (let i = 0; i < 100 && vscode.window.activeColorTheme.kind !== expected; i++) await pause(50);
        assert.equal(vscode.window.activeColorTheme.kind, expected);
        result = vscode.window.activeColorTheme.kind;
      } else if (request.type === 'networkProxy') {
        result = vscode.workspace.getConfiguration('gitrism').get('proxy');
        assert.deepEqual(result, { mode: 'custom', url: 'http://127.0.0.1:7890' });
        checks.push('workspace proxy setting persisted');
      } else if (request.type === 'source') {
        const shown = await vscode.window.showTextDocument(document, { preview: false });
        shown.selection = new vscode.Selection(request.line, request.character || 0, request.line, request.character || 0);
        result = true;
      } else if (request.type === 'refreshAttribution') {
        await vscode.commands.executeCommand('gitrism.refresh'); result = true;
      } else if (request.type === 'authProbe') {
        const { editorGitAuthentication } = require(path.join(extension.extensionPath, 'out/editorAuthentication'));
        const run = require('node:util').promisify(require('node:child_process').execFile);
        await editorGitAuthentication(async env => {
          const user = await run(env.GIT_ASKPASS, ["Username for 'https://git.example.invalid': "], { env: { ...process.env, ...env } });
          assert.equal(user.stdout.trim(), 'fixture-user');
          const password = await run(env.GIT_ASKPASS, ["Password for 'https://fixture-user@git.example.invalid': "], { env: { ...process.env, ...env } });
          assert.equal(password.stdout.trim(), 'fixture-token');
        });
        checks.push('native username/password prompts and actual Electron AskPass helper');result = true;
      } else if (request.type === 'diff') {
        let tab;
        for (let i = 0; i < 200; i++) {
          tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab => tab.input instanceof vscode.TabInputTextDiff);
          if (tab) break;
          await pause(50);
        }
        assert.ok(tab, 'The webview must open a native diff tab');
        const left = await vscode.workspace.openTextDocument(tab.input.original);
        const right = await vscode.workspace.openTextDocument(tab.input.modified);
        assert.match(left.getText(), /hello/); assert.match(right.getText(), /hello there/);
        assert.equal(tab.input.original.scheme, 'gitrism');
        assert.equal(tab.input.modified.scheme, 'gitrism');
        result = { original: left.getText(), modified: right.getText() };
        checks.push('native revision diff and content provider');
      } else if (request.type === 'panel') {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await vscode.commands.executeCommand('gitrism.openPanel'); result = true;
      } else if (request.type === 'graph') {
        await vscode.commands.executeCommand('gitrism.openGraph'); result = true;
      } else if (request.type === 'finish') {
        await fs.writeFile(path.join(state, 'result.json'), JSON.stringify({ host, checks }));
        await fs.writeFile(path.join(state, 'response.json'), JSON.stringify({ id: serial, result: true }));
        await pause(300);
        return;
      } else throw new Error('Unknown probe request');
      await fs.writeFile(path.join(state, 'response.json'), JSON.stringify({ id: serial, result }));
    } catch (error) {
      await fs.writeFile(path.join(state, 'response.json'), JSON.stringify({ id: serial, error: error.stack }));
    }
  }
  throw new Error('Host UI driver timed out');
};
