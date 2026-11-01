/* Four draggable page-corner handles over the preview, shown after page detection. */
(function (root) {
  'use strict';
  // A pointer position over the shown image (its bounding rect) in source pixels.
  function toImagePixels(clientX, clientY, rect, width, height) {
    return {
      x: ((clientX - rect.left) / rect.width) * width,
      y: ((clientY - rect.top) / rect.height) * height,
    };
  }

  class CornerEditor {
    // stage: the element the image fills; onChange(corners) after every handle move.
    constructor(stage, onChange) {
      this.stage = stage;
      this.onChange = onChange;
      this.corners = null;
      const svg = 'http://www.w3.org/2000/svg';
      this.outline = document.createElementNS(svg, 'svg');
      this.outline.setAttribute('class', 'page-outline');
      this.outline.setAttribute('preserveAspectRatio', 'none');
      this.outline.setAttribute('aria-hidden', 'true');
      this.polygon = document.createElementNS(svg, 'polygon');
      this.outline.append(this.polygon);
      this.handles = [0, 1, 2, 3].map((index) => {
        const handle = document.createElement('span');
        handle.className = 'page-corner';
        handle.setAttribute('aria-hidden', 'true');
        handle.addEventListener('pointerdown', (e) => this.down(e, index));
        handle.addEventListener('pointermove', (e) => this.move(e));
        for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
          handle.addEventListener(name, (e) => this.up(e));
        return handle;
      });
      this.hide();
      stage.append(this.outline, ...this.handles);
    }
    get shown() {
      return !!this.corners;
    }
    show(corners, width, height) {
      this.width = width;
      this.height = height;
      this.outline.setAttribute('viewBox', `0 0 ${width} ${height}`);
      this.stage.classList.add('page-corners');
      // toggleAttribute, not .hidden: SVG elements have no hidden property.
      for (const el of [this.outline, ...this.handles]) el.toggleAttribute('hidden', false);
      this.draw(corners);
    }
    hide() {
      this.corners = null;
      this.drag = null;
      this.stage.classList.remove('page-corners');
      for (const el of [this.outline, ...this.handles]) el.toggleAttribute('hidden', true);
    }
    draw(corners) {
      this.corners = corners;
      this.polygon.setAttribute('points', corners.map((p) => `${p.x},${p.y}`).join(' '));
      // The stage clips its content, so a corner on the photo edge keeps its whole handle
      // inside (half the 32 px handle in from the edge); the outline still marks the corner.
      const inside = (fraction) => `clamp(16px, ${fraction * 100}%, calc(100% - 16px))`;
      corners.forEach((p, i) => {
        this.handles[i].style.left = inside(p.x / this.width);
        this.handles[i].style.top = inside(p.y / this.height);
      });
    }
    down(e, index) {
      if (this.disabled || !this.corners || e.button > 0) return;
      // Keep the crop editor underneath from starting a selection or a pinch.
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      this.drag = { index, pointerId: e.pointerId };
    }
    move(e) {
      if (!this.drag || e.pointerId !== this.drag.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      const point = toImagePixels(
        e.clientX,
        e.clientY,
        this.stage.getBoundingClientRect(),
        this.width,
        this.height,
      );
      // moveCorner comes from page.js, loaded first.
      this.draw(root.moveCorner(this.corners, this.drag.index, point, this.width, this.height));
      this.onChange(this.corners);
    }
    up(e) {
      if (this.drag && e.pointerId === this.drag.pointerId) this.drag = null;
    }
  }
  root.CornerEditor = CornerEditor;
  if (typeof module !== 'undefined') module.exports = { toImagePixels };
})(typeof window === 'undefined' ? globalThis : window);
