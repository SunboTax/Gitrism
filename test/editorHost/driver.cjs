// Run against an official, unmodified Cursor installation; never reuse user profiles.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { verify } = require('./ui.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const project = path.resolve(__dirname, '../..');

async function fixture(root) {
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  let sequence = 0;
  const git = (...args) => {
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull };
    if (args.includes('commit') || args.includes('merge')) {
      const date = `2026-10-${11 + sequence++}T09:00:00+08:00`;
      Object.assign(env, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    }
    execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
  };
  git('init', '-b', 'main'); git('config', 'user.name', 'Ava Lin'); git('config', 'user.email', 'ava.lin@example.invalid');
  await fs.writeFile(path.join(root, 'src/greeting.js'), 'function greet() {\n  return "hello";\n}\n');
  git('add', '.'); git('commit', '-m', 'Create greeting');
  git('checkout', '-b', 'feature/search');
  await fs.writeFile(path.join(root, 'search.txt'), 'Literal title search\n');
  git('add', '.'); git('commit', '-m', 'Add search');
  git('checkout', 'main');
  await fs.writeFile(path.join(root, 'README.md'), '# Sample\n');
  git('add', '.'); git('commit', '-m', 'Document the workspace');
  git('merge', '--no-ff', 'feature/search', '-m', 'Merge search');
  await fs.writeFile(path.join(root, 'src/greeting.js'), 'function greet() {\n  return "hello there";\n}\n');
  git('-c', 'user.name=Leo Park', '-c', 'user.email=leo.park@example.invalid', 'commit', '-am', 'Refine greeting');
  await fs.writeFile(path.join(root, 'src/config.js'), 'export const local = true;\n');
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function main() {
  const executable = process.env.GITRISM_CURSOR_EXECUTABLE;
  if (!executable) throw new Error('Set GITRISM_CURSOR_EXECUTABLE to the actual Cursor executable (not the bin/cursor shell wrapper). See docs/cursor.md.');
  if (process.platform !== 'linux') throw new Error('This automated host driver currently requires Linux and Xvfb.');
  const version = require('../../package.json').version;
  const vsix = path.resolve(process.env.GITRISM_VSIX || path.join(project, `gitrism-${version}.vsix`));
  await fs.access(vsix);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gitrism-cursor-check-'));
  const output = path.resolve(process.env.GITRISM_HOST_OUTPUT || path.join(project, 'output', `cursor-${Date.now()}`));
  await fs.mkdir(output, { recursive: true });
  const profile = path.join(temporary, 'profile'), extensions = path.join(temporary, 'extensions');
  const state = path.join(temporary, 'state'), repository = path.join(temporary, 'sample');
  let xvfb, cursor, cursorLog;
  const terminate = child => {
    if (child?.pid && child.exitCode === null) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  };
  const cleanupSignal = () => { terminate(cursor); terminate(xvfb); };
  process.once('SIGINT', cleanupSignal); process.once('SIGTERM', cleanupSignal);
  try {
    await fixture(repository);
    await fs.mkdir(state); await fs.mkdir(path.join(profile, 'User'), { recursive: true });
    await fs.writeFile(path.join(profile, 'User/settings.json'), JSON.stringify({
      'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
      'telemetry.telemetryLevel': 'off', 'extensions.autoUpdate': false,
      'extensions.autoCheckUpdates': false, 'update.mode': 'none',
      'git.autofetch': false, 'workbench.colorTheme': 'Default Dark Modern',
    }));
    const cli = process.env.GITRISM_CURSOR_CLI || path.join(path.dirname(executable), 'bin/cursor');
    const cursorVersion = execFileSync(cli, ['--version'], { encoding: 'utf8', timeout: 30000 }).trim();
    execFileSync(cli, ['--user-data-dir', profile, '--extensions-dir', extensions, '--install-extension', vsix, '--force'], { stdio: 'pipe', timeout: 90000 });
    xvfb = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1600x1000x24', '-nolisten', 'tcp'], { detached: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
    let xError = ''; xvfb.stderr.on('data', data => { xError += data; });
    const display = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Xvfb startup timed out: ' + xError)), 10000);
      xvfb.once('error', error => { clearTimeout(timeout); reject(error); });
      xvfb.stdio[3].once('data', data => { clearTimeout(timeout); resolve(':' + String(data).trim()); });
    });
    const port = await freePort();
    cursorLog = await fs.open(path.join(output, 'cursor.log'), 'w');
    cursor = spawn(executable, [
      '--user-data-dir', profile, '--extensions-dir', extensions, '--disable-gpu',
      ...(process.env.GITRISM_CURSOR_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
      '--skip-welcome', '--skip-onboarding', '--skip-release-notes', `--remote-debugging-port=${port}`,
      `--extensionDevelopmentPath=${__dirname}`, `--extensionTestsPath=${path.join(__dirname, 'suite.cjs')}`, repository,
    ], { detached: true, stdio: ['ignore', cursorLog.fd, cursorLog.fd], env: { ...process.env, DISPLAY: display, GITRISM_HOST_STATE: state } });
    let launchError; cursor.once('error', error => { launchError = error; });
    let ready;
    for (let i = 0; i < 1800; i++) {
      if (launchError) throw launchError;
      try { ready = JSON.parse(await fs.readFile(path.join(state, 'ready.json'), 'utf8')); break; } catch {}
      if (cursor.exitCode !== null) throw new Error('Cursor exited before the packaged extension was ready. See ' + path.join(output, 'cursor.log'));
      await pause(100);
    }
    assert.ok(ready, 'Cursor extension host startup timed out');
    assert.equal(ready.host.appName, 'Cursor'); assert.equal(ready.host.remoteName, null);
    assert.equal(ready.host.extensionVersion, version);
    const ui = await verify(port, state, output);
    const result = JSON.parse(await fs.readFile(path.join(state, 'result.json'), 'utf8'));
    const sha256 = createHash('sha256').update(await fs.readFile(vsix)).digest('hex');
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ ...result, ui, cursorVersion, artifact: vsix, sha256 }, null, 2) + '\n');
    console.log(`Cursor host checks passed. Evidence: ${output}`);
  } finally {
    terminate(cursor); terminate(xvfb);
    await pause(300);
    await cursorLog?.close();
    await fs.rm(temporary, { recursive: true, force: true });
    process.removeListener('SIGINT', cleanupSignal); process.removeListener('SIGTERM', cleanupSignal);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
