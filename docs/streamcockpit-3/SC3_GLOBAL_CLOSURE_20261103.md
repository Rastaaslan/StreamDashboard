# SC3-GLOBAL-CLOSURE — clôture fonctionnelle V3 accélérée
Date : 2026-11-03. Périmètre : branche canonique FIXE Windows 11 uniquement.
Ce document coordonne les manques réels de la V3 ; **il ne change pas les gates** et ne revendique aucun test matériel.

## Décision de cadence
Priorité à des parcours utilisables, pas à des micro-ajustements sans effet utilisateur.
Une seule campagne générale par intégration majeure ; tests ciblés + types + sécurité pour chaque correctif.
Ne pas répéter de longues campagnes identiques sur une même source. Aucun développement ClipForge V4, et V3.1 modulaire demeure différée.
Ne jamais supprimer une preuve FAIL ou convertir un skipped en PASS pour accélérer. Un test hors ligne sur un fournisseur simulé ne remplace pas un vrai appareil.

## Flux de clôture (maximum 4 propriétaires, un par fichier)
1. **Parcours du live P0** : F00 autorité/minuteur FIXE, F07 appairage Deck Android, F02 chat/modération, F05 gain/mute, F06 lecture planning, F04 repères et F09 timeline. Prouver ensemble déconnexion, reprise et absence de double commande OBS. Le kit b8a9669 est QA et n'embarque pas les changements F06 ultérieurs.
2. **Fonctions V3 encore incomplètes P1** : F02 retenues AutoMod (lecture + ensuite approbation/refus explicitement consentis) et historique viewer ; F05 routage PC jeu/VOD et mètres mesurés ; F03 macros multi-étapes et contexte audio/chat/replay ; F01 santé périphériques et vraie batterie DJI quand détectable ; F06 publication Google avec revue ; F08 EventSub raids ; F09 migrations legacy et compte Streamlabs ; F10 installation transactionnelle, backup et rollback.
3. **QA G2** : vérifier les parcours indépendants depuis la source finale, TypeScript, JS livré, permissions et 320 px ; ne pas rebâtir Windows/Android pour chaque test. Arrêter sur erreurs bloquantes reproductibles ; les fonctions encore absentes restent partial.
4. **G3–G5** : réception manuelle FIXE/laptop/Android sur copie/profils isolés ; reconstruire Windows x64+APK depuis le STRICTEMENT même commit après G2 ; vérifier signature Android existante, Authenticode si disponible, conservation des données, récupération et rollback ; une seule RC avec accord opérateur.

## F02 — lot réellement intégré par le présent chantier
- Nouveau parseur EventSub AutoMod Hold/Update V2 et cache court des observations reçues depuis la connexion FIXE. IDs/broadcaster exacts, messages bornés et effacement à la perte de connexion, compte ou scope ; aucune fausse affirmation de file Twitch exhaustive.
- Souscription conditionnelle au scope déjà demandé `moderator:manage:automod`. Une souscription optionnelle AutoMod refusée ne coupe pas le chat.
- GET appairé `/api/v1/twitch/advanced/moderation/held` (droits chat+cloud), double contrôle acteur+hôte. Vue Mobile/Desktop : bouton manuel de lecture, texte non interprété comme HTML, aucune commande publique/automatique.
- Qualification finale sur les sources F02 : **60 PASS / 0 FAIL / 0 skipped**, neuf suites ciblées comprenant **3 Microsoft Edge réels tactiles 320 px**, HTTP appairé, souscriptions EventSub simulées et non-régressions Twitch runtime/desktop-recovery. `npm run build:types` PASS, `npm run check:browser-types` PASS, `npm run security:check` PASS (**2 583 fichiers**, état de travail partagé incluant F06), `node --check` du module UI et `git diff --check` PASS (seuls avertissements CRLF). Les premiers essais avaient notamment : mauvais statut attendu pour un jeton invalide, reconnexion de l'UI incohérente et timeout navigateur ; corrigés sans supprimer les assertions, résultats rouges conservés. Aucune suite générale, aucun build EXE/APK ni test physique effectué sur ce nouveau code F02.
- **Reste F02** : gestion explicitement confirmée des messages retenus, historique viewer durable, réceptions OAuth/EventSub réelles. Aucun AutoMod externe sollicité, F02 reste partial.

## F05 — lot réel : amplitude mesurée du mixeur
- L'OBSWebSocket FIXE fournissait déjà `InputVolumeMeters` au moniteur micro. Cette mesure est maintenant récupérable depuis le même client OBS, sans seconde régie, second flux EventSub ni polling audio additionnel. Le nouveau `MicHealthWatch.meterEvidence` rend les pics d'amplitude bruts, non horodatés artificiellement ; expire après 5 secondes, vide à l'arrêt/reprise de stream et refuse les horloges rétrogrades.
- `ObsMixerObservation` reprend uniquement une mesure réelle valide dans le snapshot hôte, avec la provenance `host-obs-client:InputVolumeMeters`. Le mixeur Desktop/Android affiche alors la mesure, jamais un pourcentage de batterie, ni une preuve de routage VOD, de volume de sortie ou d'audibilité. Le mixage gain/mute et les reçus existants restent intacts.
- Qualification ciblée sur FIXE, source modifiée : **39 PASS / 0 FAIL / 0 skipped** (5 fichiers, incluant 6 nouvelles régressions de preuve OBS). Régressions OBS websocket/récupération/contrôle gain-muet : **26 PASS / 0 FAIL / 1 skipped** (4 fichiers ; le test navigateur conditionnel n'a pas été exécuté ici). Total exécuté **65 PASS / 0 FAIL / 1 skipped**. TypeScript, types navigateur, `security:check` PASS (**2 584 fichiers**) et `git diff --check` PASS (avertissements CRLF sans diff invalide). Suites générales, livraison Windows/APK et matériel non relancés pour ce lot.
- Limites : abonnement des mètres existant uniquement pendant la diffusion OBS connue, sans mesure hors live ; le chemin de mesure VOD/PC jeu et les règles d'isolation des pistes restent à développer/recevoir. F05 et G2 restent partiels, pas de vraie capture son matérielle.

## Exclusions et limites
- F09-Q isolé (branche 4400e93), RC2, WorldPrep, World Director et Crafty inchangés.
- Les fichiers F06 en écriture concurrente (planning, tests, CONTINUITY.md, feature-matrix.json) ne sont ni staged, ni écrasés, ni revendiqués par ce lot F02. Après leur commit indépendant, le propriétaire de clôture reportera les nouvelles preuves F02 dans CONTINUITY et la matrice avant de conclure G2.
- Aucune installation, aucun lancement/arrêt live OBS, aucune publication Twitch ni RC. G0/G1 historiquement qualifiés ; G2 in_progress ; G3–G5 ouverts.

## Prochain lot
Terminer F05 (mesures et routage réels PC jeu/VOD) ou F10 (rollback/migration installateur) dès que la propriété des fichiers le permet ; réunir un commit de stabilisation des parcours P0, puis reconstruire le couple QA Windows + Android sur ce commit et procéder à la réception manuelle.
