# Développement

`npm run dev` recharge le serveur; les assets Web sont servis directement. `npm test` exécute les tests de contrats, auth et résilience; `npm run build` vérifie TypeScript. `npm run smoke` nécessite un dashboard actif.

Organisation : `apps/server` orchestration, `apps/web` client responsive, `integrations` frontières externes, `packages/contracts` DTO partagés, `packages/auth` pairing, `scripts` exploitation, `tests` contrats. Ne jamais importer `_integration_sources` : il s'agit uniquement du matériel d'audit.

Lors d'une évolution upstream, comparer les routes aux snapshots actuels, mettre à jour `docs/AUDIT.md`, les contrats, puis les tests avant l'UI.
