// Arrastrar y soltar con ratón y pantalla táctil (Pointer Events).
// - Ratón: el arrastre empieza al mover unos píxeles.
// - Táctil: mantener pulsado ~0,25 s y arrastrar (un deslizamiento rápido sigue haciendo scroll).

const MOUSE_THRESHOLD = 5;
const TOUCH_HOLD_MS = 250;
const TOUCH_SLOP = 10;

export function initDragAndDrop({ onDrop, onHover, onStart, onEnd, enabled }) {
  let pending = null; // { el, data, x, y, pointerId, type, timer }
  let drag = null; // { data, ghost, target }
  let suppressClick = false;
  let scrollTimer = null;

  const readData = (el) => ({ type: el.dataset.drag, id: Number(el.dataset.id), from: el.dataset.from || '' });

  function start(e) {
    const { el, data } = pending;
    clearTimeout(pending.timer);
    pending = null;
    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.removeAttribute('id');
    ghost.style.setProperty('width', `${r.width}px`);
    document.body.appendChild(ghost);
    drag = { data, ghost, target: null, src: el, offX: Math.min(r.width / 2, 60), offY: r.height / 2 };
    el.classList.add('drag-source');
    document.body.classList.add('is-dragging');
    if (navigator.vibrate && e.pointerType === 'touch') navigator.vibrate(15);
    onStart?.(data);
    move(e.clientX, e.clientY);
  }

  function move(x, y) {
    drag.ghost.style.setProperty('transform', `translate(${x - drag.offX}px, ${y - drag.offY}px)`);
    const under = document.elementFromPoint(x, y);
    const target = under?.closest('[data-drop-event], [data-drop-remove]') || null;
    if (target !== drag.target) {
      drag.target?.classList.remove('drop-over', 'drop-warn');
      drag.target = target;
      if (target) target.classList.add('drop-over', onHover?.(target, drag.data) === 'warn' ? 'drop-warn' : 'drop-ok');
    }
    autoScroll(y);
  }

  function autoScroll(y) {
    clearInterval(scrollTimer);
    const edge = 70;
    const h = window.innerHeight;
    let dy = 0;
    if (y < edge) dy = -12; else if (y > h - edge) dy = 12;
    if (!dy) return;
    const sc = document.querySelector('[data-scroll-root]');
    scrollTimer = setInterval(() => {
      if (sc && sc.scrollHeight > sc.clientHeight) sc.scrollBy(0, dy); else window.scrollBy(0, dy);
    }, 16);
  }

  function finish(cancelled) {
    clearInterval(scrollTimer);
    if (!drag) return;
    const { data, target, ghost, src } = drag;
    ghost.remove();
    src.classList.remove('drag-source');
    target?.classList.remove('drop-over', 'drop-warn', 'drop-ok');
    document.body.classList.remove('is-dragging');
    drag = null;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 50);
    onEnd?.();
    if (!cancelled && target) onDrop(target, data);
  }

  document.addEventListener('pointerdown', (e) => {
    if (!enabled() || e.button > 0) return;
    if (e.target.closest('.chip-x, [data-no-drag]')) return;
    const el = e.target.closest('[data-drag]');
    if (!el) return;
    pending = { el, data: readData(el), x: e.clientX, y: e.clientY, pointerId: e.pointerId, type: e.pointerType };
    if (e.pointerType === 'touch') {
      pending.timer = setTimeout(() => pending && start({ clientX: pending.x, clientY: pending.y, pointerType: 'touch' }), TOUCH_HOLD_MS);
    }
  });

  document.addEventListener('pointermove', (e) => {
    if (drag) { e.preventDefault(); move(e.clientX, e.clientY); return; }
    if (!pending || e.pointerId !== pending.pointerId) return;
    const d = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
    if (pending.type === 'touch') {
      pending.x2 = e.clientX; pending.y2 = e.clientY;
      if (d > TOUCH_SLOP) { clearTimeout(pending.timer); pending = null; } // es un scroll
    } else if (d > MOUSE_THRESHOLD) {
      start(e);
    }
  }, { passive: false });

  document.addEventListener('pointerup', () => {
    if (pending) { clearTimeout(pending.timer); pending = null; }
    if (drag) finish(false);
  });
  document.addEventListener('pointercancel', () => {
    if (pending) { clearTimeout(pending.timer); pending = null; }
    if (drag) finish(true);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag) finish(true); });
  // Mientras se arrastra con el dedo, impide que la página haga scroll.
  document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-drag]')) e.preventDefault(); });
  document.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
}
