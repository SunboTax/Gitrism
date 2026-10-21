/* Local browser transport. All repository content is rendered as text. */
(() => {
  const config = JSON.parse(document.getElementById('gitrism-localization').textContent);
  const t = GitrismI18n.createTranslator(config.messages);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const token = fragment.get('token') || sessionStorage.getItem('gitrism-token') || '';
  if (token) sessionStorage.setItem('gitrism-token', token);
  history.replaceState(null, '', location.pathname);
  let client, queue = [], connected = false, dialogQueue = Promise.resolve();
  const headers = { 'X-Gitrism-Token': token, 'Content-Type': 'application/json' };
  const deliver = message => window.dispatchEvent(new MessageEvent('message', { data: message }));
  function report(message) { deliver({ type: 'error', message }); }
  async function post(message) {
    if (!connected) { if (!client && queue.length < 32) queue.push(message); return; }
    try {
      const response = await fetch('/api/message', { method: 'POST', headers, body: JSON.stringify({ client, message }) });
      if (!response.ok) throw new Error(t('Local workspace request failed. Reload to reconnect.'));
    } catch (error) { report(String(error.message || error)); }
  }
  window.acquireVsCodeApi = () => ({
    getState: () => { try { return JSON.parse(localStorage.getItem('gitrism-state') || 'null'); } catch { return undefined; } },
    setState: value => { try { localStorage.setItem('gitrism-state', JSON.stringify(value)); } catch {} },
    postMessage: message => { void post(message); }
  });
  function element(tag, text, className) {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
    if (className) node.className = className; return node;
  }
  function prompt(request) {
    return new Promise(resolve => {
      const dialog = element('dialog', undefined, 'browser-dialog');
      const form = element('form'); form.method = 'dialog';
      form.append(element('h2', request.message || request.prompt));
      if (request.detail) form.append(element('p', request.detail));
      let input;
      if (request.kind === 'pick') {
        input = document.createElement('select');
        for (const item of request.items) { const option = element('option', item); option.value = item; input.append(option); }
      } else if (request.kind === 'input') { input = document.createElement('input'); input.value = request.value || ''; }
      if (input) { input.setAttribute('aria-label', request.prompt); form.append(input); }
      const actions = element('div', undefined, 'browser-dialog-actions');
      for (const [label, value] of [[t('Cancel'), 'cancel'], [t('Execute'), 'execute']]) {
        const button = element('button', label); button.value = value; if (value === 'execute') button.className = 'primary'; actions.append(button);
      }
      form.append(actions); dialog.append(form); document.body.append(dialog);
      dialog.addEventListener('close', () => { const value = dialog.returnValue === 'execute' ? input ? input.value : true : null; dialog.remove(); resolve(value); }, { once: true });
      dialog.showModal(); if (input) input.focus();
    });
  }
  function showDiff(message) {
    document.querySelector('.browser-diff')?.remove();
    const dialog = element('dialog', undefined, 'browser-diff');
    dialog.setAttribute('aria-label', t('Side-by-side text preview'));
    const header = element('div', undefined, 'browser-diff-header');
    const heading = element('div'); heading.append(element('strong', message.file), element('small', t('Side-by-side text preview'))); header.append(heading);
    if (message.editor) {
      const open = element('button', t('Open working file in Neovim')); open.addEventListener('click', () => void post({ type: 'browserOpenFile', file: message.file })); header.append(open);
    }
    const close = element('button', t('Close')); close.addEventListener('click', () => dialog.close()); header.append(close);
    dialog.append(header);
    const panes = element('div', undefined, 'browser-diff-panes');
    for (const [ref, text] of [[message.from, message.left], [message.to, message.right]]) {
      const pane = element('section'); pane.append(element('h3', ref));
      const code = element('ol'); code.setAttribute('aria-label', ref);
      for (const line of text.split('\n')) code.append(element('li', line || '\u200b'));
      pane.append(code); panes.append(pane);
    }
    dialog.append(panes); document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
  }
  function incoming(message) {
    if (message.type === 'connected') {
      client = message.client; connected = true;
      const pending = queue; queue = []; for (const request of pending) void post(request);
      return;
    }
    if (message.type === 'heartbeat') return;
    if (message.type === 'hostRequest') {
      dialogQueue = dialogQueue.then(async () => { const value = await prompt(message); await post({ type: 'hostResponse', id: message.id, value }); }); return;
    }
    if (message.type === 'browserDiff') { showDiff(message); return; }
    if (message.type === 'browserCopy') {
      navigator.clipboard.writeText(message.value).then(() => deliver({ type: 'notice', message: t('Copied') }), () => report(t('Clipboard access was denied.'))); return;
    }
    deliver(message);
  }
  async function connect() {
    try {
      const response = await fetch('/api/events', { headers });
      if (!response.ok || !response.body) throw new Error(t('Open the complete workspace URL from Neovim or the CLI.'));
      const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        pending += decoder.decode(value, { stream: true });
        let split;
        while ((split = pending.indexOf('\n\n')) !== -1) {
          const frame = pending.slice(0, split); pending = pending.slice(split + 2);
          if (frame.startsWith('data: ')) incoming(JSON.parse(frame.slice(6)));
        }
      }
      throw new Error(t('Local workspace disconnected. Reload to reconnect.'));
    } catch (error) { connected = false; setTimeout(() => report(String(error.message || error)), 0); }
  }
  void connect();
})();
