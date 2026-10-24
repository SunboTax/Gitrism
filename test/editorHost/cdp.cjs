const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.connect = async function(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let serial = 0;
  const pending = new Map(), contexts = new Map(), errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    } else if (message.method === 'Runtime.executionContextCreated') contexts.set(message.params.context.id, message.params.context);
    else if (message.method === 'Runtime.executionContextDestroyed') contexts.delete(message.params.executionContextId);
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timed out: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, contextId) => {
    const result = await call('Runtime.evaluate', { expression, ...(contextId ? { contextId } : {}), returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, contextId) => {
    for (let i = 0; i < 150; i++) { if (await evaluate(expression, contextId)) return; await pause(50); }
    throw new Error('UI condition failed: ' + expression);
  };
  await call('Runtime.enable');
  return { call, evaluate, until, contexts, errors, close: () => { socket.close(); for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP closed')); } pending.clear(); } };
};
