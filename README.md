# Le Kiosque

Application web moderne pour lire des journaux PDF, classés par date, avec :

- accueil réactif sur les 30 éditions les plus récentes
- archives regroupées par année puis par mois
- lecteur PDF personnalisé avec mode vertical et horizontal
- panneau admin protégé par mot de passe chiffré
- surveillance de flux RSS/Torznab
- récupération automatique via torrent
- génération de miniature de première page
- mise à jour temps réel sans rafraîchissement manuel

## Stack

- `Next.js 16`
- `React 19`
- `TypeScript`
- `better-sqlite3`
- `react-pdf` + `pdfjs-dist`
- `webtorrent`
- `@napi-rs/canvas`
- `Tailwind CSS 4`

## Lancement rapide sur Linux

1. Copier le fichier d'exemple :

```bash
cp .env.example .env.local
```

2. Renseigner au minimum `DEFAULT_RSS_FEEDS` si tu veux précharger des flux au premier démarrage.

3. Installer :

```bash
npm install
```

4. Démarrer :

```bash
npm run dev
```

5. Ouvrir :

```text
http://localhost:3000
```

Au premier lancement, va sur `/setup` ou clique sur `Parametres` pour définir le mot de passe administrateur.

## Production Linux

```bash
npm install
npm run build
PORT=3000 npm run start
```

## Docker

```bash
docker compose up --build
```

Le service publie par défaut sur le port `3000`.

## Variables d'environnement

Voir `.env.example`.

Variables principales :

- `JOURNAL_DB_PATH` : chemin SQLite, défaut `./data/journal.sqlite`
- `JOURNAL_STORAGE_DIR` : répertoire des PDF et miniatures, défaut `./storage`
- `DEFAULT_RSS_FEEDS` : liste de flux séparés par virgule ou retour ligne

## Notes d'architecture

- L'application démarre le watcher RSS dans le process Node de Next.js.
- Les doublons sont bloqués par une contrainte unique `publication_key + publication_date`.
- Le mot de passe admin est hashé avec `argon2id`.
- Les PDF sont servis par route API depuis `storage/`.
- Les nouveaux journaux déclenchent un événement SSE et l'accueil se rafraîchit automatiquement.
