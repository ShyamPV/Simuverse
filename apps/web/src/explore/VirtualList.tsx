import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';

interface Props<T> {
  items: T[];
  rowHeight: number;
  /** Index of the selected item, or −1. */
  selected: number;
  onSelect: (index: number) => void;
  /** Enter / double-click. */
  onActivate?: (index: number) => void;
  render: (item: T, index: number, selected: boolean) => ReactNode;
  itemKey: (item: T) => string;
  label: string;
  empty?: ReactNode;
}

/** A keyboard-navigable listbox that renders only the rows in view (tens of thousands of items). */
export function VirtualList<T>({ items, rowHeight, selected, onSelect, onActivate, render, itemKey, label, empty }: Props<T>) {
  const box = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  const id = useId();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new list starts at the top.
  useEffect(() => {
    box.current?.scrollTo({ top: 0 });
    setScroll(0);
  }, [items]);

  // Keep the selected row in view.
  useEffect(() => {
    const el = box.current;
    if (!el || selected < 0) return;
    const top = selected * rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight;
  }, [selected, rowHeight]);

  const first = Math.max(0, Math.floor(scroll / rowHeight) - 4);
  const last = Math.min(items.length, Math.ceil((scroll + height) / rowHeight) + 4);

  const onKey = (e: KeyboardEvent) => {
    const page = Math.max(1, Math.floor(height / rowHeight) - 1);
    const go = (i: number) => onSelect(Math.min(Math.max(i, 0), items.length - 1));
    if (e.key === 'ArrowDown') go(selected + 1);
    else if (e.key === 'ArrowUp') go(selected - 1);
    else if (e.key === 'PageDown') go(selected + page);
    else if (e.key === 'PageUp') go(selected - page);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Enter' && selected >= 0) onActivate?.(selected);
    else return;
    e.preventDefault();
  };

  if (!items.length) return <div className="p-6 text-center text-sm text-[var(--text-dim)]">{empty}</div>;
  return (
    <div
      ref={box}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={selected >= 0 ? `${id}-${selected}` : undefined}
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      onKeyDown={onKey}
      className="relative h-full overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
    >
      <div style={{ height: items.length * rowHeight }} className="relative">
        {items.slice(first, last).map((item, k) => {
          const i = first + k;
          return (
            <div
              key={itemKey(item)}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === selected}
              onClick={() => onSelect(i)}
              onDoubleClick={() => onActivate?.(i)}
              className={`absolute inset-x-0 cursor-pointer ${i === selected ? 'bg-[var(--accent)]/20' : 'hover:bg-white/5'}`}
              style={{ top: i * rowHeight, height: rowHeight }}
            >
              {render(item, i, i === selected)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
