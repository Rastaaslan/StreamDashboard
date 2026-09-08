# DamPlanner

Application Electron locale (Windows 10/11 x64) pour planifier des événements **LIVE** et **PERSONAL**, avec publications Google Calendar et Twitch indépendantes. L'interface française utilise `Europe/Paris` par défaut et reste utilisable hors ligne.

```bash
pnpm install
pnpm dev       # développement
pnpm check     # validation complète
pnpm package:win
```

Les comptes réels sont optionnels. Aucun secret ne doit être placé dans Git : voir [Google](docs/GOOGLE_SETUP.md), [Twitch](docs/TWITCH_SETUP.md) et le [smoke test](docs/REAL_WORLD_SMOKE_TEST.md).

## Garanties MVP

- UTC + timezone IANA, passage de minuit et DST via Luxon.
- soft delete, états et historique séparés par fournisseur ; erreurs et retry indépendants.
- conflits locaux/Google/Twitch informatifs, avec validation explicite et hash invalidé si le créneau change.
- isolation Electron (`contextIsolation`, sandbox, aucun Node renderer) et IPC validés par Zod.
- tokens chiffrés par Electron `safeStorage`, jamais dans SQLite ni le renderer.
- adaptateurs de production Google Calendar REST et Twitch Helix, avec OAuth Desktop loopback/PKCE et Device Code Flow. Les fakes ne sont sélectionnés qu'avec `DAMPLANNER_MOCK_PROVIDERS=1`.

Les événements récurrents, OBS, TouchPortal, chat, statistiques, cloud, mobile et synchronisation bidirectionnelle générale sont hors périmètre.

## Agenda & Daily Hub

DamPlanner propose désormais les vues **Aujourd'hui**, **Planning** et **Agenda** (semaine
et mois) sur une source unifiée locale/Google/Twitch, avec lecture seule stricte des éléments
externes, déduplication, adoption Google explicite, cache hors connexion et brouillons.
Voir [docs/AGENDA.md](docs/AGENDA.md) pour les garanties de propriété et limitations.

## Live Cockpit

Depuis un LIVE, **Préparer le live** ouvre une routine persistante par phases et permet de
marquer l'événement prêt, en direct puis terminé, avec heures réelles et note post-live.
Les applications et intégrations locales sont exécutées uniquement par des IPC main-process
restreints, jamais par un shell dans le renderer.
