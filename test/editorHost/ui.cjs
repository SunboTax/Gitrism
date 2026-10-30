const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { connect } = require('./cdp.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.verify = async function(port, state, output) {
  let serial = 0;
  const connections = [];
  const request = async (type, values = {}) => {
    const id = ++serial;
    await fs.writeFile(path.join(state, 'request.json'), JSON.stringify({ id, type, ...values }));
    for (let i = 0; i < 300; i++) {
      let reply; try { reply = JSON.parse(await fs.readFile(path.join(state, 'response.json'), 'utf8')); } catch {}
      if (reply?.id === id) { if (reply.error) throw new Error(reply.error); return reply.result; }
      await pause(50);
    }
    throw new Error('Extension host did not answer: ' + type);
  };
  const targets = () => fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const main = (await targets()).find(target => target.type === 'page');
  const editor = await connect(main.webSocketDebuggerUrl); connections.push(editor);
  const graph = async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      for (const target of (await targets()).filter(target => target.type === 'iframe' && target.url.includes('sunbotax.gitrism'))) {
        const connection = await connect(target.webSocketDebuggerUrl);
        for (const context of connection.contexts.values()) {
          if (await connection.evaluate('document.querySelectorAll(".commit-row").length >= 5', context.id).catch(() => false)) {
            connections.push(connection);
            return { connection, context: context.id, evaluate: expression => connection.evaluate(expression, context.id), until: expression => connection.until(expression, context.id) };
          }
        }
        connection.close();
      }
      await pause(100);
    }
    throw new Error('No live Gitrism webview with repository commits');
  };
  const checks = [];
  try {
    let ui = await graph();
    assert.equal(await ui.evaluate('document.querySelectorAll(".commit-row").length'), 5);
    assert.ok(await ui.evaluate('document.querySelector(".graph-cell svg path, .graph-cell svg line") !== null'));
    checks.push('webview resources, CSP and real merge graph');
    await fs.mkdir(output, { recursive: true });
    const screenshot = async name => {
      const shot = await editor.call('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(path.join(output, name), Buffer.from(shot.data, 'base64'));
    };
    await screenshot('cursor-graph-dark.png');
    const hashes = await ui.evaluate('[...document.querySelectorAll(".commit-row")].map(row=>row.dataset.hash)');
    await ui.evaluate('document.querySelector(".commit-row").focus()');
    await ui.connection.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await ui.connection.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await ui.until(`document.activeElement?.dataset.hash === ${JSON.stringify(hashes[1])}`);
    checks.push('graph keyboard navigation');
    await ui.evaluate('document.querySelector("[data-action=networkSettings]").click()');
    await ui.until('document.querySelector("#network-settings[open]") !== null');
    await ui.evaluate(`{const mode=document.getElementById('network-mode');mode.value='custom';mode.dispatchEvent(new Event('change'));document.getElementById('network-url').value='127.0.0.1:7890';document.getElementById('network-form').requestSubmit();}`);
    await ui.until('document.getElementById("network-settings") === null && document.querySelector(".proxy-active") !== null');
    await request('networkProxy');
    await ui.evaluate('document.querySelector("[data-action=networkSettings]").click()');
    await ui.evaluate(`{document.getElementById('network-mode').value='inherit';document.getElementById('network-form').requestSubmit();}`);
    await ui.until('document.getElementById("network-settings") === null && document.querySelector(".proxy-active") === null');
    checks.push('webview proxy controls and workspace settings');

    const themes = [];
    for (const [value, className] of [['Default Light Modern', 'vscode-light'], ['Default High Contrast', 'vscode-high-contrast'], ['Default High Contrast Light', 'vscode-high-contrast-light'], ['Default Dark Modern', 'vscode-dark']]) {
      const kind = await request('theme', { value });
      await ui.until(`document.body.classList.contains(${JSON.stringify(className)})`);
      themes.push({ name: value, kind, background: await ui.evaluate('getComputedStyle(document.body).getPropertyValue("--vscode-editor-background").trim()') });
      if (className === 'vscode-light') await screenshot('cursor-graph-light.png');
    }
    assert.notEqual(themes[0].background, themes.at(-1).background);
    checks.push('dark, light and both high contrast themes');
    await ui.evaluate('document.querySelector(".commit-row").click()');
    await ui.until('document.querySelector(".detail-header h2")?.textContent === "Refine greeting"');
    await ui.evaluate('document.querySelector("[data-action=diff]").click()');
    const diff = await request('diff');
    assert.equal(diff.original, 'function greet() {\n  return "hello";\n}\n');
    assert.equal(diff.modified, 'function greet() {\n  return "hello there";\n}\n');
    checks.push('native diff via actual webview message');
    await screenshot('cursor-native-diff.png');
    await request('source', { line: 1 });
    const annotation = author => `Array.from(document.querySelectorAll('.view-line span')).some(span => (span.textContent + getComputedStyle(span,'::after').content).includes(${JSON.stringify(author + ' ·')}))`;
    await editor.until(annotation('Leo Park'));
    await screenshot('cursor-inline.png');
    await request('source', { line: 0 }); await editor.until(annotation('Ava Lin'));
    assert.equal(await editor.evaluate(annotation('Leo Park')), false);
    checks.push('cursor-line attribution for two authors in one function');
    await editor.evaluate(`window.gitrismAttributionSamples=[];window.gitrismAttributionTimer=setInterval(()=>window.gitrismAttributionSamples.push(${annotation('Ava Lin')}),16)`);
    try {
      for(let i=0;i<3;i++){
        await request('refreshAttribution');
        await request('source',{line:0,character:i+1});
        await pause(700);
      }
      const samples=await editor.evaluate('window.gitrismAttributionSamples');
      assert.ok(samples.length>100,'Observe multiple cursor blink cycles');
      assert.ok(samples.every(Boolean),'Attribution must stay visible during refresh and horizontal cursor motion');
      checks.push('steady attribution across refreshes, horizontal motion and cursor blink cycles');
    } finally {await editor.evaluate('clearInterval(window.gitrismAttributionTimer)');}
    const authentication=request('authProbe');
    authentication.catch(()=>{});
    await editor.until('document.querySelector(".quick-input-widget input.input")?.type === "text" && document.querySelector(".quick-input-widget")?.textContent.includes("Git authentication")');
    await editor.call('Input.insertText',{text:'fixture-user'});
    await editor.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await editor.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await editor.until('document.querySelector(".quick-input-widget input.input")?.type === "password"');
    await editor.call('Input.insertText',{text:'fixture-token'});
    await editor.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await editor.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await authentication;
    checks.push('native authentication UI with masked secret input');
    await request('panel');
    ui = await graph();
    checks.push('bottom panel command');
    const errors = connections.flatMap(connection => connection.errors).filter(error => JSON.stringify(error).includes('workspace.js'));
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'ui-result.json'), JSON.stringify({ checks, themes }, null, 2) + '\n');
    await request('finish');
    return { checks, themes };
  } finally { for (const connection of connections) connection.close(); }
};
if (require.main === module) exports.verify(Number(process.env.GITRISM_CDP_PORT || 9325), process.env.GITRISM_HOST_STATE || '/tmp/gitrism-cursor-runtime/state', process.env.GITRISM_HOST_OUTPUT || '/tmp/gitrism-cursor-runtime/previews').then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error); process.exitCode = 1; });
