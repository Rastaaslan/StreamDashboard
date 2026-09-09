# Sécurité

## Secrets

Le Client ID Twitch est public et injecté dans `resources/distribution.json` pendant le build. Aucun Client Secret n'est accepté. Le device code ne vit qu'en mémoire. Les access/refresh tokens et le mot de passe OBS sont chiffrés avec `safeStorage` dans `secure/credentials.dat`; ils sont absents du JSON, des états HTTP/WebSocket et des logs.

Au premier démarrage, la migration V1 transfère les tokens OAuth et le mot de passe OBS trouvés dans `dashboard.json`, confirme l'écriture sécurisée, retire les champs puis réécrit atomiquement le JSON. Elle est idempotente. Si le chiffrement OS est indisponible, l'écriture échoue au lieu de persister en clair.

Twitch utilise Device Code Grant sans redirect URI. Une session restaurée est validée par `/oauth2/validate` au démarrage puis chaque heure. Un 401 déclenche au plus un refresh et un replay. La rotation est enregistrée avant l'abandon de l'ancien refresh token ; un second 401 ou une validation révoquée efface le stockage sécurisé.

## Electron et logs

La fenêtre est sandboxée et isolée. L'IPC est une liste fermée sans canal générique. Les URLs externes passent deux validations et seules les pages HTTPS Twitch sont admises. Les logs tournent à 2 Mo et expurgent tokens, Authorization et mot de passe OBS.

`npm run security:check` analyse les configurations Electron dangereuses et les surfaces publiques. Ce contrôle comprend les usages OAuth internes légitimes au lieu d'interdire aveuglément le nom des champs.
