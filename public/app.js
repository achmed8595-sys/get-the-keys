const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'keylibrary_spotify_auth';
const STATE_KEY = 'keylibrary_spotify_oauth_state';
const VERIFIER_KEY = 'keylibrary_spotify_pkce_verifier';
const REDIRECT_URI = `${window.location.origin}/`;

let config;
let auth;
let tracks = [];
let runController = null;
let rowRefs = new Map();
let toastTimer;

function showError(message) {
  const node = $('alert');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 9500);
}

function randomString(bytes = 48) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function login() {
  if (!config.clientId) return showError('Configure SPOTIFY_CLIENT_ID dans le fichier .env avant la connexion.');
  const verifier = randomString();
  const state = randomString(20);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const url = new URL('https://accounts.spotify.com/authorize');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'user-library-read',
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
    state
  });
  window.location.assign(url.toString());
}

async function tokenRequest(params) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || 'Authentification Spotify refusée.');
  return data;
}

function saveTokens(data) {
  auth = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || auth?.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

async function handleCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');
  if (!code && !oauthError) return;
  history.replaceState({}, document.title, REDIRECT_URI);
  if (oauthError) throw new Error(`Connexion Spotify refusée : ${oauthError}`);
  const state = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  if (!state || !verifier || state !== url.searchParams.get('state')) {
    throw new Error('Connexion Spotify non validée (state OAuth différent). Réessaie.');
  }
  saveTokens(await tokenRequest({
    client_id: config.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier
  }));
}

let refreshing = null;
async function accessToken(force = false) {
  if (!auth) throw new Error('Non connecté à Spotify.');
  if (!force && auth.expires_at > Date.now() + 45000) return auth.access_token;
  if (!auth.refresh_token) throw new Error('Session expirée. Connecte-toi à Spotify.');
  if (!refreshing) {
    refreshing = tokenRequest({
      client_id: config.clientId,
      grant_type: 'refresh_token',
      refresh_token: auth.refresh_token
    }).then(saveTokens).finally(() => { refreshing = null; });
  }
  await refreshing;
  return auth.access_token;
}

