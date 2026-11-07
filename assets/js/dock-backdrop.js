const contentSelector = [
  '#hero', '.browse-header', '.row-header', '.card', '.skeleton-card',
  '.livetv-section-header', '.channel-card', '.player-header', '.player-actions',
  '.end-message', '.site-footer'
].join(', ');
const svgNS = 'http://www.w3.org/2000/svg';

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function copyStyle(source, target) {
  const declarations = [];
  for (let index = 0; index < source.length; index++) {
    const property = source.item(index);
    if (/^(--|(?:-webkit-)?(?:animation|transition))/.test(property) || property === 'content') continue;
    declarations.push(property + ':' + source.getPropertyValue(property));
  }
  target.style.cssText = declarations.join(';');
}

function snapshot(source, style = getComputedStyle(source)) {
  if (source.matches('iframe, video, script, style, object, embed, source, link, track, audio') ||
      style.display === 'none' || style.position === 'fixed' || Number(style.opacity) === 0) return null;
  const copy = source.cloneNode(false);
  for (const name of copy.getAttributeNames()) {
    if (/^(on|aria-|data-)/.test(name) || ['id', 'class', 'style', 'name', 'for', 'autofocus', 'srcset', 'sizes', 'loading'].includes(name)) {
      copy.removeAttribute(name);
    }
  }
  if (source instanceof HTMLImageElement && source.currentSrc) copy.src = source.currentSrc;
  copyStyle(style, copy);

  for (const node of source.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) copy.append(node.textContent);
    else if (node instanceof Element) {
      const child = snapshot(node);
      if (child) copy.append(child);
    }
  }
  if (source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement || source instanceof HTMLSelectElement) {
    copy.value = source.value;
  }

  for (const pseudo of ['::before', '::after']) {
    if (source.namespaceURI === svgNS) continue;
    const pseudoStyle = getComputedStyle(source, pseudo);
    if (!/^["']/.test(pseudoStyle.content) || pseudoStyle.display === 'none') continue;
    const decoration = document.createElement('span');
    decoration.textContent = pseudoStyle.content.slice(1, -1);
    copyStyle(pseudoStyle, decoration);
    if (pseudo === '::before') copy.prepend(decoration);
    else copy.append(decoration);
  }
  return copy;
}

function clippingAncestors(source) {
  const clips = [];
  for (let parent = source.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(parent);
    const x = overflowX !== 'visible';
    const y = overflowY !== 'visible';
    if (x || y) clips.push({ parent, x, y });
  }
  return clips;
}

// WebKit cannot displace a live CSS backdrop. Copy only the in-flow blocks
// that overlap this strip, including their text and overlays, into the scene
// that Glisse displaces. The filtered surface stays the size of the dock.
export function mountDockBackdrop(wrapper, slot) {
  const windowLayer = document.createElement('div');
  windowLayer.className = 'dock-backdrop-window';
  windowLayer.setAttribute('aria-hidden', 'true');
  windowLayer.inert = true;
  const scene = document.createElement('div');
  scene.className = 'dock-backdrop';
  scene.setAttribute('data-glisse-backdrop', '');
  windowLayer.append(scene);

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  const clip = document.createElementNS(svgNS, 'clipPath');
  clip.id = 'dock-backdrop-clip';
  const outlines = [0, 1].map(() => document.createElementNS(svgNS, 'rect'));
  clip.append(...outlines);
  svg.append(clip);
  wrapper.prepend(svg, windowLayer);

  const candidates = new Set();
  const tiles = new Map();
  const dirty = new Set();
  let frame = 0;
  const requestPaint = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) candidates.add(entry.target);
      else candidates.delete(entry.target);
    }
    requestPaint();
  });

  function fitClip() {
    const bounds = windowLayer.getBoundingClientRect();
    if (!bounds.width) return;

    const surfaces = wrapper.querySelectorAll('.lg-tab-bar, .dock-search-btn');
    surfaces.forEach((surface, index) => {
      const box = surface.getBoundingClientRect();
      const outline = outlines[index];
      outline.setAttribute('x', box.left - bounds.left);
      outline.setAttribute('y', box.top - bounds.top);
      outline.setAttribute('width', box.width);
      outline.setAttribute('height', box.height);
      outline.setAttribute('rx', box.height / 2);
    });
    for (const source of tiles.keys()) dirty.add(source);
    requestPaint();
  }

  function paint() {
    frame = 0;
    const bounds = windowLayer.getBoundingClientRect();
    if (!bounds.width) return;
    const visible = new Set();
    const sources = [];
    for (const source of candidates) {
      if (!source.isConnected) continue;
      const rect = source.getBoundingClientRect();
      if (rect.width && rect.height && overlaps(rect, bounds)) {
        sources.push({ source, rect, width: source.offsetWidth, height: source.offsetHeight });
      }
    }
    sources.sort((a, b) => (a.source.compareDocumentPosition(b.source) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    const clipRects = new Map();
    for (const { source, rect, width, height } of sources) {
      let tile = tiles.get(source);
      if (!tile || dirty.has(source)) {
        const copy = snapshot(source);
        dirty.delete(source);
        if (!copy) continue;
        copy.style.position = 'absolute';
        copy.style.inset = '0 auto auto 0';
        copy.style.margin = '0';
        copy.style.transformOrigin = '0 0';
        const clips = clippingAncestors(source);
        if (tile) {
          tile.element.replaceChildren(copy);
          Object.assign(tile, { copy, clips });
        } else {
          const element = document.createElement('div');
          element.className = 'dock-backdrop-tile';
          element.append(copy);
          tile = { element, copy, clips };
          tiles.set(source, tile);
          scene.append(element);
        }
      }
      const inset = [0, 0, 0, 0];
      for (const { parent, x, y } of tile.clips) {
        if (!clipRects.has(parent)) clipRects.set(parent, parent.getBoundingClientRect());
        const clip = clipRects.get(parent);
        if (x) {
          inset[1] = Math.max(inset[1], rect.right - clip.right);
          inset[3] = Math.max(inset[3], clip.left - rect.left);
        }
        if (y) {
          inset[0] = Math.max(inset[0], clip.top - rect.top);
          inset[2] = Math.max(inset[2], rect.bottom - clip.bottom);
        }
      }
      Object.assign(tile.element.style, {
        left: rect.left - bounds.left + 'px',
        top: rect.top - bounds.top + 'px',
        width: rect.width + 'px',
        height: rect.height + 'px',
        clipPath: inset.some(Boolean) ? `inset(${inset.map(px => px + 'px').join(' ')})` : 'none',
        zIndex: String(visible.size)
      });
      tile.copy.style.transform = `scale(${rect.width / (width || rect.width)}, ${rect.height / (height || rect.height)})`;
      visible.add(source);
    }
    for (const [source, tile] of tiles) {
      if (visible.has(source)) continue;
      tile.element.remove();
      tiles.delete(source);
      dirty.delete(source);
    }
  }

  function observeContent(node, method) {
    if (!(node instanceof Element)) return;
    if (node.matches(contentSelector)) intersection[method](node);
    for (const source of node.querySelectorAll(contentSelector)) intersection[method](source);
  }

  function invalidate(node) {
    const element = node instanceof Element ? node : node.parentElement;
    const source = element?.closest(contentSelector);
    if (tiles.has(source)) dirty.add(source);
  }

  const mutations = new MutationObserver(records => {
    for (const record of records) {
      invalidate(record.target);
      for (const node of record.removedNodes) observeContent(node, 'unobserve');
      for (const node of record.addedNodes) observeContent(node, 'observe');
    }
    for (const source of candidates) {
      if (!source.isConnected) candidates.delete(source);
    }
    requestPaint();
  });
  document.querySelectorAll('main, .site-footer').forEach(content => {
    observeContent(content, 'observe');
    mutations.observe(content, {
      subtree: true, childList: true, characterData: true, attributeFilter: ['class', 'style', 'src']
    });
    for (const name of ['load', 'pointerover', 'pointerout', 'input', 'change']) {
      content.addEventListener(name, event => {
        invalidate(event.target);
        requestPaint();
      }, true);
    }
  });

  const resize = new ResizeObserver(fitClip);
  resize.observe(wrapper);
  resize.observe(slot);
  window.addEventListener('scroll', requestPaint, { capture: true, passive: true });
  window.visualViewport?.addEventListener('resize', requestPaint);
}
