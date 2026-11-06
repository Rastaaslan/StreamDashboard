# F02 — Journal persistant des tentatives de décision AutoMod (06/11/2026)

## Constat et périmètre
- Préflight en lecture seule sur FIXE Windows 11 : PLAN, feature-matrix, CONTINUITY, MIGRATION, audit G2 ; HEAD initial `cea84b4`, branche et origine conformes, aucun verrou Git détecté.
- Les cinq fichiers F05/mixeur et CONTINUITY déjà modifiés par un autre propriétaire ont été laissés intacts. QA installée `f15845b` et OBS utilisateur observés, non interrompus.
- Avant ce lot, le routeur F02 utilisait uniquement un `Set` en RAM pour bloquer un second ALLOW/DENY. Un message retenu par un nouvel événement EventSub après redémarrage de FIXE pouvait réautoriser le même POST malgré un résultat initial incertain.

## Parcours raccordé
- Ajout de `AutoModActionIntentSqlite` sur FIXE, fichier séparé `streamcockpit-automod-action-intents.sqlite` dans le `dataDir` serveur existant. Initialisation paresseuse seulement à la première confirmation. Aucun token, texte de chat ou identité d'appareil stocké : chaîne, message, viewer, décision et horodatage uniquement.
- Après une prévisualisation réellement observée, l'API vérifie que la clé chaîne/message n'a jamais été réservée. Avant **toute possibilité** de POST Helix, `BEGIN IMMEDIATE` et `COMMIT` d'une réservation définitive : même clé impossible entre deux instances et après redémarrage ; refus si journal corrompu, inconnu, verrouillé, déplacé ou illisible.
- SQLite local en rollback journal `DELETE`, `synchronous=EXTRA`, `application_id` et schéma/version stricts. Aucune migration implicite de fichier inconnu, aucune éviction, expiration, libération sur HTTP 204 ou réponse perdue et aucun retry automatique. Les erreurs de sauvegarde sont non réessayables.
- Routeur, création de service dans `index.ts`, gardes de confirmation et tests HTTP appairés raccordés. Le message ne peut être traité que s'il est présent et frais dans l'observation EventSub existante, même si le journal est sain.
- L'API Twitch ne fournit toujours pas de GET unitaire d'état d'une décision AutoMod : une réponse 204 demeure **submitted-unverified**, pas une preuve de modération appliquée. Un journal réservé est une **trace de tentative**, pas une preuve d'action effectivement reçue par Twitch.

## Preuves exécutées sur la source modifiée
- RED initial : nouvelle suite non chargeable sans le module de durabilité (0 assertion, pas une régression comportementale). RED comportemental ultérieur : NTFS ADS accepté par le constructeur, **0 PASS / 1 FAIL / 5 skipped** ; maintenant rejeté avant tout accès disque.
- Après implémentation : **10 suites Vitest, 46 PASS / 0 FAIL / 0 skipped**, dont 4 scénarios Microsoft Edge réels en 320 px et plusieurs tests d'API appairée en boucle locale. Deux essais HTTP distincts valident la recréation du routeur/stockage après succès Helix simulé et après perte simulée d'ACK. Journal inconnu conservé octet pour octet ; deux clients SQLite voient la même réservation.
- `npm run build:types` PASS, `npm run check:browser-types` PASS, `npm run security:check` PASS (**6 785 fichiers avant rapport/matrice**), `git diff --check` PASS (avertissements CRLF sans erreur).
- Source seulement : ni build EXE/APK, ni certificat de production, ni écriture du profil utilisateur, ni Twitch public, ni matériel Android/laptop, ni simulation de coupure électrique. `node:sqlite` reste signalé expérimental par Node 22.

## Limites de livraison
- Le fichier de tentatives doit être inclus de manière intacte dans toute procédure G4 de sauvegarde, migration et rollback. La suppression ou restauration d'une copie ancienne pourrait rouvrir une clé déjà utilisée ; ce risque doit être qualifié, **ne jamais supprimer ce journal automatiquement**.
- Aucune preuve de résistance à une panne électrique, de droits ACL NTFS de production, de réception OAuth réelle ni de décision effective chez Twitch.
- **F02 = partial ; G2 = in_progress ; G3, G4, G5 = open.**
- Suite prioritaire : contrôler la conservation de cette nouvelle barrière lors des migrations et restaurations F10 sur copie isolée, qualifier OAuth/Twitch réel avec action volontaire uniquement, puis fermer F05 routage et mesures sans conflit de fichiers.
