# Le StreamCockpit — Journal de continuité FC1 — 01/11/2026

> Statut au passage du 01/11, environ 08 h 11–08 h 40 CET : **QUALIFICATION EN COURS — NE PAS FOURNIR DE RC FINALE**.
> Ce document décrit exclusivement les résultats obtenus par ce passage. Ne pas substituer des PASS de simulation à un essai sur téléphone ou deux PC.

## Source et préserver
- Hôte de développement : **dam-server**, `/home/damien/StreamDashboard-Alpha27-AgentV2-Integration`.
- Branche : `streamcockpit/fc1-integration-active-20261101`; origine vérifiée : **253b0a6** (correctif minuteur/autorité client).
- Audit lu : `docs/STREAMCOCKPIT_UI_AUDIT_20261101.md`. RC1 avait quatre destinations simples et pas la refonte promise. **Le correctif du minuteur n'est pas une refonte.**
- Nouveau code UX visé : **2.1.0-rc.2**, distinct de RC1 et non diffusable tant que les critères de sortie ne sont pas atteints.
- Les données de la régie (coffres, pairing, brouillons, sons, plannings, créances de commandes, anciens binaires et sauvegardes) n'ont pas été supprimées ou remplacées. Aucun serveur Minecraft ou job WorldPrep n'a été arrêté; pas d'action de diffusion publique.

## Machines vérifiées, lecture seule
- **FIXE** : Windows 11 Pro, application StreamDashboard RC1 exécutée (processus lancés à 07:32 le 01/11); service HTTP `127.0.0.1:48133`, TLS `:48136`. OBS process en cours; `GET /api/v1/state` au contrôle : `connected:true`, `streaming:false`, `streamingKnown:true`, scène `FIN`, minuteur maître `running:false`, `remaining:0`. Le live était donc arrêté à cette lecture, sans aucune mutation OBS effectuée.
- **Laptop** : Windows 11 Home, application RC1 exécutée depuis 02:09; client ports `:48134` et `:48135`. Aucun listener `:48136` observé. État minuteur local inactif. Un vrai test d'égalité d'état après RC2 sur les trois appareils reste à faire.
- **dam-server** : Debian, Node/npm/Java/Gradle et Android SDK 35 sous `/opt/android-sdk`. Partition NVMe ~95 % pleine (12 Gio libres lors du contrôle), charge observée ~5, ressources partagées avec WorldPrep. Ne pas générer de copies volumineuses non nécessaires.
- **Téléphone Android** : aucun ADB sur dam-server ni sur FIXE au contrôle; essai physique et réassociation réelle **NON FAITS**. Ne pas déclarer Android final.

