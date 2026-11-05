# SC3-AUDIT-CLEANUP — Corrections progressives de l'interface et du code

Date de lancement : 06/11/2026. Périmètre : branche canonique sur FIXE uniquement. Ceci est un chantier de maintenance, PAS une release.

## Constat initial factuel

- La page « Appareils et Android Deck » présentait « Mono-PC Windows / Android non déclaré » depuis le **modèle local** même si l'API FIXE `/api/v1/remote/devices` recensait trois télécommandes non révoquées. Les associations ne signifient pas que les appareils sont présents en ligne.
- Les paramètres Windows montrent plusieurs chemins pour des actions comparables ; l'interface classique `apps/web/app.js` conserve ses propres formulaires de nom, thème et configuration OBS, et `apps/mobile/control/settings-view.js` en présente d'autres. Ne pas les fusionner sans une cartographie de propriétaires et migrations.
- Le serveur accepte `clearObsPassword` explicitement, mais le formulaire de réglages principal partagé ne propose pas encore l'effacement contrôlé. Un champ vide doit toujours signifier « conserver ».
- Discord/WizeBot : afficher distinctement état du compte local, liaison FIXE, permissions et fournisseur. Ne jamais copier de secrets entre appareils.
- Plusieurs APK de test partagent un même identifiant et versionCode mais pas tous le même certificat QA : éviter les conflits d'installation par une procédure de signature et versionnement reproductible, sans créer de clé de production fictive.
- Modules volumineux : `apps/server/src/index.ts` environ 3 722 lignes ; `apps/mobile/control/control.js` environ 1 215 lignes. Ne modulariser que par extractions à comportement équivalent après test.
- Des chaînes YouTube historiques existent encore dans les sources distribuées, sans que cela prouve des fonctionnalités YouTube actives. Twitch-only obligatoire ; pas de suppression automatique par recherche de mots.
- Plusieurs blocs de réglages sont redondants. Le nettoyage doit préserver la navigation Android à cinq onglets, l'autorité OBS/minuteur unique sur FIXE, les états incertains et toutes les données/sessions utilisateur.

## Lot 01 — Vue en lecture seule des appareils effectivement associés (réalisé dans le code)

- `settings-simplified.js` précise que « non déclaré » renvoie au modèle local, pas aux appairages ; lien « Voir les appareils associés à FIXE » affiché uniquement sur l'interface FIXE maître.
- `control.js` exécute **uniquement après clic** un GET local `/api/v1/remote/devices` vers `localEndpoint` ; le rôle client et tout téléphone en sont explicitement exclus. Aucun POST, aucune association ou révocation, aucun appel OBS/Twitch.
- `paired-devices-summary.js` rend la liste locale en échappant les noms, en masquant identifiants/tokens/permissions, en excluant les entrées révoquées et en libellant chaque horodatage « dernier contact » sans promettre une présence en ligne. Une réponse malformée est rejetée.
- Test `tests/streamcockpit3-audit-paired-devices.test.ts` nouveau, plus régression `tests/streamcockpit3-settings-topology-browser.test.ts` existante : **14 PASS / 0 FAIL / 0 skipped**, dont 3 passages dans le vrai Microsoft Edge (320 px et largeur bureau). Tests sans actions réseau/OBS publics.
- `npm run build:types` PASS ; `npm run check:browser-types` PASS ; JS livré ciblé `node --check` PASS ; `npm run security:check` PASS **6 763 fichiers**, exécuté sur l'arbre de travail contenant aussi les fichiers F05 en cours d'un autre propriétaire. `git diff --check` PASS (warnings CRLF seulement).
- Aucune installation QA changée, aucune modification de profil, secrets, pare-feu, Google, OBS, Twitch ou appareil physique. Le téléphone pourra être testé avec la QA déjà installée ; cette fonctionnalité ne sera visible que dans un futur package explicitement autorisé.

## Suites ordonnées, sans réécriture gratuite

1. P0/P1 : audit des parcours de configuration (FIXE maître, laptop client, Android appairé/non appairé) ; éliminer les boutons doublons après preuve d'usage et assurer une destination par action.
2. P1 : restaurer la case « Effacer le mot de passe OBS » avec confirmation explicite, sans effacer un secret sur simple sauvegarde ni divulguer l'état privé.
3. P1 : afficher la source réelle du statut des comptes/integrations et griser les réglages FIXE hors ligne ; distinguer « connecté », « autorisé » et « diffusion prête ».
4. P1 : tester la signature et le versionCode Android QA avec contraintes d'upgrade et conflits de certificat, conserver l'APK `f15845b` de réception intacte.
5. P2 : retirer uniquement les branches inaccessibles démontrées par tests ; vérifier les surfaces historiques et le câblage des formulaires Windows avant tout retrait.
6. P2 : décomposer progressivement contrôleur, serveur et vues seulement après jeux de tests de parité et garde régression.

## Propriété et garde de livraison

- Dépôt : `C:\Users\damie\Dev\StreamCockpit-3.0-FullExperience`, branche `streamcockpit/3.0-full-experience`, source distante `Rastaaslan/StreamDashboard`.
- Au lancement de ce lot, HEAD `b79b3a4` et cinq fichiers F05/`CONTINUITY.md` non commis appartenant à un autre propriétaire. **Ne pas les modifier, écraser ou ajouter au commit.** Utiliser ce rapport dédié comme handoff.
- Vérifier les quatre documents de préflight, git/log/remote, owners et charge à chaque passage horaire ; prendre un seul lot sans concurrence. L'automatisation générale StreamCockpit intervient déjà à un autre créneau.
- **G0/G1 historiquement qualifiés ; G2 in_progress, G3–G5 open.** Tests synthétiques ≠ réception matérielle. Aucune RC, installation, signature ou publication sans preuve et autorisation.
