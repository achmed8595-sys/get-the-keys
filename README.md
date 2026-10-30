# KeyLibrary — Tes favoris Spotify et leurs tonalités (FreqBlog)

Application personnelle **locale**, en Node.js 20+ et JavaScript natif, sans installation de bibliothèques. Connexion à Spotify, récupération des morceaux likés, récupération de leur tonalité estimée depuis **FreqBlog**, recherche et tri. Les requêtes FreqBlog sont effectuées par le serveur Node, donc la clé API n'est jamais exposée dans le navigateur.

## Démarrer en quelques étapes

1. Installer Node.js 20 ou plus récent.
2. Créer une application depuis https://developer.spotify.com/dashboard. Configurer exactement l'URI de redirection `http://127.0.0.1:3000/`, puis récupérer son **Client ID**. Spotify exige un compte Premium pour le propriétaire des nouvelles applications en mode développement. Pas besoin de Client Secret : l'application utilise OAuth PKCE.
3. Demander une clé API gratuite sur https://freqblog.com/ via **Get API Key**. FreqBlog annonce 1 000 requêtes par mois sur l'offre gratuite, sans carte bancaire. **Il n'exige pas de backlink pour cette inscription.**
4. Copier `.env.example` vers `.env` et y renseigner les clés :

   ```env
   SPOTIFY_CLIENT_ID=ton_client_id_spotify
   FREQBLOG_API_KEY=ta_cle_freqblog
   PORT=3000
   ```

5. Dans le dossier du projet, exécuter `npm start`.
6. Dans le navigateur, ouvrir **http://127.0.0.1:3000/** puis se connecter avec Spotify.

**Note importante** : la page GitHub Pages que tu avais créée pour le backlink GetSongBPM n'est plus nécessaire pour la clé FreqBlog. Le site Spotify utilisé reste local.

## Fonctionnement

- Autorisation Spotify `user-library-read` en lecture seule, OAuth 2.0 PKCE.
- Pagination de `GET /me/tracks` avec 50 titres par page.
- Récupération du code ISRC Spotify (`external_ids.isrc`) pour interroger FreqBlog sur l'enregistrement exact, sinon recherche artiste + titre.
- Appel `GET https://api.freqblog.com/lookup` avec la clé `X-Api-Key` côté serveur uniquement.
- Format tonalités court (`C`, `F#m`, `Bb`), et état « Inconnue » si pas de tonalité confirmée.
- Lorsqu'un morceau n'est pas encore dans le catalogue, FreqBlog peut répondre **202** et l'analyser à la demande. Cet état reste « En attente » : le bouton de relance ou une actualisation peut ensuite récupérer la tonalité, sans la fabriquer.
- Cache `.cache/keys.json` : les résultats trouvés sont gardés un an, les absences un jour, les demandes en traitement 45 secondes.
- Si tu as plus de 1 000 titres à analyser, l'offre gratuite peut être insuffisante pour un premier passage. Les hits en cache ne consomment pas de nouvelle requête, mais les échecs/réessais peuvent en consommer.

## Important

- Les tonalités fournies par FreqBlog sont calculées à partir de données audio (notamment via Essentia), pas garanties exactes pour toutes les chansons. Une chanson qui module peut ne pas avoir une seule tonalité représentative.
- Une erreur 429 peut signifier quota épuisé ou limite de concurrence atteinte. En cas d'échec ponctuel, utilise le bouton « Relancer les erreurs ».
- Application locale **non conçue pour une mise en ligne publique** : l'endpoint backend de tonalités n'est pas authentifié. N'expose pas ce serveur à Internet tel quel.
- Spotify et FreqBlog sont des services indépendants. Leur documentation et leurs conditions d'accès peuvent évoluer.
- Ne partage pas tes fichiers `.env` ni tes clés API.

## Tests

`npm test`

## Sources

- Spotify Web API : https://developer.spotify.com/documentation/web-api/reference/get-users-saved-tracks
- Spotify PKCE : https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- API FreqBlog : https://freqblog.com/
- Documentation : https://api.freqblog.com/docs
