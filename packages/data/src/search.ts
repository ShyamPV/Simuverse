/**
 * Name search across every catalogue (bodies, stars, deep-sky objects,
 * galaxies, exoplanets, satellites, constellations), for the command palette
 * and for resolving the stable references used in shareable URLs.
 *
 * Matching is accent-, case- and spacing-insensitive, so "m 31", "M31" and
 * "ngc224" all work, and Greek letters match their spelled-out names.
 */

export type SearchKind =
  | 'body' | 'moon' | 'star' | 'galaxy' | 'nebula' | 'cluster' | 'exoplanet' | 'system' | 'satellite'
  | 'constellation' | 'region' | 'small-body' | 'black-hole' | 'neutron-star';

export interface SearchEntry {
  /** Engine selection key ('body:jupiter', 'gal:2', 'exo:12', …). */
  key: string;
  /** Stable reference for URLs (a catalogue designation or name that survives data rebuilds). */
  ref: string;
  name: string;
  aliases?: string[];
  kind: SearchKind;
  /** Short context line ("Spiral galaxy · 0.78 Mpc"). */
  detail?: string;
  /** Prominence, 0 (most) … 100 (least): breaks ties between equally good matches. */
  rank: number;
}

export interface SearchHit {
  entry: SearchEntry;
  score: number;
  /** The name or alias that matched. */
  matched: string;
}

const GREEK_NAMES: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa',
  λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', ο: 'omicron', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', υ: 'upsilon',
  φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
};
const SUPERSCRIPTS: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/** Lower case, no accents, Greek letters spelled out, punctuation → spaces, single-spaced. */
export function normalizeName(s: string): string {
  return s
    .replace(/[α-ω]/g, (g) => ` ${GREEK_NAMES[g] ?? g} `)
    .replace(/[⁰-⁹¹²³]/g, (d) => SUPERSCRIPTS[d] ?? d)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim();
}

const compact = (s: string) => s.replace(/ /g, '');

interface Indexed {
  entry: SearchEntry;
  names: { raw: string; norm: string; compact: string; words: string[] }[];
}

export class SearchIndex {
  private readonly items: Indexed[] = [];
  private readonly refs = new Map<string, SearchEntry>();
  private readonly keys = new Map<string, SearchEntry>();

  get size(): number {
    return this.items.length;
  }

  add(entries: Iterable<SearchEntry>): void {
    for (const entry of entries) {
      if (this.keys.has(entry.key)) continue;
      const names = [entry.name, ...(entry.aliases ?? [])].filter(Boolean).map((raw) => {
        const norm = normalizeName(raw);
        return { raw, norm, compact: compact(norm), words: norm.split(' ') };
      });
      this.items.push({ entry, names });
      this.keys.set(entry.key, entry);
      const ref = normalizeName(entry.ref);
      if (!this.refs.has(ref)) this.refs.set(ref, entry);
    }
  }

  byKey(key: string): SearchEntry | undefined {
    return this.keys.get(key);
  }

  entries(filter: (e: SearchEntry) => boolean = () => true): SearchEntry[] {
    return this.items.map((i) => i.entry).filter(filter);
  }

  /** Resolves a stable reference (exact, then by unique name/alias match). */
  resolve(ref: string): SearchEntry | undefined {
    const norm = normalizeName(ref);
    const exact = this.refs.get(norm);
    if (exact) return exact;
    const hits = this.search(ref, 2);
    return hits[0] && hits[0].score >= 900 ? hits[0].entry : undefined;
  }

  search(query: string, limit = 30, filter?: (e: SearchEntry) => boolean): SearchHit[] {
    const q = normalizeName(query);
    if (!q) return [];
    const qc = compact(q);
    const qWords = q.split(' ');
    const hits: SearchHit[] = [];
    for (const item of this.items) {
      if (filter && !filter(item.entry)) continue;
      let best = 0, matched = '';
      for (const n of item.names) {
        let s = 0;
        if (n.norm === q || n.compact === qc) s = 1000;
        else if (n.compact.startsWith(qc)) s = 800 - Math.min(n.compact.length - qc.length, 100);
        else if (qWords.every((w) => n.words.some((nw) => nw.startsWith(w)))) s = 600 - Math.min(n.words.length, 20);
        else if (qc.length >= 3 && n.compact.includes(qc)) s = 400;
        if (s > best) {
          best = s;
          matched = n.raw;
        }
      }
      if (best > 0) hits.push({ entry: item.entry, score: best + (100 - Math.min(Math.max(item.entry.rank, 0), 100)) * 0.5, matched });
    }
    hits.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
    return hits.slice(0, limit);
  }
}
