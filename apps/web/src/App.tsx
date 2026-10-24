import { useEffect } from 'react';
import { BODY_SHORTCUTS, stepRate } from './bodies.ts';
import { HelpOverlay } from './components/HelpOverlay.tsx';
import { Hud, PerfOverlay } from './components/Hud.tsx';
import { InfoPanel } from './components/InfoPanel.tsx';
import { LeftNav } from './components/LeftNav.tsx';
import { TimeBar } from './components/TimeBar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { UniverseView } from './components/UniverseView.tsx';
import { useApp } from './state/store.ts';

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const s = useApp.getState();
      const engine = s.engine;
      const body = BODY_SHORTCUTS.find((b) => b.key === e.key);
      if (body) {
        engine?.focus(body.id);
        return;
      }
      switch (e.key) {
        case ' ':
          if (target?.tagName === 'BUTTON') return; // let Space activate the focused button
          engine?.time.setPaused(!engine.time.paused);
          break;
        case '[': engine?.time.setRate(stepRate(engine.time.rate, -1)); break;
        case ']': engine?.time.setRate(stepRate(engine.time.rate, 1)); break;
        case 'n': case 'N': engine?.time.resetToNow(); break;
        case 'l': case 'L': s.set({ showLabels: !s.showLabels }); break;
        case 'o': case 'O': s.set({ showOrbits: !s.showOrbits }); break;
        case 'i': case 'I': s.set({ infoOpen: !s.infoOpen }); break;
        case 'p': case 'P': s.set({ showPerf: !s.showPerf }); break;
        case '?': case 'h': case 'H': s.set({ helpOpen: !s.helpOpen }); break;
        case 'c': case 'C': document.querySelector<HTMLButtonElement>('[aria-label="Save screenshot"]')?.click(); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const theme = useApp((s) => s.theme);
  useGlobalShortcuts();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <main className="relative h-full w-full overflow-hidden bg-space-950">
      <h1 className="sr-only">Simuverse — explore the universe in 3D</h1>
      <UniverseView />
      <TopBar />
      <LeftNav />
      <InfoPanel />
      <Hud />
      <PerfOverlay />
      <TimeBar />
      <HelpOverlay />
    </main>
  );
}