async function spotifyGet(endpoint) {
  const request = async (force = false) => fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${await accessToken(force)}` }
  });
  let response = await request();
  if (response.status === 401) response = await request(true);
  if (response.status === 429) throw new Error('Spotify limite temporairement les appels. Réessaie plus tard.');
  if (!response.ok) throw new Error(`Spotify a refusé la requête (HTTP ${response.status}).`);
  return response.json();
}

function connectedView(displayName) {
  $('welcome').hidden = true;
  $('dashboard').hidden = false;
  $('account').hidden = false;
  $('account-name').textContent = displayName || 'Compte Spotify';
}

function disconnectedView() {
  $('welcome').hidden = false;
  $('dashboard').hidden = true;
  $('account').hidden = true;
}

function progress(text, done = 0, total = 0) {
  $('loading-panel').hidden = false;
  $('loading-label').textContent = text;
  $('loading-numbers').textContent = total ? `${done} / ${total}` : String(done);
  $('progress-fill').style.width = total ? `${Math.min(100, done / total * 100)}%` : '0%';
}

function finishProgress() {
  $('loading-panel').hidden = true;
}

async function loadLibrary() {
  $('analyze').disabled = true;
  progress('Récupération des favoris Spotify...');
  let offset = 0;
  const limit = 50;
  tracks = [];
  rowRefs.clear();
  let total = 0;
  do {
    const page = await spotifyGet(`/me/tracks?limit=${limit}&offset=${offset}`);
    total = Number(page.total) || 0;
    for (const item of page.items || []) {
      const track = item?.track;
      if (!track?.id || !track?.name) continue;
      tracks.push({
        id: track.id,
        title: track.name,
        artists: (track.artists || []).map((artist) => artist.name).filter(Boolean),
        album: track.album?.name || '',
        cover: track.album?.images?.at(-1)?.url || '',
        url: track.external_urls?.spotify || '',
        isrc: track.external_ids?.isrc || '',
        key: null,
        source: null,
        state: 'pending'
      });
    }
    offset += (page.items || []).length;
    progress('Récupération des favoris Spotify...', Math.min(offset, total), total);
    // Le nombre total peut changer si un like est ajouté en parallèle.
    if (!page.next || !page.items?.length) break;
  } while (true);

  renderRows();
  updateStats();
  fillKeyFilter();
  finishProgress();
  $('analyze').disabled = !config.hasFreqBlogKey || tracks.length === 0;
  if (!config.hasFreqBlogKey) {
    showError('Favoris chargés. Ajoute FREQBLOG_API_KEY au fichier .env pour obtenir les tonalités.');
  } else if (tracks.length) {
    void analyzeAll();
  }
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function renderRows() {
  const fragment = document.createDocumentFragment();
  rowRefs = new Map();
  for (let index = 0; index < tracks.length; index++) {
    const song = tracks[index];
    const row = document.createElement('tr');
    row.dataset.index = index;
    const numberTd = document.createElement('td');
    numberTd.append(makeElement('span', 'track-index', String(index + 1).padStart(2, '0')));
    const titleTd = document.createElement('td');
    const trackCell = makeElement('div', 'track-cell');
    let image;
    if (song.cover && song.cover.startsWith('https://')) {
      image = document.createElement('img');
      image.src = song.cover;
      image.alt = '';
      image.loading = 'lazy';
      image.className = 'track-cover';
    } else {
      image = makeElement('span', 'track-cover track-cover-empty', '♪');
    }
    const titleGroup = document.createElement('div');
    const titleSpan = makeElement('span', 'track-title');
    if (song.url.startsWith('https://open.spotify.com/')) {
      const link = makeElement('a', '', song.title);
      link.href = song.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      titleSpan.append(link);
    } else titleSpan.textContent = song.title;
    titleGroup.append(titleSpan, makeElement('span', 'track-album', song.album));
    trackCell.append(image, titleGroup);
    titleTd.append(trackCell);
    const artistTd = makeElement('td', 'artist-name', song.artists.join(', '));
    const keyTd = document.createElement('td');
    const key = makeElement('span', 'key-pill key-empty', 'En attente');
    keyTd.append(key);
    row.append(numberTd, titleTd, artistTd, keyTd);
    rowRefs.set(song.id, { row, keyTd, key });
    fragment.append(row);
  }
  $('track-list').replaceChildren(fragment);
  updateVisibility();
}

function updateTrackKey(song) {
  const ref = rowRefs.get(song.id);
  if (!ref) return;
  ref.key.className = `key-pill${song.state === 'found' ? '' : ' key-empty'}${song.state === 'error' ? ' key-error' : ''}`;
  ref.key.textContent = song.state === 'found' ? song.key
    : song.state === 'unknown' ? 'Inconnue'
    : song.state === 'error' ? 'Erreur'
    : song.state === 'loading' ? 'Recherche...' : 'En attente';

}

function fillKeyFilter() {
  const oldValue = $('filter').value;
  const keys = [...new Set(tracks.filter((t) => t.state === 'found').map((t) => t.key))].sort();
  const base = [
    ['all', 'Toutes les tonalités'],
    ['unknown', 'Tonalité inconnue'],
    ['pending', 'Non analysés'],
    ['error', 'Erreurs']
  ];
  const options = [...base, ...keys.map((key) => [`key:${key}`, key])];
  $('filter').replaceChildren(...options.map(([value, label]) => {
    const option = makeElement('option', '', label);
    option.value = value;
    return option;
  }));
  $('filter').value = options.some(([value]) => value === oldValue) ? oldValue : 'all';
}

function sortRows() {
  const mode = $('sort').value;
  const entries = tracks.map((song, index) => ({ song, index }));
  const collator = new Intl.Collator('fr', { sensitivity: 'base' });
  if (mode !== 'date') {
    entries.sort((a, b) => {
      const value = (item) => mode === 'title' ? item.title
        : mode === 'artist' ? item.artists[0] || '' : item.key || 'zzz';
      return collator.compare(value(a.song), value(b.song)) || a.index - b.index;
    });
  }
  const fragment = document.createDocumentFragment();
  for (const entry of entries) fragment.append(rowRefs.get(entry.song.id).row);
  $('track-list').append(fragment);
  updateVisibility();
}

function updateVisibility() {
  const query = $('search').value.trim().toLocaleLowerCase('fr');
  const filter = $('filter').value;
  let visible = 0;
  for (const song of tracks) {
    const ref = rowRefs.get(song.id);
    if (!ref) continue;
    const text = `${song.title} ${song.artists.join(' ')} ${song.album}`.toLocaleLowerCase('fr');
    const matchesSearch = !query || text.includes(query);
    const matchesFilter = filter === 'all'
      || (filter === 'pending' && ['pending', 'loading'].includes(song.state))
      || (filter === 'unknown' && song.state === 'unknown')
      || (filter === 'error' && song.state === 'error')
      || (filter.startsWith('key:') && song.key === filter.slice(4));
    const show = matchesSearch && matchesFilter;
    ref.row.hidden = !show;
    if (show) visible++;
  }
  $('visible-count').textContent = `${visible} titre${visible > 1 ? 's' : ''} affiché${visible > 1 ? 's' : ''}`;
  $('empty-results').hidden = visible !== 0 || tracks.length === 0;
}

function updateStats() {
  $('stat-total').textContent = tracks.length.toLocaleString('fr-FR');
  $('stat-found').textContent = tracks.filter((s) => s.state === 'found').length.toLocaleString('fr-FR');
  $('stat-unknown').textContent = tracks.filter((s) => s.state === 'unknown').length.toLocaleString('fr-FR');
}

async function analyzeAll() {
  if (runController || !config.hasFreqBlogKey) return;
  const tasks = tracks.filter((s) => s.state === 'pending' || s.state === 'error');
  if (!tasks.length) return;
  runController = new AbortController();
  const signal = runController.signal;
  $('stop').hidden = false;
  $('analyze').disabled = true;
  let completed = 0;
  let nextIndex = 0;
  let providerLimit = false;
  progress('Analyse des tonalités...', 0, tasks.length);

  async function worker() {
    while (!signal.aborted && !providerLimit && nextIndex < tasks.length) {
      const song = tasks[nextIndex++];
      song.state = 'loading';
      updateTrackKey(song);
      try {
        const params = new URLSearchParams({ title: song.title, artist: song.artists[0] || '', isrc: song.isrc || '' });
        const response = await fetch(`/api/key?${params}`, { signal });
        const result = await response.json();
        if (!response.ok) {
          if (response.status === 429) providerLimit = true;
          throw new Error(result.error || `Erreur HTTP ${response.status}`);
        }
        song.key = result.key || null;
        song.source = result.source || null;
        song.state = song.key ? 'found' : result.pending ? 'pending' : 'unknown';
      } catch (error) {
        if (signal.aborted) {
          song.state = 'pending';
          updateTrackKey(song);
          break;
        }
        song.state = 'error';
        if (providerLimit) showError(error.message);
      }
      completed++;
      updateTrackKey(song);
      updateStats();
      progress('Analyse des tonalités...', completed, tasks.length);
      if ($('filter').value !== 'all') updateVisibility();
    }
  }
  await Promise.all([worker(), worker()]);
  runController = null;
  $('stop').hidden = true;
  $('analyze').disabled = false;
  $('analyze').textContent = '↻ Relancer les erreurs';
  finishProgress();
  fillKeyFilter();
  sortRows();
  if (providerLimit) showError('Limite FreqBlog atteinte. Relance l’analyse après la fin de la limitation.');
}

function stopAnalysis() {
  runController?.abort();
}

function logout() {
  stopAnalysis();
  auth = null;
  sessionStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  tracks = [];
  rowRefs.clear();
  $('track-list').replaceChildren();
  $('search').value = '';
  $('sort').value = 'date';
  finishProgress();
  disconnectedView();
}

$('login').addEventListener('click', () => void login().catch((error) => showError(error.message)));
$('logout').addEventListener('click', logout);
$('analyze').addEventListener('click', () => void analyzeAll());
$('stop').addEventListener('click', stopAnalysis);
$('search').addEventListener('input', updateVisibility);
$('filter').addEventListener('change', updateVisibility);
$('sort').addEventListener('change', sortRows);

async function init() {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('Impossible de lire la configuration du serveur.');
  config = await response.json();
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (stored) {
    try { auth = JSON.parse(stored); } catch { sessionStorage.removeItem(STORAGE_KEY); }
  }
  await handleCallback();
  if (!auth) {
    disconnectedView();
    if (!config.clientId) showError('Pour démarrer, ajoute ton Client ID Spotify dans .env puis relance le serveur.');
    return;
  }
  connectedView('Spotify');
  await loadLibrary();
}

init().catch((error) => {
  console.error(error);
  showError(error.message || 'Erreur inattendue.');
  if (auth) {
    // Une erreur d’API ne doit pas vider silencieusement la session.
    connectedView('Spotify');
    $('analyze').disabled = true;
  } else disconnectedView();
});
