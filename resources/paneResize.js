/* Pane resizing stays local to the webview and uses numeric CSSOM properties. */
(() => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const stacked = () => window.matchMedia('(max-width: 640px)').matches;
  const horizontalNavigation = () => window.matchMedia('(max-width: 1000px), (max-height: 480px)').matches;
  const handleWidth = 8;

  function create({ root, getLayout, saveLayout, sizeText, onEnd }) {
    let drag, frame;
    const currentLayout = () => drag?.layout || getLayout() || {};
    function geometry(handle) {
      if (!handle?.isConnected || !handle.getClientRects().length) return;
      const navigation = handle.dataset.resize === 'navigation';
      if (navigation) {
        if (horizontalNavigation()) return;
        const shell = handle.closest('.workspace-shell'), pane = shell?.querySelector('.tabs');
        if (!pane) return;
        return { axis: 'x', key: 'navigation', direction: 1, min: 132, max: Math.min(360, shell.clientWidth * .28), size: pane.getBoundingClientRect().width, container: shell, pane };
      }
      const container = handle.closest('.graph-layout, .timeline-layout');
      if (!container) return;
      if (stacked()) {
        if (!container.classList.contains('graph-layout')) return;
        const pane = container.querySelector('.graph-area');
        return { axis: 'y', key: 'graphHeight', direction: 1, min: 180, max: Math.max(180, Math.min(800, window.innerHeight - 180)), size: pane.getBoundingClientRect().height, container, pane };
      }
      const available = container.clientWidth - handleWidth, pane = container.querySelector('.detail-pane');
      return { axis: 'x', key: 'detailRatio', direction: -1, min: 240, max: Math.max(240, Math.min(1200, available - 320)), size: pane.getBoundingClientRect().width, available, container, pane };
    }
    function sync() {
      const layout = currentLayout(), shell = root.querySelector('.workspace-shell');
      if (!shell) return;
      if (finite(layout.navigation)) shell.style.setProperty('--navigation-size', clamp(layout.navigation, 132, Math.min(360, shell.clientWidth * .28)) + 'px');
      else shell.style.removeProperty('--navigation-size');
      for (const container of root.querySelectorAll('.graph-layout, .timeline-layout')) {
        const available = container.clientWidth - handleWidth;
        if (finite(layout.detailRatio) && layout.detailRatio > 0 && layout.detailRatio < 1) {
          container.style.setProperty('--detail-size', clamp(layout.detailRatio * available, 240, Math.max(240, Math.min(1200, available - 320))) + 'px');
        } else container.style.removeProperty('--detail-size');
        if (finite(layout.graphHeight)) container.style.setProperty('--graph-height', clamp(layout.graphHeight, 180, Math.max(180, Math.min(800, window.innerHeight - 180))) + 'px');
        else container.style.removeProperty('--graph-height');
      }
      for (const handle of root.querySelectorAll('[data-resize]')) {
        const g = geometry(handle);
        if (!g) continue;
        handle.setAttribute('aria-orientation', g.axis === 'x' ? 'vertical' : 'horizontal');
        handle.setAttribute('aria-controls', g.pane.id);
        handle.setAttribute('aria-valuemin', String(Math.round(g.min)));
        handle.setAttribute('aria-valuemax', String(Math.round(g.max)));
        handle.setAttribute('aria-valuenow', String(Math.round(g.size)));
        handle.setAttribute('aria-valuetext', sizeText(Math.round(g.size)));
      }
    }
    function preview(point) {
      if (!drag) return;
      const g = geometry(drag.handle);
      if (!g || g.axis !== drag.axis) { finish(true); return; }
      const size = clamp(drag.startSize + (point - drag.startPoint) * g.direction, g.min, g.max);
      drag.layout[g.key] = g.key === 'detailRatio' ? size / g.available : size;
      sync();
    }
    function flush() {
      if (frame) { cancelAnimationFrame(frame); frame = undefined; }
      if (drag?.point !== undefined) preview(drag.point);
    }
    function finish(commit) {
      if (!drag) return;
      const active = drag;
      drag = undefined;
      if (frame) { cancelAnimationFrame(frame); frame = undefined; }
      document.body.classList.remove('resizing-panes', 'resizing-horizontal');
      active.handle.classList.remove('is-dragging');
      if (active.handle.hasPointerCapture(active.pointer)) active.handle.releasePointerCapture(active.pointer);
      if (commit) saveLayout(active.layout);
      sync();
      onEnd();
    }
    function reset(handle) {
      const g = geometry(handle);
      if (!g) return;
      const layout = { ...getLayout() }; delete layout[g.key];
      saveLayout(layout); sync();
    }
    root.addEventListener('pointerdown', event => {
      const handle = event.target.closest('[data-resize]');
      if (!handle || event.button !== 0 || !event.isPrimary || drag) return;
      const g = geometry(handle);
      if (!g) return;
      event.preventDefault(); handle.focus({ preventScroll: true });
      drag = { handle, pointer: event.pointerId, axis: g.axis, startPoint: g.axis === 'x' ? event.clientX : event.clientY, startSize: g.size, layout: { ...getLayout() } };
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-dragging');
      document.body.classList.add('resizing-panes');
      document.body.classList.toggle('resizing-horizontal', g.axis === 'y');
    });
    window.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointer) return;
      drag.point = drag.axis === 'x' ? event.clientX : event.clientY;
      if (!frame) frame = requestAnimationFrame(() => { frame = undefined; if (drag) preview(drag.point); });
    });
    window.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.pointer) return;
      drag.point = drag.axis === 'x' ? event.clientX : event.clientY;
      flush(); finish(true);
    });
    window.addEventListener('pointercancel', event => { if (drag?.pointer === event.pointerId) finish(false); });
    root.addEventListener('lostpointercapture', event => { if (drag?.pointer === event.pointerId) { flush(); finish(true); } });
    window.addEventListener('blur', () => { flush(); finish(true); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { flush(); finish(true); } });
    root.addEventListener('dblclick', event => { const handle = event.target.closest('[data-resize]'); if (handle) { event.preventDefault(); reset(handle); } });
    root.addEventListener('keydown', event => {
      if (drag && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(false); return; }
      const handle = event.target.closest('[data-resize]'), g = geometry(handle);
      if (!g || drag) return;
      if (event.key === 'Enter') { event.preventDefault(); event.stopImmediatePropagation(); reset(handle); return; }
      const negative = g.axis === 'x' ? 'ArrowLeft' : 'ArrowUp', positive = g.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
      if (![negative, positive, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const size = event.key === 'Home' ? g.min : event.key === 'End' ? g.max : clamp(g.size + (event.key === positive ? 1 : -1) * g.direction * (event.shiftKey ? 64 : 16), g.min, g.max);
      const layout = { ...getLayout(), [g.key]: g.key === 'detailRatio' ? size / g.available : size };
      saveLayout(layout); sync();
    });
    const observer = new ResizeObserver(() => {
      if (drag) {
        const g = geometry(drag.handle);
        if (!g || g.axis !== drag.axis) finish(true);
      }
      sync();
    });
    observer.observe(root);
    return { sync, isDragging: () => !!drag };
  }
  window.GitrismPaneResize = { create };
})();
