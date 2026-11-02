# F00 — Agent autonome : fraîcheur, reçus et frontière QA (02/11/2026)

## Portée
Développement sur FIXE Windows 11 uniquement via Remote Desktop Commander. Base `d430a52`, worktree isolé `StreamCockpit-3.0-AgentRuntime-20261102`. Le propriétaire du minuteur mobile a travaillé séparément ; aucun de ses fichiers modifiés n'a été repris. Aucun accès à une autre machine, installation, OBS de production ou API Twitch réelle.

## Corrections
- Le service Node autonome rafraîchit l'observation d'autorité OBS toutes les 1,5 s par des lectures uniquement. Auparavant, il publiait une observation à l'ouverture puis la laissait expirer après 5 s.
- Les lectures simultanées sont regroupées ; lecture et mutation sont mutuellement exclusives. Un état inchangé renouvelle sa date sans invalider artificiellement la révision de confirmation ; un état/scène changé invalide l'ancien aperçu.
- Une perte de connexion, une lecture échouée, une réponse tardive après arrêt ou un recul d'horloge condamnent l'autorité. Le moniteur ne rouvre pas un writer et ne rejoue aucune commande. L'arrêt attend la lecture abandonnée avant de libérer le verrou.
- `GET /v2/obs/receipt/<commandId>` expose un reçu transactionnel uniquement au contrôleur dont le certificat mTLS exact est épinglé. Il reste lisible après perte d'OBS. Une absence est explicitement `unknown` et n'autorise jamais à rejouer. Aucun chemin ou erreur fournisseur brut n'est renvoyé. Le SDK fournit `readPinnedAgentReceipt` sans retry.
- Le bundle portable « lecture seule » refuse toute variable `SD_AGENT_OBS_WRITER_*` avant son point d'entrée. Son manifest documente cette frontière. Le contrôle est dans le préambule du bundle : un simple wrapper importé ne suffit pas, car les gardes `import.meta.url` deviennent communs après bundling.

## Preuves sur FIXE
Neuf suites ciblées, opt-in `SC3_AGENT_HEADLESS_PROCESS_TEST=1` : **71 PASS / 0 skipped / 0 FAIL**. Log `%TEMP%\sc3-agent-runtime-verified-20261102.log`. TypeScript, types navigateur et sécurité : PASS sur ce worktree isolé avant staging (720 fichiers examinés par le contrôle sécurité ; ne pas confondre avec le comptage du checkout canonique).

Le test en processus indépendant exécute le vrai `main` Node, sans Electron. Il utilise un serveur OBS **simulé**, le protocole MessagePack avec challenge d'authentification, des clés TLS de test, le véritable DPAPI `CurrentUser`, des sockets mTLS loopback et le journal Windows SQLite. Il vérifie : fraîcheur après 6,1 s, un seul effet simulé, perte de connexion, lecture du reçu, arrêt propre, redémarrage explicite, rejet d'une ancienne révision et d'un ID déjà confirmé. Tous les fichiers et clés sont temporaires, sans profil utilisateur réel.

Les tests mTLS vérifient aussi les certificats absents/étrangers, une réponse HTTP perdue après effet confirmé ou incertain, zéro deuxième dispatch, l'identité du reçu et le refus de données privées. Le test de bundle compile un vrai artefact temporaire et tente quatre élévations par environnement hérité.

## Échecs conservés
Les deux premiers essais du nouveau harnais de processus ont échoué : le faux serveur parlait JSON alors que l'export Node d'`obs-websocket-js` parle MessagePack. La connexion a été refusée, sans modification de production. Après correction du seul harnais vers MessagePack, le scénario a passé ; le passage final ci-dessus utilise le service sans instrumentation. Logs initiaux `%TEMP%\sc3-agent-headless-process-20261102.log` et `sc3-agent-headless-process-diagnostic-20261102.log` ; passage corrigé `sc3-agent-headless-process-msgpack-20261102.log`.

## Limites maintenues
F00 reste `partial`, G2 `in_progress`, G3–G5 `open`. Ce contrôle logiciel n'est ni un service Windows installé/signé, ni le raccordement de toutes les interfaces du cockpit à ce writer, ni une preuve matérielle OBS/FIXE/laptop/Android ou une validation de coupure électrique. Le minuteur reste celui de l'hôte existant, aucune seconde horloge n'est créée. Aucun EXE/APK final ni RC livré. Les autres fonctionnalités F01–F10 et leurs obstacles restent à terminer selon PLAN.
