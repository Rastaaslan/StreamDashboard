# Settings — autorité OBS affichée et rôles enregistrés (05/11/2026)

## Périmètre et source de vérité
Lecture de PLAN, feature-matrix, CONTINUITY et MIGRATION avant mutation, exclusivement via RDC sur FIXE. Branche `streamcockpit/3.0-full-experience`, HEAD initial `46c7c3e`, origin `https://github.com/Rastaaslan/StreamDashboard.git`, aucun lock Git ni migration active. Les fichiers mixeur et `CONTINUITY.md` étaient déjà modifiés par un propriétaire distinct : **ni modifiés ni stagés** ici. Aucun travail sur RC2, Q, autres machines ou installations.

| Champ/parcours | Propriétaire attendu | Source et dépendance | Effet de cette passe |
| --- | --- | --- | --- |
| Rôle d'exécution OBS (FIXE) | Régie locale FIXE | `device.role === 'stream'` présenté par le runtime | Seule cette identité affiche les commandes locales de création d'association et d'administration OBS. |
| Rôles du modèle Double-PC/Android Deck | Profil local de l'appareil | `installation.devices[].roles` et `localDeviceId` ; peut être ancien ou erroné | Sert à décrire la topologie, **jamais** à promouvoir un client en régie OBS. Aucune modification des rôles sauvegardés. |
| Client laptop et Deck Android | Appareil client | `device.role` et association explicite à FIXE | Affiche l'association FIXE, pas un second propriétaire OBS ni un minuteur de secours. |
| État de la régie sélectionnée | FIXE, lu par le client | `server` + `online` | Statut de connexion observé ; un modèle local n'atteste pas la présence physique d'un appareil. |

## Régression démontrée et changement
Avec un client `role:control` portant un ancien rôle local `obs-executor`, la page **Appareils** affichait à tort « Régie de cet ordinateur » et proposait le bouton d'association réservé à FIXE. Le cas inverse (FIXE en `role:stream` avec rôle sauvegardé `controller`) pouvait le déclasser. Correction minimale de `renderDevicesSettings` : calcul de `isMaster` à partir du rôle d'exécution, non du modèle d'installation. Aucun changement d'API, de secrets, de comportement OBS, de minuteur ou de données utilisateurs ; l'autorisation réelle des actions reste contrôlée par le serveur.

## Preuves du lot
- RED sur FIXE : **7 PASS / 2 FAIL / 0 skipped** sur 9 tests (une assertion HTML et un vrai navigateur Microsoft Edge 320px) ; `%TEMP%\\sc3-settings-runtime-role-red-20261105.log`.
- GREEN sur sources finales : **29 PASS / 0 FAIL / 0 skipped** dans 5 suites ciblées, dont **6 scénarios Edge réels** à 320px et autres largeurs ; `%TEMP%\\sc3-settings-runtime-role-green-20261105.log`. Navigateur sur origine isolée, requêtes sortantes bloquées.
- `npm run build:types`, `npm run check:browser-types`, `npm run security:check` (**6 761 fichiers avant ajout de ce document**) et `git diff --check` : **PASS** ; `%TEMP%\\sc3-settings-runtime-role-static-20261105.log`.
- Les campagnes générales, tests physiques FIXE/laptop/Android, OBS réel, installation, build de distribution, signature et publication ne sont pas revendiqués. La source modifiée n'est pas présente dans les installations existantes.

## Décision et suites
F00 reste **partial**, G2 **in_progress**, G3–G5 **open**. ClipForge avancé demeure exclu de 3.0 selon PLAN (V4). Pour la prochaine passe Settings : distinguer plus finement les capacités de connexion réelles par appareil, puis qualifier les parcours matériels quand l'opérateur l'autorise ; n'effectuer aucun reset de modèle ni d'appairage automatique. La continuité principale doit être rapprochée **par son propriétaire** avant intégration du journal, ses modifications mixeur préexistantes n'appartiennent pas à ce lot.
