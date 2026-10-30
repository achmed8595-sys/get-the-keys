// Fonctions pures, testées séparément.
export function normalizedTitle(value = '') {
  return String(value)
    .replace(/[\[(]\s*(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|deluxe edition)\s*[\])]/gi, '')
    .replace(/\s*[-–]\s*(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|deluxe edition)\s*$/gi, '')
    .replace(/[\[(]\s*(?:feat\.?|ft\.?)\s+[^\])]+[\])]/gi, '')
    .replace(/\s*[-–]\s*(?:feat\.?|ft\.?)\s+.+$/gi, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizedArtist(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function artistNames(song) {
  const raw = Array.isArray(song?.artist) ? song.artist : [song?.artist];
  return raw.map((item) => (typeof item === 'string' ? item : item?.name)).filter(Boolean);
}

export function bestMatchingSong(songs, title, artist) {
  const titleKey = normalizedTitle(title);
  const artistKey = normalizedArtist(artist);
  if (!titleKey || !artistKey) return null;

  let best = null;
  let bestScore = 0;
  for (const song of Array.isArray(songs) ? songs : []) {
    const candidateTitle = normalizedTitle(song?.title);
    // Pas de rapprochement approximatif des titres : éviter de confondre live/remix et studio.
    if (candidateTitle !== titleKey) continue;
    const names = artistNames(song).map(normalizedArtist);
    const artistMatch = names.some((name) => name === artistKey);
    const artistPartial = names.some((name) =>
      (name.length >= 4 && artistKey.length >= 4) &&
      (name.includes(artistKey) || artistKey.includes(name))
    );
    const score = artistMatch ? 2 : artistPartial ? 1 : 0;
    if (score > bestScore) {
      best = song;
      bestScore = score;
    }
  }
  return best;
}
