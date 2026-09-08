# StreamTool

Contrôleur local, léger et générique pour les séquences **Intro / Pause / Fin** d'OBS. OBS reste responsable des vidéos; l'unique widget navigateur est un overlay HTML transparent (texte, chrono lorsque prévu, ornements et braises). TouchPortal ne fait qu'envoyer une commande HTTP: le serveur TypeScript possède l'état, les deadlines et l'orchestration.

## Architecture

`SequenceEngine` est la machine d'état canonique et sérialise les transitions. `DeadlineTimer` calcule toujours `deadline - Date.now()` (aucun compteur dérivant). `ObsClient` encapsule OBS WebSocket et sa reconnexion. Express fournit l'API, le SSE, `/widget/` et `/control/`. Le profil JSON porte les textes, durées, scènes et options; le CSS porte le thème. Après tout redémarrage, le moteur repart volontairement en `IDLE`: aucune ancienne fin n'est rejouée.

```
src/              API, moteur de séquences, timer, client OBS
web/widget/       overlay générique vanilla
web/control/      télécommande et diagnostics locaux
profiles/dam.json textes, durées, scènes et options Dam
themes/           identité visuelle campfire
config/           valeurs documentaires par défaut
tests/            timer, API/séquences et contrat widget
```

## Installation et démarrage (Windows, macOS ou Linux)

1. Installer [Node.js LTS](https://nodejs.org/) 20 ou supérieur.
2. Dans le dossier du projet: `npm install`.
3. Copier `.env.example` vers `.env`, puis renseigner OBS.
4. Développement: `npm run dev`. Production: `npm run build` puis `npm start`.
5. Ouvrir `http://127.0.0.1:8787/control/` et `http://127.0.0.1:8787/widget/`.

Scripts: `npm test`, `npm run typecheck`, et `npm run check` (typecheck + tests). Aucun script Bash n'est requis.

## Configuration OBS

OBS Studio 28+ intègre OBS WebSocket. Dans **Outils → Paramètres du serveur WebSocket**, activer le serveur, conserver typiquement le port `4455`, et définir un mot de passe. Reporter l'URL dans `OBS_WEBSOCKET_URL` et le secret uniquement dans `OBS_WEBSOCKET_PASSWORD` de `.env` (jamais dans Git).

Créer les scènes `INTRO`, `PAUSE`, `FIN` et la scène de retour `CHATTING`, ou remplacer leurs noms dans `profiles/dam.json`. Dans chacune des trois scènes de séquence:

1. ajouter la vidéo comme **Source média OBS**;
2. ajouter une **Source navigateur** pointant vers `http://127.0.0.1:8787/widget/` (largeur/hauteur du canvas);
3. placer le navigateur au-dessus de la vidéo.

Le document et le `body` du widget sont explicitement transparents. La vidéo ne transite jamais par StreamTool. `autoStartStreaming`, `autoSwitchAfterIntro`, `autoReturnAfterPause` et `afterIntro` se règlent dans le profil.

## TouchPortal et API

Base locale: `http://127.0.0.1:8787`. Les appels sont des actions HTTP POST sans payload, sauf indication.

| Bouton | Méthode | URL | JSON |
|---|---|---|---|
| 🔥 DÉMARRER | POST | `/api/intro/start` | — |
| ☕ PAUSE | POST | `/api/pause/start` | — |
| ▶ REVENIR | POST | `/api/pause/return` | — |
| 🌙 TERMINER | POST | `/api/end/start` | — |
| ↩ ANNULER FIN | POST | `/api/end/cancel` | — |
| + 1 MIN | POST | `/api/timer/add` | `{"seconds":60}` |
| − 1 MIN | POST | `/api/timer/add` | `{"seconds":-60}` |
| PAUSE TIMER | POST | `/api/timer/pause` | — |
| REPRENDRE TIMER | POST | `/api/timer/resume` | — |
| RESET TIMER | POST | `/api/timer/reset` | — |
| Régler le timer | POST | `/api/timer/set` | `{"seconds":300}` |

Lecture: `GET /api/state`; synchronisation: `GET /api/events` (SSE, état complet immédiatement puis resynchronisation chaque seconde). Une reconnexion ou un refresh reprend donc la deadline serveur, pas la durée initiale.

## Séquences

* **Intro:** scène Intro, démarrage optionnel du stream, chrono visible, puis scène `afterIntro` optionnelle.
* **Pause:** mémorise la scène courante, passe en Pause, affiche le chrono; expiration ou Retour restaure la scène selon configuration.
* **Fin:** mémorise la scène, montre uniquement la phrase et la composition sans chrono, tout en gardant une deadline interne; l'expiration arrête le stream. Annuler supprime la deadline, ne coupe pas le stream et restaure la scène.

Les doubles clics identiques sont idempotents et les transitions sont sérialisées. Une commande OBS indisponible renvoie HTTP 503 sans arrêter le serveur.

## Profils et thèmes

Pour un autre streamer, copier `profiles/dam.json` (par exemple `miryun.json`), modifier textes/durées/scènes/options/thème, puis définir `PROFILE=miryun`. Aucun moteur, timer, endpoint ou client OBS n'est dupliqué. Pour une apparence différente, ajouter `themes/<nom>.css` et mettre ce nom dans la propriété `theme` du profil; `campfire.css` contient les couleurs, typographies et animations. Les animations respectent `prefers-reduced-motion`.

## Réseau et sécurité

Le bind par défaut est strictement `127.0.0.1`. Pour un accès LAN volontaire, définir `HOST=0.0.0.0` **et** `API_TOKEN`; le serveur refuse sinon de démarrer. Les commandes POST exigent alors `Authorization: Bearer <token>`. Le token et le mot de passe OBS ne sont jamais servis au frontend ni journalisés. Préférer pare-feu et réseau privé: ce mécanisme simple n'est pas une authentification Internet.

## Dépannage

La page `/control/` affiche mode, restant, état timer/SSE/OBS, scène et statut du stream. Si OBS est fermé, le serveur et les pages restent disponibles et le client retente la connexion toutes les cinq secondes. Vérifier l'URL, le mot de passe, le port et les noms de scène exacts (casse comprise).
