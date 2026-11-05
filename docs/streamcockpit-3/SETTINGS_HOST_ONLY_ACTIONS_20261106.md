# SETTINGS-P07 — Actions d’intégrations réservées à FIXE (06/11/2026)

## Préflight et propriété
- FIXE Windows 11 uniquement ; canonique `streamcockpit/3.0-full-experience`, HEAD avant lot `fe0e088`, origin `Rastaaslan/StreamDashboard`. PLAN, matrice, CONTINUITY, MIGRATION relus.
- `CONTINUITY.md` et trois sources F05/mixeur + leur test étaient déjà modifiés par un autre chantier : **laissés intacts et exclus du commit**. Aucun verrou Git détecté avant le lot.
- `out/sc3-final-delivery/completion.json` : `missionDelivered=false`, `publicationAuthorized=false`, `releaseEligible=false`. OBS et QA existants non pilotés, testés ni remplacés.
- Contrat produit courant : Twitch-only, OBS/minuteur maîtres exclusivement sur FIXE ; ClipForge lourd reporté V4 selon PLAN (ne pas réactiver F04 avancé).

## Carte des réglages (parcours / propriétaire / preuve d’état / action)
| Rubrique | Propriétaire réel | Source/capacité | Effet attendu / limite |
|---|---|---|---|
| Appareils & Deck | appareil courant ; FIXE pour code et autorisations | rôle runtime + appairages ; préréglage seulement déclaratif | associer sans seconde régie |
| OBS & scènes/micro/minuteur | FIXE uniquement | télémétrie OBS et options enregistrées ; indisponible en autonome Android | configurer sorties/scènes ; préserver valeurs enregistrées hors ligne |
| Twitch / chat / diffusion | compte local facultatif, diffusion OBS sur FIXE | compte OAuth, état de diffusion et scopes distincts | jamais déduire « en direct » de « compte connecté » |
| Google Agenda/planning | compte Google de l’appareil ou FIXE sélectionné | service local ou observation horodatée FIXE | choisir calendrier de cet espace, pas transférer de secret |
| Sons / Streamlabs | appareil local quand disponible ; sortie OBS sur FIXE | route locale/agent et état distant distincts | bibliothèque et alertes, capacité matérielle non prouvée |
| Discord et WizeBot | **FIXE** | état controlHub observé, dépend de l’appairage et du réseau | configurer uniquement si la régie est joignable |
| Automatisations | FIXE | moteur de règles sur la régie ; Android autonome sans moteur | consultation/configuration via FIXE ; pas d’exécution mobile simulée |
| Préférences, stockage, avancé | appareil courant ; profil de la régie si sélectionné | localStorage, profil, backups/migrations | ne pas fusionner sans migration vérifiée les deux périmètres |

## Défaut prouvé et correction
Dans **Paramètres → Connexions**, sur Android autonome, client non appairé ou FIXE hors ligne, « Configurer le bot et le salon » et « Commandes WizeBot » restaient actifs alors que ces parcours nécessitent FIXE. Leur clic aboutissait ensuite à une opération distante indisponible : faux affordance et confusion entre comptes locaux et intégrations de régie.

`apps/mobile/control/settings-view.js` : présentation seule, sans modification de route/permission/secret/autorité. Les deux boutons distants sont désactivés lorsque `online` est faux ou que ni une régie sélectionnée ni le rôle maître local ne sont présents ; message de portée et accès « Associer FIXE » sur les clients. **Google local, Streamlabs et les boutons d’appareil restent inchangés.** La protection serveur et les autorisations continuent à faire foi ; le `disabled` n’est pas une barrière de sécurité côté backend.

## Qualification de ce lot (sans installation)
- RED avant correctif : suite ciblée avec **1 échec** attestant le bouton trompeur. `%TEMP%\sc3-settings-host-only-red-20261106.log`.
- GREEN : **22 PASS / 0 FAIL / 0 skipped**, sur quatre fichiers avec **5 scénarios Edge réels** (rendu 320/390/1366 selon cas ; données simulées, aucune requête réelle). `%TEMP%\sc3-settings-host-only-tests-20261106.log`.
- Matrice/contrat de livraison : **5 PASS / 0 FAIL / 0 skipped**, fichiers `streamcockpit-3-roadmap.test.ts` et `streamcockpit3-release-scope.test.ts`, log `%TEMP%\sc3-settings-host-only-matrix-20261106.log`.
- TypeScript : **PASS** (`%TEMP%\sc3-settings-host-only-typescript-20261106.log`) ; types navigateur JS : **PASS** (`%TEMP%\sc3-settings-host-only-browser-js-20261106.log`) ; sécurité **PASS, 6 761 fichiers** (`%TEMP%\sc3-settings-host-only-security-20261106.log`). `git diff --check` : pas d’erreur de whitespace sur ce lot.
- Aucun essai physique FIXE/laptop/Android, OAuth réel, réseau/reconnexion ou OBS ; G2 toujours en cours, G3–G5 ouverts. Aucune APK/EXE publiée, aucun profil modifié.

## Écarts restants pour prochains lots, sans cumul ici
1. Vérifier le rendu des connexions réellement capables sur Android autonome et la portée exacte du bouton Streamlabs (bridge/permissions) ; ne pas confondre présence de bouton et capacité testée.
2. Poursuivre l’inventaire des doublons de nom/accent entre ProductProfile et anciennes vues Web, sans suppression tant que l’usage de chaque shell n’est pas confirmé.
3. Éviter d’offrir Google « Connecter » depuis un espace où l’OAuth concerne un autre appareil ; documenter les droits et états du fournisseur.
4. Tester G3 sur matériel réel et G4 signatures/migration/rollback ; ne pas promouvoir les gates via un test de rendu.
