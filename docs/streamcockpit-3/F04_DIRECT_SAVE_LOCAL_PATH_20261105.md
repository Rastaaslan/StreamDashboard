# F04 — refus des chemins UNC/device/ADS dans SaveReplayBuffer explicite (05/11/2026)

## Préflight et périmètre
- Exécution uniquement via Remote Desktop Commander sur FIXE Windows 11, dépôt canonique `C:\Users\damie\Dev\StreamCockpit-3.0-FullExperience`, branche `streamcockpit/3.0-full-experience`, origin GitHub attendu ; HEAD de départ `633a6239685b48ee3eb08c6ba013dd1ba1006514`, upstream aligné.
- PLAN, feature-matrix, CONTINUITY, MIGRATION lus avant écriture ; pas d'index.lock / merge / rebase constaté. Les cinq fichiers du mixeur F05/CONTINUITY déjà modifiés par un autre propriétaire n'ont été ni touchés ni indexés. OBS réel et processus en activité seulement observés ; aucune interaction avec OBS/Twitch réels, autre PC, autre dépôt, installation, RC ni secret.
- Un seul lot : vérification des chemins avant métadonnées dans le chemin **explicite** `ObsClient.saveReplay()`, distinct du témoin passif `ReplayBufferSaved` déjà sécurisé. ClipForge avancé reste V4.

## Reproduction et correctif minimal
- Le chemin passif `ReplayBufferSaved` rejetait déjà les UNC, préfixes de périphérique Windows et flux alternatifs NTFS. En revanche `saveReplay()` n'exigeait que `isAbsolute` avant `lstat` : cette condition accepte des chemins spéciaux, avec risque de tentative de résolution/réseau Windows. La fonction était utilisée après accusé OBS ou consultation de `GetLastReplayBufferReplay`.
- Nouveau test de non-régression, dans `tests/obs-runtime.test.ts`, simule un OBS WebSocket local et intercepte toute opération `lstat` sur trois chemins hostiles : partage UNC, préfixe `\\?\` et ADS `C:\recordings\replay.mkv:alternate`. Aucune commande n'atteint OBS réel. Avant correction, les trois chemins ont été remis au test de `lstat` : **56 PASS / 1 FAIL / 2 skipped** dans la campagne plus large déclenchée par le harnais (`.git/sc3-f04-direct-save-red-20261105.log`).
- Correction d'une seule condition dans `integrations/obs/src/client.ts` : réutiliser `localReplayFilePath(candidate)` déjà employé par le témoin passif avant la moindre consultation des métadonnées. Le comportement de confirmation incertaine, l'absence de deuxième `SaveReplayBuffer`, et la lecture d'un fichier local régulier sont conservés.

## Qualification du code corrigé
- `npx vitest run tests/obs-runtime.test.ts --maxWorkers=1` : **24 PASS / 0 FAIL / 0 skipped**, dont le nouveau scénario Windows ; `.git/sc3-f04-direct-save-green-20261105.log`.
- Vérification finale conjointe sur le code corrigé (obs-runtime, moments-obs-replay, replay-status-route) : **42 PASS / 0 FAIL / 0 skipped**, `.git/sc3-f04-direct-save-final-tests-20261105.log`. Sécurité après documentation **6750 fichiers PASS** (`.git/sc3-f04-direct-save-final-security-20261105.log`), matrice JSON parsée avec succès et revue de diff propre.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; `npm run security:check` PASS (**6750 fichiers**) ; `git diff --check` PASS, uniquement avertissements LF/CRLF. Journaux `.git/sc3-f04-direct-save-{types,browser,security,diff}-20261105.log`.
- Scénarios de chemins et socket synthétiques, interception des métadonnées et aucun accès UNC réel. Ce résultat ne prouve pas la réception d'un replay OBS sur FIXE en live, ni les tests Android/laptop, signatures, migrations ou rollback.

## État
- F04 `partial` ; G2 `in_progress` ; G3/G4/G5 `open` ; G0/G1 qualifiés historiquement. Aucune RC, installation ni publication.
- `CONTINUITY.md` demeure en propriété F05 et n'a pas été modifié ; ce rapport et la matrice fournissent la continuité du lot sans conflit d'écriture.
- Suite prioritaire : fermer le bug de requête routage F05 par son propriétaire, puis réception physique G3 et preuves réelles G4, avec accord opérateur.
