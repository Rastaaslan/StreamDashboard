# Architecture StreamDashboard V1.x

```text
apps/web (desktop aujourd'hui, mobile demain)
                    │ Command / PublicState / ServerEvent
                    ▼
apps/server ─ API v1 HTTP + WebSocket ─ CommandService / State bus
                    │
          packages/core (métier pur)
                    │
       integrations/obs + integrations/twitch
                    │
                 OBS / Twitch

apps/desktop = hôte Electron + lifecycle + safeStorage uniquement
```

`packages/contracts` est la source du protocole JSON (`protocolVersion = 1`). `packages/core` n'importe ni Electron, ni Express, ni DOM. Toutes les interfaces, y compris Electron et le futur mobile, passent par le même service de commandes et reçoivent le même état public.

Le serveur expose `/api/v1/health`, `/api/v1/state`, `/api/v1/capabilities`, `/api/v1/commands` et `/ws/v1`. Les routes V1 historiques restent des façades de compatibilité. Par défaut, l'écoute est strictement loopback (`desktop-local`) ; aucun secret ne figure dans l'état ou les événements.

Electron attend la Promise de readiness du serveur embarqué, puis ouvre le cockpit. Il fournit les chemins `userData`, le chiffrement OS, les logs, l'instance unique, l'updater et l'arrêt coordonné, sans logique métier et sans processus Node enfant.

Le stockage JSON atomique contient `schemaVersion`, planning et préférences. `safeStorage` contient séparément tokens Twitch et mot de passe OBS. Twitch utilise Device Code Grant, rotation de refresh token et validation périodique. OBS reste externe, optionnel et reconnectable.

StreamTool et damPlanner ne font pas partie du graphe d'exécution et leurs répertoires historiques restent inchangés.
