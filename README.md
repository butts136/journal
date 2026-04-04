# Le Kiosque Lite

Lecteur web de journaux PDF en stack legere, sans build frontend.

## Stack

- `Node.js 20+`
- `better-sqlite3`
- `fast-xml-parser`
- `webtorrent`
- HTML rendu cote serveur
- JavaScript navigateur minimal pour SSE et rendu PDF

## Pourquoi cette version

Cette version remplace `Next.js` et `React` par un seul serveur `node server.js`.

Objectif :

- demarrage simple sur Linux
- pas d'etape `build`
- consommation memoire beaucoup plus basse
- installation via `npm install`

## Fonctionnalites

- accueil avec les 30 journaux les plus recents
- archives par annee puis par mois
- cartes avec miniature de premiere page rendue dans le navigateur
- lecteur PDF personnalise
- mode `Vertical`
- mode `Horizontal`
- page Parametres protegee par mot de passe admin chiffre avec `scrypt`
- ajout et suppression des termes de recherche
- ajout et suppression des flux RSS / Torznab
- scan RSS automatique et manuel
- ingestion torrent
- prevention des doublons par nom/date, `guid` et `info_hash`
- mise a jour temps reel par SSE

## Lancement rapide

```bash
cp .env.example .env.local
npm install
npm start
```

Puis ouvre :

```text
http://localhost:3000
```

Au premier lancement, ouvre `/setup` pour definir le mot de passe administrateur.

## Variables d'environnement

- `PORT` : port HTTP
- `JOURNAL_DB_PATH` : chemin SQLite
- `JOURNAL_STORAGE_DIR` : dossier des PDF telecharges
- `DEFAULT_RSS_FEEDS` : flux RSS/Torznab separes par virgule ou retour ligne

## Docker

```bash
docker compose up --build
```

## Notes techniques

- Le rendu des miniatures et du lecteur PDF repose sur `pdf.js` charge cote navigateur.
- Les PDF sont servis depuis `storage/` via la route `/files/...`.
- Le scan RSS tourne dans le meme process Node que l'application web.
- Cette pile est concue pour les petits serveurs ou les environnements SSH limites.
