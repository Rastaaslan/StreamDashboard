# Développement

Node 22+, pnpm 10+. `pnpm dev` démarre Vite, la compilation main/preload et Electron. Les limites sont : domaine sans Electron, providers derrière contrats, aucun accès réseau depuis React, aucun `try/catch` autour des imports. Ajouter une migration SQL versionnée à chaque changement de schéma. `pnpm check` est obligatoire avant commit.

Le mode normal appelle les API réelles. Pour un développement volontairement hors réseau : `DAMPLANNER_MOCK_PROVIDERS=1 pnpm dev`. Ce drapeau n'est jamais activé implicitement.

Les données utilisateur résident sous `app.getPath('userData')`. Ne jamais commiter base, credentials, token ou captures contenant des données privées.
