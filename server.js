import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { normalizedArtist, normalizedTitle } from './matching.js';
import { normalizeKey } from './tonality.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Fichier .env lu sans bibliothèque externe.
try {
  const lines = fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const PORT = Number(process.env.PORT || 3000);
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID?.trim() || '';
const FREQBLOG_API_KEY = process.env.FREQBLOG_API_KEY?.trim() || '';
const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'keys.json');

let cache = {};
try {
  if (fs.existsSync(CACHE_FILE)) cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
} catch (error) {
  console.warn('Cache illisible, nouveau cache :', error.message);
}

function saveCache() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const temp = `${CACHE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(cache), { mode: 0o600 });
  fs.renameSync(temp, CACHE_FILE);
}

// Les recherches partent exclusivement du serveur afin de garder la clé secrète.
// Les recherches catalogue FreqBlog n'ont pas de limite par minute, mais le plan
// gratuit comporte un quota mensuel et une limite de concurrence.
async function providerLookup(params) {
  const url = new URL('https://api.freqblog.com/lookup');
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  url.searchParams.set('wait', '10'); // Attend brièvement l'analyse à la demande.
  const response = await fetch(url, {
    headers: { 'X-Api-Key': FREQBLOG_API_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(22000)
  });
  if (response.status === 202) return { pending: true };
  if (response.status === 404) return { missing: true };
  if (response.status === 429) {
    const error = new Error('Quota ou concurrence FreqBlog atteint : réessaie plus tard.');
    error.status = 429;
    throw error;
  }
  if (response.status === 401 || response.status === 403) {
    const error = new Error('Clé FreqBlog refusée. Vérifie FREQBLOG_API_KEY.');
    error.status = 502;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`FreqBlog ne répond pas correctement (HTTP ${response.status}).`);
    error.status = 502;
    throw error;
  }
  return response.json();
}

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(JSON.stringify(payload));
}

async function keyHandler(url, res) {
  if (!FREQBLOG_API_KEY) {
    return json(res, 503, { error: 'Renseigne FREQBLOG_API_KEY dans le fichier .env.' });
  }
  const title = url.searchParams.get('title')?.trim() || '';
  const artist = url.searchParams.get('artist')?.trim() || '';
  const isrc = url.searchParams.get('isrc')?.trim().toUpperCase() || '';
  if (!title || !artist || title.length > 250 || artist.length > 150 || (isrc && !/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(isrc))) {
    return json(res, 400, { error: 'Titre, artiste ou ISRC invalide.' });
  }

  const cacheKey = isrc ? `isrc:${isrc}` : `${normalizedTitle(title)}|${normalizedArtist(artist)}`;
  const entry = cache[cacheKey];
  const maxAge = entry?.pending ? 45_000 : entry?.key ? 365 * 86400000 : 86400000;
  if (entry && Date.now() - entry.checkedAt < maxAge) {
    return json(res, 200, { key: entry.key, source: null, pending: Boolean(entry.pending), cached: true });
  }

  try {
    // Le code ISRC désigne l'enregistrement exact, plus fiable qu'un titre partagé.
    let result = isrc ? await providerLookup({ isrc }) : { missing: true };
    if (result.missing) result = await providerLookup({ track: title, artist });
    const key = normalizeKey(result.key);
    const pending = Boolean(result.pending);
    cache[cacheKey] = { key, pending, checkedAt: Date.now() };
    saveCache();
    json(res, 200, { key, source: null, pending, cached: false });
  } catch (error) {
    console.error('FreqBlog :', error.message);
    json(res, error.status || 502, { error: error.status ? error.message : 'Erreur réseau avec FreqBlog. Réessaie.' });
  }
}

const staticAssets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8']
};

// Réservé à la machine locale. Un déploiement public exigerait une authentification backend.
const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET') return json(res, 405, { error: 'Méthode non autorisée.' });
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === '/api/config') {
      return json(res, 200, { clientId: SPOTIFY_CLIENT_ID, hasFreqBlogKey: Boolean(FREQBLOG_API_KEY) });
    }
    if (url.pathname === '/api/key') return await keyHandler(url, res);
    const asset = staticAssets[url.pathname];
    if (!asset) return json(res, 404, { error: 'Page introuvable.' });
    const body = fs.readFileSync(path.join(__dirname, 'public', asset[0]));
    res.writeHead(200, {
      'Content-Type': asset[1],
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch (error) {
    console.error('Erreur serveur :', error);
    json(res, 500, { error: 'Erreur interne du serveur.' });
  }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Spotify Tonalités : http://127.0.0.1:${PORT}`);
  if (!SPOTIFY_CLIENT_ID) console.log('⚠ SPOTIFY_CLIENT_ID manquant dans .env');
  if (!FREQBLOG_API_KEY) console.log('⚠ FREQBLOG_API_KEY manquant dans .env');
});
