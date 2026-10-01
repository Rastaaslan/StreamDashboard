# Release Windows

## Commandes

- `npm run dev` : serveur et UI web de développement ;
- `npm run desktop:dev` : hôte Electron de développement ;
- `npm run desktop:package` : application Windows x64 non installable dans `out/StreamDashboard-win32-x64/` ;
- `npm run desktop:make` : installateur Squirrel `out/make/squirrel.windows/x64/StreamDashboardSetup.exe` et artifacts updater ;
- `npm run release:check` : tests, TypeScript, audit sécurité et contrôle de la configuration publique.

Avant un package/release, fournir `TWITCH_CLIENT_ID`; le script l'injecte comme donnée publique dans `resources/distribution.json`. Sans cette valeur, la production échoue volontairement.

## GitHub Release

1. Mettre à jour `version` dans `package.json` et le lockfile.
2. Exécuter `npm ci`, `npm run release:check` et `npm run desktop:make` sur Windows.
3. Créer et pousser un tag `vX.Y.Z`.
4. Le workflow Windows produit l'installateur, les fichiers Squirrel, `checksums-SHA256.txt`, puis les publie dans GitHub Releases.

Définir la variable GitHub `TWITCH_CLIENT_ID`. Pour signer, définir les secrets `WINDOWS_CERTIFICATE_BASE64` (PFX encodé base64) et `WINDOWS_CERTIFICATE_PASSWORD`. Sans ces secrets, un build local/non signé reste possible ; aucun certificat n'est stocké dans Git.

L'updater utilise le flux Squirrel GitHub. Il télécharge en arrière-plan mais ne propose jamais l'installation pendant un stream OBS actif. La signature Authenticode de production dépend du certificat externe du propriétaire.
