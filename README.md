# Le Kiosque Lite

Lecteur web de journaux PDF en stack legere, sans build frontend et avec backend Python stdlib.

## Stack

- `Python 3.10+`
- `sqlite3` standard library
- `http.server` standard library
- `xml.etree.ElementTree` pour le RSS
- HTML rendu cote serveur
- JavaScript navigateur minimal pour SSE, miniatures et lecteur PDF

## Pourquoi cette version

Cette version remplace le backend Node par un seul serveur `python app.py`.

Objectif :

- demarrage simple sur Linux
- pas d'etape `build`
- pas de dependances Python externes
- consommation memoire beaucoup plus basse

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
python3 /chemin/vers/app.py
```

Puis ouvre :

```text
http://localhost:3000
```

Au premier lancement, ouvre `/setup` pour definir le mot de passe administrateur.

## Variables d'environnement

- `PORT` : port HTTP
- `APP_BASE_PATH` : prefixe URL si l'app est servie derriere un reverse proxy, par exemple `/journal`
- `JOURNAL_DB_PATH` : chemin SQLite
- `JOURNAL_STORAGE_DIR` : dossier des PDF telecharges
- `DEFAULT_RSS_FEEDS` : flux RSS/Torznab separes par virgule ou retour ligne

## Reverse Proxy Nginx

Exemple pour exposer l'application sous `/journal/` :

```nginx
location /journal/ {
    proxy_pass http://127.0.0.1:39014/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /journal;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

La valeur de `X-Forwarded-Prefix` doit correspondre au prefixe reel expose par Nginx.

## Docker

```bash
docker compose up --build
```

## Notes techniques

- Le rendu des miniatures et du lecteur PDF repose sur `pdf.js` charge cote navigateur.
- Les PDF sont servis depuis `storage/` via la route `/files/...`.
- Le scan RSS tourne dans le meme process Python que l'application web.
- Le telechargement torrent utilise `transmission-cli` ou `aria2c` s'ils sont installes sur l'hote.
- Cette pile est concue pour les petits serveurs ou les environnements SSH limites.
