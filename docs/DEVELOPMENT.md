# Développement

Prérequis : Node.js 20+, npm et, pour les commandes réelles, OBS Studio avec obs-websocket activé. Copier `.env.example` vers `.env`, puis lancer `npm install` et `npm run dev`.

Organisation : `apps/server` orchestre l'état local et OBS, `apps/web` fournit le client desktop, `integrations/obs` isole le protocole OBS, `packages/contracts` expose les DTO, commandes et événements partagés. `_integration_sources` reste uniquement du matériel historique de référence et ne doit jamais être importé ou modifié.

Toute nouvelle action doit être ajoutée au discriminant `DashboardCommand`, implémentée dans l'orchestrateur, puis appelée via `/api/commands`. Préserver ce contrat indépendant de l'UI afin de permettre un futur client.
