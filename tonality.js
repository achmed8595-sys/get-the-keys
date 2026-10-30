// Convertit les noms de tonalité FreqBlog en notation compacte (C, F#m, Bb...).
export function normalizeKey(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/♭/g, 'b').replace(/♯/g, '#');
  if (!text || /^unknown|n\/?a|none$/i.test(text)) return null;
  const match = text.match(/^([A-Ga-g])([#b]?)(?:\s*[-_ ]?\s*(Major|Minor|Maj|Min|m))?$/i);
  if (!match) return null;
  const note = match[1].toUpperCase() + match[2];
  const mode = match[3] || '';
  const minor = /^(minor|min|m)$/i.test(mode);
  return note + (minor ? 'm' : '');
}
