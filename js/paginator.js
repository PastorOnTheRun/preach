// Paginates a reading "flow" element into screen-sized pages using CSS columns.
// Each column = one page; we slide the flow horizontally. Position is tracked as a
// character offset (first character on the current page) so changing text size or
// rotating the iPad keeps the preacher at the same spot.

export class Paginator {
  constructor(viewport, flow, { onChange } = {}) {
    this.viewport = viewport;
    this.flow = flow;
    this.onChange = onChange || (() => {});
    this.page = 0;
    this.pages = 1;
    this.stride = 1;
    this.anchor = 0; // global char index of the first char on the current page
    this.nodes = [];
    this.offsets = [];
    this.total = 0;
    this._ro = new ResizeObserver(() => this._onResize());
  }

  /** Call after replacing flow content. */
  setContent(anchor = 0) {
    this._indexText();
    this.anchor = Math.min(anchor, Math.max(0, this.total - 1));
    this.layout();
    this._ro.observe(this.viewport);
  }

  stop() { this._ro.disconnect(); }

  _indexText() {
    const w = document.createTreeWalker(this.flow, NodeFilter.SHOW_TEXT, { acceptNode: n => /\S/.test(n.nodeValue) ? 1 : 3 });
    this.nodes = []; this.offsets = []; let t = 0;
    while (w.nextNode()) { this.nodes.push(w.currentNode); this.offsets.push(t); t += w.currentNode.nodeValue.length; }
    this.total = t;
  }

  _onResize() {
    clearTimeout(this._rt);
    this._rt = setTimeout(() => {
      const w = this.viewport.clientWidth, h = this.viewport.clientHeight;
      if (w === this._lw && h === this._lh) return;
      this.layout();
    }, 80);
  }

  /** Recompute columns & page count, then return to the anchored text. */
  layout() {
    const vp = this.viewport, flow = this.flow;
    const vw = vp.clientWidth, vh = vp.clientHeight;
    this._lw = vw; this._lh = vh;
    if (!vw || !vh) return;
    const fs = parseFloat(getComputedStyle(flow).fontSize) || 30;
    const padX = Math.round(Math.max(18, Math.min(64, vw * 0.05)));
    const padTop = Math.round(Math.max(14, Math.min(40, vh * 0.04)));
    const padBottom = Math.round(Math.max(10, Math.min(28, vh * 0.03)));
    // Comfortable line length (~65–75 characters), but use full width on small screens.
    const W = Math.floor(Math.min(vw - padX * 2, fs * 34));
    const H = Math.floor(vh - padTop - padBottom);
    const gap = vw - W;
    flow.classList.add('no-anim');
    Object.assign(flow.style, {
      width: W + 'px', height: H + 'px', top: padTop + 'px', left: Math.floor((vw - W) / 2) + 'px',
      columnWidth: W + 'px', columnGap: gap + 'px', webkitColumnWidth: W + 'px', webkitColumnGap: gap + 'px'
    });
    this.stride = vw;
    // Count pages using an end sentinel.
    let end = flow.querySelector(':scope > .pg-end');
    if (!end) { end = document.createElement('span'); end.className = 'pg-end'; flow.appendChild(end); }
    const fr = flow.getBoundingClientRect();
    const er = end.getBoundingClientRect();
    this.pages = Math.max(1, Math.floor((er.left - fr.left + 1) / this.stride) + 1);
    this.page = this.total ? Math.min(this.pages - 1, this.pageOfChar(this.anchor)) : 0;
    this._apply();
    void flow.offsetWidth;
    flow.classList.remove('no-anim');
  }

  _locate(i) {
    let lo = 0, hi = this.offsets.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.offsets[mid] <= i) lo = mid; else hi = mid - 1; }
    return [this.nodes[lo], i - this.offsets[lo]];
  }

  /** x offset (relative to flow) of a character, or null if it has no box (collapsed whitespace). */
  _charX(i) {
    const [node, off] = this._locate(i);
    if (!node) return null;
    const r = document.createRange();
    r.setStart(node, off); r.setEnd(node, Math.min(node.nodeValue.length, off + 1));
    const rects = r.getClientRects();
    if (!rects.length || (rects[0].width === 0 && rects[0].height === 0)) return null;
    return rects[0].left - this.flow.getBoundingClientRect().left;
  }

  pageOfChar(i) {
    for (let k = 0; k < 24 && i + k < this.total; k++) {
      const x = this._charX(i + k);
      if (x != null) return Math.max(0, Math.floor((x + 2) / this.stride));
    }
    return this.pages - 1;
  }

  /** First character index on page p (binary search; pages increase monotonically in text order). */
  firstCharOnPage(p) {
    if (!this.total || p <= 0) return 0;
    let lo = 0, hi = this.total - 1, ans = this.total - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.pageOfChar(mid) >= p) { ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return ans;
  }

  _apply() {
    this.flow.style.transform = `translate3d(${-this.page * this.stride}px,0,0)`;
    this.onChange(this.page, this.pages);
  }

  goTo(p) {
    p = Math.max(0, Math.min(this.pages - 1, p));
    const changed = p !== this.page;
    this.page = p;
    this.anchor = this.firstCharOnPage(p);
    this._apply();
    return changed;
  }
  next() { return this.goTo(this.page + 1); }
  prev() { return this.goTo(this.page - 1); }
}
