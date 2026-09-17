// Paste this entire file into the remote Chrome DevTools Console before connecting the mic.
// Export: copy(galaxyDebug.export())
// Stop: galaxyDebug.stop() — reloading the page also removes the instrumentation.
(() => {
  window.galaxyDebug?.stop?.();
  const entries = [], cleanup = [], controller = new AbortController();
  const started = performance.now();
  let active = true, dropped = 0, nextRecognition = 0;
  const label = el => el instanceof Element
    ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${Array.from(el.classList).map(c => `.${c}`).join('')}`
    : el === document ? 'document' : 'window';
  const log = (type, data = {}) => {
    if (!active) return;
    const entry = { ms: Math.round(performance.now() - started), type, ...data };
    entries.push(entry);
    if (entries.length > 2000) { entries.shift(); dropped++; }
    console.log('[galaxy]', JSON.stringify(entry));
  };
  const listen = (target, type, fn) => target.addEventListener(type, fn, {
    capture: true, passive: true, signal: controller.signal
  });
  const wrap = (prototype, method, before) => {
    const original = prototype?.[method];
    if (typeof original !== 'function') return;
    function wrapped(...args) {
      try { before(this, args); } catch (error) { log('diagnostic-error', { message: String(error) }); }
      return Reflect.apply(original, this, args);
    }
    prototype[method] = wrapped;
    cleanup.push(() => { if (prototype[method] === wrapped) prototype[method] = original; });
  };
  const geometry = el => {
    const css = getComputedStyle(el), rect = el.getBoundingClientRect();
    return {
      element: label(el), top: rect.top, bottom: rect.bottom, height: rect.height,
      clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop,
      overflowY: css.overflowY, touchAction: css.touchAction,
      maxHeight: css.maxHeight, position: css.position, pointerEvents: css.pointerEvents
    };
  };
  const snapshot = () => {
    const nodes = new Set([document.documentElement, document.body]);
    document.querySelectorAll('dialog[open]').forEach(dialog => {
      nodes.add(dialog);
      dialog.querySelectorAll('.modal-scroll, .lobby-players').forEach(el => nodes.add(el));
    });
    return {
      viewport: { width: innerWidth, height: innerHeight, scrollY,
        visualHeight: visualViewport?.height, visualOffsetTop: visualViewport?.offsetTop },
      elements: Array.from(nodes, geometry)
    };
  };
  const ui = () => Object.fromEntries(['mic-transcript', 'call-count', 'transcript'].map(id =>
    [id, document.getElementById(id)?.textContent || '']));

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const ids = new WeakMap();
  wrap(Recognition?.prototype, 'start', rec => {
    if (!ids.has(rec)) {
      const id = ++nextRecognition;
      ids.set(rec, id);
      for (const type of ['start', 'audiostart', 'speechstart', 'speechend', 'audioend', 'end', 'error', 'nomatch']) {
        listen(rec, type, event => log(`voice:${type}`, { id, error: event.error }));
      }
      listen(rec, 'result', event => {
        const result = {
          id, resultIndex: event.resultIndex,
          results: Array.from(event.results, (r, index) => ({
            index, isFinal: r.isFinal,
            alternatives: Array.from(r, a => ({ transcript: a.transcript, confidence: a.confidence }))
          }))
        };
        log('voice:result', result);
        setTimeout(() => log('voice:ui-after-result', { id, ...ui() }), 0);
      });
    }
    log('voice:start-request', { id: ids.get(rec), lang: rec.lang,
      continuous: rec.continuous, interimResults: rec.interimResults });
  });
  for (const method of ['abort', 'stop']) {
    wrap(Recognition?.prototype, method, rec => log(`voice:${method}-request`, { id: ids.get(rec) }));
  }
  wrap(window.WebSocket?.prototype, 'send', (_socket, args) => {
    if (typeof args[0] !== 'string') return;
    let message;
    try { message = JSON.parse(args[0]); } catch { return; }
    if (message?.type === 'call') log('game:call-send-attempt', { count: message.count });
  });

  let lastMove = -Infinity, lastScroll = -Infinity;
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    listen(document, type, event => {
      if (!document.querySelector('dialog[open]')) return;
      if (type === 'touchmove') {
        if (performance.now() - lastMove < 150) return;
        lastMove = performance.now();
      }
      const touch = event.changedTouches[0];
      const details = {
        target: label(event.target), x: touch?.clientX, y: touch?.clientY,
        ancestors: event.composedPath().filter(el => el instanceof Element).map(el => ({
          element: label(el), touchAction: getComputedStyle(el).touchAction
        }))
      };
      setTimeout(() => log(`modal:${type}`, {
        ...details, defaultPrevented: event.defaultPrevented, ...snapshot()
      }), 0);
    });
  }
  listen(document, 'scroll', event => {
    if (!document.querySelector('dialog[open]') || performance.now() - lastScroll < 150) return;
    lastScroll = performance.now();
    log('modal:scroll', { target: label(event.target), ...snapshot() });
  });
  listen(window, 'error', event => log('page:error', { message: event.message }));
  listen(window, 'unhandledrejection', event => log('page:rejection', { message: String(event.reason) }));

  window.galaxyDebug = {
    mark: note => log('mark', { note, ...snapshot(), ...ui() }),
    snapshot: () => log('snapshot', snapshot()),
    export: () => JSON.stringify({ version: 1, dropped, entries }, null, 2),
    stop: () => {
      active = false;
      controller.abort();
      cleanup.reverse().forEach(fn => fn());
    }
  };
  log('environment', { userAgent: navigator.userAgent, page: location.origin + location.pathname,
    secureContext: isSecureContext, speechRecognitionSupported: !!Recognition,
    name: document.getElementById('horse-name')?.value, ...snapshot() });
  console.log('[galaxy] 준비 완료. 새로고침하지 말고 마이크 연결부터 재현하세요. 로그 복사: copy(galaxyDebug.export())');
})();