## Implémentation UX (branche de travail)
1. `apps/mobile/control/index.html` : navigation primaire mobile à cinq destinations explicites **Accueil / Live / Sons / Planning / Plus**, conservation de la navigation historique sur grand écran, du bandeau du minuteur et de la CSP.
2. `apps/mobile/control/streamcockpit-mobile-v2.css` : navigation tactile cinq colonnes, header d'état, minuteur maître persistant, grilles d'état lisibles, formats 320px/rotation; compatibilité avec les volets Live/Planning, DJI flottant.
3. `apps/mobile/control/mobile-five-tab-ui.js` : accueil avec état vérifié régie/OBS/Twitch/micro, prochaine session et reçus; page Plus d'accès aux appareils, synchronisation, modération/activité, macros, Spotify/Micro/DJI, WizeBot/Streamlabs et configuration. États inconnus et hors ligne explicités.
4. `apps/mobile/control/mobile-panes.js` : Sons dispose maintenant de Soundboard / Deck adaptatif / WizeBot / Streamlabs; Live conserve Chat / Micro-Spotify / Sons / Diffusion; Planning conserve les quatre sections.
5. `apps/mobile/control/control.js` : migration unique de l'ancienne destination (sans toucher aux secrets, brouillons, associations, données), deep links de rubriques, rendu et rafraîchissement actifs Accueil/Plus, minuteur unique existant réutilisé. La vue Sons/Deck emploie le moteur de banques, favoris et macros déjà présent (`renderPerformancePage`), avec commandes sensibles confirmées.
6. `tests/controller-bindings-ui.spec.ts` : scénarios nouveaux cinq onglets, timer maître, accès Diffusion, banque adaptative, états hors-ligne/reconnexion, mise à jour OBS durant la connexion et absence de commandes publiques accidentelles. Le faux stockage natif de configuration a été rendu révisionnel (évite de rejouer systématiquement une ancienne topologie lors des tests d'association). `client-authority.d.ts` répare un contrôle TS préexistant.

## Exécutions et mesures
- `npx playwright test -c playwright.streamcockpit-timer.config.ts` : **23 PASS / 23**, après correction du faux stockage natif dans le harnais; les deux faux négatifs d'association provenaient du mock `getInstallation` immuable et du conflit de révision, pas d'un assouplissement de sécurité.
- `npx playwright test -c playwright.mobile-network.config.ts` : **35 PASS / 35**, reconnexion HTTP/WS, gestes/planning, Streamlabs et rejets de commandes.
- Test concentré du Deck adaptatif mobile après branchement aux vraies banques/favoris : **1 PASS / 1**.
- Deux nouveaux tests FC1 UX et reconnexion, plus un test temps réel Accueil : **3 PASS / 3** avant l'amélioration interne du Deck, puis le test UX adaptatif a repassé.
- `npm run build:types`, `npm run check:browser-types`, `npm run build` : **PASS** sur les sources de cette passe, avant l'ultime intégration Deck et version rc.2; à répéter au gel de révision.
- `ANDROID_HOME=/opt/android-sdk ANDROID_SDK_ROOT=/opt/android-sdk npm run android:check` : **BUILD SUCCESSFUL**, 48 tâches Gradle, compilé/debug, lint et tests unitaires Java. Un premier essai sans SDK déclaré a été corrigé par variables d'environnement **sans modifier le SDK ni créer de local.properties**. Le SDK en lecture seule affiche un avertissement `package.xml` non bloquant.
- Les tests React/WebView sur navigateur et unitaires Java ne constituent pas un test physique Android.
- La suite Vitest est en cours lors de la rédaction initiale; reporter ses résultats réels après contrôle.

## Garde-fous et conditions de sortie
- **Ne jamais désactiver la sécurité de confirmation** pour forcer un test. Le client Windows ne doit pas devenir une seconde régie OBS ni démarrer un minuteur local; la source reste FIXE. Les commandes ne sont pas mises en attente lors de déconnexion.
- Le socle Agent V2 et sa télémétrie OBS doivent être retestés sur FIXE puis côté laptop, sans lancement/arrêt de diffusion publique. Refaire la lecture du minuteur des trois appareils après nouveau build, avec coupure/réassociation/reprise.
- Avant **une unique RC publique**, vérifier : suite complète et sécurité PASS; version/empreinte identiques dans EXE x64 et APK; preuve de migration et de retour arrière **des données**; vérification de l'identité de la régie, résistance au réseau instable, arrêt live avec confirmation; vraie installation sur un Android connecté; APK release signée avec la **clé existante** (ne jamais en créer une autre).
- Les anciennes installations RC1 sur FIXE et laptop restent en marche, non remplacées et non redémarrées.
- Pas de remise d'un nouveau binaire comme version finale avant toutes ces étapes.

## Reprise
1. Terminer Vitest, TypeScript, sécurité, check shipped JS, navigateur et suite Agent V2; journaliser PASS/FAIL, corriger sans masquer.
2. Geler/committer les sources et construire EXE Windows x64 et APK **de la même révision**; vérifier manifests/signature/hash et espace libre.
3. Essais contrôlés FIXE/laptop/Android physique, migration/rollback, validation scénarios réels et seulement alors livraison. Si téléphone inaccessible, conserver l'état **non final**.
