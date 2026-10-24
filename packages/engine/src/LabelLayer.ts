/**
 * Screen-space labels as pooled DOM nodes, positioned with transforms each
 * frame (no React involvement in the render loop).
 */

export interface LabelItem {
  key: string;
  text: string;
  kind: 'body' | 'star';
  x: number;
  y: number;
  /** Draw a marker dot at (x, y) — used when the object is under a few pixels. */
  marker: boolean;
  /** Horizontal gap between the anchor and the text, px. */
  offset: number;
  color?: string;
  focused?: boolean;
}

export class LabelLayer {
  private readonly nodes = new Map<string, HTMLDivElement>();
  private readonly root: HTMLDivElement;

  constructor(container: HTMLElement, private readonly onActivate: (key: string) => void) {
    this.root = document.createElement('div');
    this.root.className = 'sv-labels';
    this.root.setAttribute('aria-hidden', 'true');
    container.appendChild(this.root);
  }

  private node(item: LabelItem): HTMLDivElement {
    let el = this.nodes.get(item.key);
    if (!el) {
      el = document.createElement('div');
      el.className = `sv-label sv-label--${item.kind}`;
      el.innerHTML = '<span class="sv-label__dot"></span><span class="sv-label__text"></span>';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onActivate(item.key);
      });
      this.root.appendChild(el);
      this.nodes.set(item.key, el);
    }
    return el;
  }

  render(items: readonly LabelItem[]): void {
    const seen = new Set<string>();
    for (const it of items) {
      seen.add(it.key);
      const el = this.node(it);
      const text = el.lastElementChild as HTMLSpanElement;
      if (text.textContent !== it.text) text.textContent = it.text;
      el.style.transform = `translate3d(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px, 0)`;
      el.style.setProperty('--sv-label-offset', `${it.offset.toFixed(1)}px`);
      if (it.color) el.style.setProperty('--sv-label-color', it.color);
      el.classList.toggle('is-marker', it.marker);
      el.classList.toggle('is-focused', !!it.focused);
      el.hidden = false;
    }
    for (const [key, el] of this.nodes) if (!seen.has(key)) el.hidden = true;
  }

  dispose(): void {
    this.root.remove();
    this.nodes.clear();
  }
}
