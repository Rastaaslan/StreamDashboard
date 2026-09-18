# Architecture StreamDashboard V1.x

```text
apps/web ───────────────┐
                       │ Command / DashboardState / ServerEvent
apps/mobile ─ pairing ─┤ (projection distante réduite + allowlist commandes)
                       ▼
apps/server ─ API v1 HTTP + WebSocket ─ CommandService / State bus
     │                  │
     │        packages/core (métier pur)
     │          │ PlanningOrchestrator
     │          ▼
     ├─ integrations/obs ───────────────► OBS Studio
     ├─ integrations/twitch ────────────► Twitch Helix/OAuth
     └─ integrations/google-calendar ───► Google Calendar/OAuth

apps/desktop = hôte Electron + lifecycle + safeStorage + updater uniquement
```

## Frontières

`packages/contracts` est la source du protocole JSON (`protocolVersion = 1`). Il décrit les commandes, l'état desktop et la projection mobile réduite. `packages/core` n'importe ni Electron, ni Express, ni DOM ni SDK fournisseur.

`apps/server` est l'unique point d'orchestration : sérialisation des commandes, persistence, planning multi-provider, préflight Twitch, politique d'accès LAN, projection des états et diffusion WebSocket.

`apps/desktop` ne porte aucune règle métier : il fournit `userData`, chiffrement OS, logs, fenêtre sandboxée, instance unique, updater, lancement OBS et arrêt coordonné.

## API

Le serveur expose notamment :

- `GET /api/v1/health`
- `GET /api/v1/state`
- `GET /api/v1/capabilities`
- `POST /api/v1/commands`
- `/ws/v1`

Les anciennes routes locales restent des façades de compatibilité. Par défaut, l'écoute est strictement loopback (`desktop-local`). En mode LAN explicite, les clients distants reçoivent une projection d'état dédiée et les endpoints/commandes sont filtrés côté serveur, pas seulement cachés par l'interface.

## Planning et fournisseurs

`PlanningOrchestrator` conserve l'intention locale durable (`desiredPublication`) séparément de l'état réel de chaque fournisseur (`ProviderLink`). Twitch et Google peuvent donc réussir/échouer/retry indépendamment sans supprimer silencieusement l'événement local.

Les conflits distants sont explicites. Une suppression distante observée n'entraîne pas une recréation automatique ambiguë : l'utilisateur choisit un retry ou une stratégie de conflit. Google conserve les événements journée entière comme tels ; Twitch ne publie que des événements Live horaires valides.

## OBS et workflow live

Le `DashboardCommandService` est le bus de commandes canonique. Un Start réel :

1. valide OBS/checklist ;
2. sélectionne la scène de démarrage (`Intro` par défaut ou `Live`) ;
3. attend la confirmation OBS ;
4. rafraîchit la Browser Source timer configurée ;
5. demande `StartStream` et attend confirmation ;
6. passe le domaine en mode de démarrage et lance le timer de session à 05:00.

Un Stop réel affiche/confirme la scène End si configurée, attend sa fenêtre de visibilité puis coupe le stream et met le timer en pause.

## Stockage

Le JSON atomique contient `schemaVersion`, planning, liens providers, devices distants hachés et préférences non secrètes. Les secrets Twitch/Google/OBS sont séparés dans `safeStorage` Electron. Les écritures JSON et secrets sont sérialisées et atomiques.

## Projets historiques

**StreamTool et damPlanner ne font pas partie du graphe d'exécution**. Ils restent indépendants, non modifiés et utilisables comme fallback.
# Planning V2 : séries et Discord

Les récurrences sont conservées sous forme d’un événement canonique contenant une règle (`weekly`/`monthly`, intervalle, fuseau, fin) et une table d’exceptions. `packages/core/src/recurrence.js` développe cette série uniquement dans la fenêtre demandée. Une occurrence virtuelle porte `seriesId` et une `occurrenceKey` construite à partir de l’identité de série et de son heure murale locale ; elle n’est jamais persistée comme événement autonome. Les conversions de fuseau recalculent chaque occurrence depuis l’ancre afin de préserver l’heure locale pendant les changements DST. Les jours 29–31 mensuels sont ramenés au dernier jour valide sans faire dériver l’ancre des mois suivants.

Le cache compagnon v3 conserve les événements canoniques et traite `recurrence` comme un champ atomique : deux éditions concurrentes déclenchent le mécanisme de conflit existant. Les providers actuels ne garantissant pas des exceptions réconciliables, une série locale demandée sur Twitch/Google est conservée mais marquée en erreur explicite, plutôt que de publier une représentation fausse ou dupliquée. L’horizon d’expansion des listes générales est borné à deux ans ; chaque export utilise exactement les bornes de sa période.

Discord est exclusivement une intégration serveur. Desktop ou Android génère le PNG avec `buildPlanningPng`, puis envoie les octets au serveur appairé. Le serveur valide le PNG, la destination et le message, contrôle le salon auprès de Discord et publie un multipart. Android ne reçoit que l’état public, les noms/identifiants de guildes et salons, jamais le token.
