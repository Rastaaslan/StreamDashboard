# SC3-CLOTURE-UNIQUE-20261106 — Clôture du CDC existant

**Directive Dam, 6 novembre 2026 : un seul lot complet du reste à faire, puis qualification par Dam pendant son live.** Aucun ajout de périmètre, aucune nouvelle architecture, aucune succession de restitutions de petits lots. Cette directive remplace la méthode « un petit lot par passage ». Les preuves historiques restent conservées, mais les nouvelles étapes et leur bilan sont regroupés ici.

## Sortie attendue
Une révision consolidée du périmètre 3.0 F00–F10, testée en logiciel et relue ; une seule paire Windows x64 / APK du même commit lorsque sa préparation est autorisée et réalisable ; la checklist de réception en live ci-dessous. Ne pas présenter les signatures, le matériel ou l'acceptation de Dam comme acquis. Ne pas remplacer les installations utilisées ni utiliser le live comme banc d'essai automatique. Le souhait de réception le 6 novembre n'est pas une preuve de disponibilité ni une échéance garantie.

## Reste à fermer, sans extension
| Référence existante | Clôture à obtenir | État de départ contrôlé à 20 h 32, HEAD `08e81f6` |
|---|---|---|
| F03 / F07 | Terminer et intégrer les macros multi-étapes dans l'éditeur, le circuit d'exécution et les retours existants ; aucun deuxième moteur de régie. | Propriétaire F03 actif, changements non commités. Ne pas écraser ses fichiers. |
| F05 | Intégrer les correctifs UI en attente, finir la consultation des reçus déjà persistants et les raccordements audio/routage exigés par le CDC. | Persistance/rollback intégrés en `fca77d3`. UI mixeur et test navigateur modifiés par un autre propriétaire, pas intégrables sans transfert explicite. |
| F10 | Raccorder le parcours existant de préparation, vérification, sauvegarde, remplacement/restauration à la mise à jour réellement distribuée ; conserver le report pendant live et les opérations incertaines. | Journal, coordination, Authenticode et migration F09 intégrés. Updater de production encore bloqué ; transaction native, lancement distribué et observations indépendantes incomplets. |
| F00–F02 / F04 / F06 / F08 / F09 | Régression intégrée des parcours existants et correction de défauts réellement reproduits ; aucun développement facultatif pour remplir une passe. | Source et preuves disponibles ; les réceptions OAuth/fournisseurs et matérielles ne deviennent pas des exigences de code nouvelles. Historique viewer limité aux observations AutoMod locales, limite à rendre explicite. |
| Livraison | Stabiliser le HEAD, vérifier l'intégration et les ressources, puis préparer la paire unique et les instructions. | Aucun nouveau paquet construit par cette clôture à son ouverture. |

Les points qui ne sont que de réception restent séparés du développement. Le mode `--agent` existant n'impose pas de créer un nouveau service Windows. Le support de plusieurs architectures d'installation n'est pas ajouté par principe ; toute divergence entre déploiement réellement utilisé et updater reste explicitement bloquante. Affichage modulaire V3.1 et ClipForge avancé V4 restent exclus.

## Propriété et exécution
- Machine exclusive : FIXE, device `b5db7551-143d-410a-8b84-157070125122`, via Remote Desktop Commander ; dépôt et branche canoniques inchangés. Aucun Work/CodexBridge, autre appareil, profil utilisateur, secret, installation ou projet Minecraft.
- La tâche d'audit autonome a été désactivée ; la tâche de convergence a été renommée **StreamCockpit — clôture unique** et reprend ce seul lot. Une tâche déjà en exécution n'est pas réputée arrêtée par cette désactivation.
- La session de clôture prend uniquement ses fichiers libres dans `.git/sc3-final-closure-owner.json`. F03 termine ses fichiers exclusifs avant transfert. F05 et CONTINUITY restent intacts tant qu'aucun transfert n'est attesté. Aucun reset, force push, stage global ni suppression de données.
- Un seul bilan final du lot, pas une fin annoncée à chaque commit. Aucun 100 % sans inventaire des exigences réellement implémentées et raccordées.
- Tests ciblés et Edge si UI, TypeScript/types navigateur, sécurité et diff ; nombres exacts PASS/FAIL/skipped. Suite générale et packaging uniquement sans conflit ni charge incompatible. Tests temporaires et fournisseurs simulés toujours distingués du matériel.

## Réception de Dam — avant, pendant et après le live
**Avant diffusion, sur la révision effectivement livrée :** démarrage FIXE/Agent et clients ; régie et minuteur uniques ; scènes intro/pause/fin ; micro/muet et son PC jeu ; piste Spotify exclue de la VOD ; planning et chat cohérents ; aucune reconnexion requérant de perdre les comptes. La conformité de la VOD se confirme après publication réelle, pas seulement par les cases OBS.

**Pendant le live, actions décidées par Dam seulement :** retour d'état frais ; une macro configurée ; commandes audio et reçus ; chat/modération autorisée ; un repère/replay/clip simple ; une interaction Twitch choisie ; reconnexion du Deck sans répétition ; événements Streamlabs et timeline. Aucun démarrage/arrêt de diffusion, message public ou mutation OBS déclenché par l'automatisation de développement.

**Hors live uniquement :** installation/mise à jour, migration, redémarrage/crash et rollback ; signatures et identité de la paire Windows/APK ; reprise et préservation des reçus. Ces essais ne doivent pas être imposés au milieu du live et ne sont pas remplacés par son bon déroulement.

## Suivi de cette clôture
- Ouverture : préflight complet à `08e81f6`, branche/origin conformes, aucun lock Git/rebase, charge observée 12 %, OBS simplement constaté. Lecture des quatre autorités, audit final et derniers handoffs.
- Coordination : audit séparé désactivé ; convergence réorientée vers ce lot unique. F03 reste propriétaire actif, F05/CONTINUITY préservés.
- Développement consolidé : **en cours**, aucune promotion de gate et aucun paquet livré à l'ouverture.
- G0/G1 historiquement qualifiés ; G2 en cours ; G3–G5 ouverts.

### Enregistrement de la directive
Changement de coordination uniquement : aucune fonctionnalit? applicative ajout?e et aucune nouvelle candidate revendiqu?e. Les deux suites de coh?rence roadmap/readiness passent : **9 PASS / 0 FAIL / 0 skipped**. Diff documentaire v?rifi?. Ces tests ne constituent pas une requalification du code F03/F05 concurrent. La matrice et les gates restent inchang?es. Les futures ?tapes du m?me lot sont consign?es dans ce document ; l'audit s?par? ne relance plus de petits lots.


## Reprise du lot unique — 06/11/2026, contrôle final 22 h 06 CET

Base relue `7bb9bc5c06a9308b8f3c07df518979162379d363`. Reprise de la session native interrompue `RDC-FIXE-final-closure-native-20261106`, avec son périmètre déclaré et sans transfert fictif des fichiers F03/F05. PLAN, matrice, CONTINUITY, MIGRATION et audit final relus avant écriture ; branche/origin, index, opérations Git, processus et charge contrôlés. Les dix fichiers tiers protégés sont restés identiques par SHA-256 pendant les contrôles. Aucun accès aux profils installés, secrets réels, autres machines ou projets exclus ; aucune commande OBS/Twitch de production.

### Raccordement natif réalisé dans le même lot
Le point d'entrée de maintenance, son lanceur et son observateur indépendant déjà engagés sont raccordés au **main Desktop existant**, au menu/tray natif et à l'option explicite de notification de mise à jour. L'application lit sa politique publique de confiance indépendamment du contrat choisi, vérifie le paquet signé, demande une confirmation native, puis transmet les seules observations nécessaires au processus de maintenance par un pipe privé. Aucun secret dans les arguments, variables d'environnement, fichier de contrat, renderer ou HTTP. Le serveur n'expose la capacité qu'au main natif.

L'exécutant s'appuie sur le même planificateur durable et les mêmes copies/migrations/rollback : il utilise le runtime Node de l'image authentifiée, hors des dossiers à remplacer, attend la sortie normale de l'ancien processus et ne tue ni celui-ci ni OBS. Son observation indépendante utilise les lectures OBS/Aitum et Twitch ; une déconnexion n'est jamais assimilée à un état hors ligne. Le contrôle Windows des processus/services complète le mutex existant. Une signature manquante, une observation inconnue, un écrivain restant ou un consentement annulé empêchent l'admission.

La notification de téléchargement ne vaut pas autorisation d'installation : elle conduit seulement, après choix opérateur et recontrôle live, au même parcours natif de contrat signé. L'ancien préflight bloquant reste le comportement sans raccordement natif. Une fermeture de l'updater invalide la sélection encore ouverte ou annule notre helper avant handoff. Aucun `quitAndInstall` automatique ni second moteur d'installation. Les derniers journaux d'arrêt sont capturés après la sortie, dans un inventaire de hashes réutilisable hors profil ; aucune reconstitution silencieuse après une opération tentée et aucune sauvegarde complète supplémentaire créée par ce contrôle.

Le build existant embarque l'entrée CJS de maintenance et, uniquement lorsqu'elle est fournie indépendamment, une politique **publique** de confiance. Le comparateur de version native tient compte des composants PE numériques déjà produits par Forge, uniquement en conjonction avec le signataire OS et les hashes de l'image complète. Aucun certificat ni politique de production n'a été créé ou utilisé ici.

### Preuves de la reprise consolidée
- **27 fichiers de tests, 378 PASS / 0 FAIL / 0 skipped / 0 todo**, `.git/sc3-final-closure-consolidated-tests.json` et `.git/sc3-final-closure-consolidated-tests.log`. Campagne ciblée de l'intégration native, lifecycle, maintenance, migration et non-régression ; ce n'est pas la suite générale de tout le CDC.
- `build:types`, `check:browser-types`, `security:check` (**6 846 fichiers**) et `git diff --check` : **PASS**, codes 0. `.git/sc3-final-closure-consolidated-validation.json` vérifie le même HEAD avant/après, des sources détenues stables et tous les hashes tiers conservés. Un seul worker, priorité basse. Une campagne focalisée préalable de 77 PASS n'est pas ajoutée au total final.
- Vrais fichiers/SQLite et processus Windows temporaires ; protocole OBS WebSocket loopback synthétique et réponses Twitch simulées. Le helper CJS est réellement construit dans un dossier temporaire et exécuté avec l'Electron du dépôt en mode Node sur un cas de refus, sans démarrer l'application. La détection Windows d'un écrivain temporaire et le rejet Authenticode d'un fichier non signé sont réels.
- Les succès de signature OS, la confirmation du menu Electron et les états de live positifs sont simulés. Les tests du vrai point d'entrée main utilisent Electron simulé ; aucun nouveau contrôle Edge, EXE installé ou Android physique n'est revendiqué. Aucun build de distribution, nouvelle paire QA, RC ou déploiement.

### État de clôture — toujours non livré
Les sources et tests natifs de cette session peuvent être intégrés séparément sans toucher aux travaux tiers, mais **le lot complet n'est pas terminé**. Les macros F03 et l'interface F05 restent modifiées hors HEAD, sans transfert explicite de propriété ; la déclaration F03 est encore présente. Un horodatage ancien ne prouve ni leur abandon ni leur autorisation d'intégration. Leur finalisation/intégration reste nécessaire avant une régression générale et une paire unique du même commit.

Le parcours natif documenté concerne le déploiement Windows par dossiers explicitement préparés. La transaction/inscription Squirrel, la mise à jour native Android, les politiques/certificats de production et les réceptions matérielles ne sont **pas** qualifiés par ces tests ; ne pas les déclarer achevés au vu du seul helper. Aucun changement de périmètre n'est pris pour contourner ces limites. G2 `in_progress`, G3–G5 `open` ; aucune annonce de 100 %.

**Point de reprise :** intégrer les sources natives détenues avec les preuves ci-dessus, obtenir le transfert réel des travaux F03/F05 en attente, terminer leurs parcours existants, puis qualifier le seul état consolidé. La version utilisée par Dam reste intacte ; le live n'est pas utilisé automatiquement comme banc d'essai.

## Reprise F03/F05 explicitement autorisée — consolidation du 06/11/2026

Base de cette reprise : `086fcdf3eeeb71173f34184ace4999d33e170445`, FIXE uniquement. Dam a répondu **« oui »** à la reprise de propriété des fichiers F03/F05 déjà modifiés, en conservant leur travail. Le transfert est enregistré dans `.git/sc3-f03-sequence-transfer-20261106.json` ; cette passe ne considère plus ces fichiers comme bloqués par un autre propriétaire. Les modifications héritées sont intégrées et complétées, pas restaurées depuis HEAD. CONTINUITY et les rapports AUDIT tiers restent inchangés et hors index. Aucun accès à une installation, un profil ou un certificat de production ; aucun appareil tiers ni commande OBS/Twitch réelle.

### Parcours maintenant raccordés
**F03 — macros manuelles du Deck.** L'éditeur existant propose une sélection ordonnée de deux à cinq boutons OBS existants (scène, mode, micro, minuteur, média). Le même champ de configuration, la même file de régie et les mêmes reçus sont utilisés. Le lancement affiche les étapes et exige une confirmation ; chaque étape est journalisée avant son effet, puis confirmée. Une étape incertaine interrompt les suivantes sans répétition automatique. La progression reste lisible après redémarrage. Les associations vers une autre destination et les anciens raccourcis clavier ne contournent pas la confirmation.

Le contexte d'une séquence suit uniquement son propre changement de scène confirmé : le compte, les droits, l'hôte, la génération OBS, la catégorie, l'état du live et la révision de configuration restent contrôlés. Le jeton de prévisualisation partagé n'est jamais réautorisé pour une autre commande. Une modification extérieure interrompt la suite. Le vrai formulaire conserve la propriété `shortcut` vide, même quand son contrôle HTML désactivé est absent du FormData. Les actions publiques Twitch, démarrage/arrêt de live, imbrications et temporisations ne sont pas ajoutés à cette séquence manuelle.

**F05 — historique et routage OBS.** La consultation paginée des reçus déjà persistants est raccordée à l'interface, avec lecture seule par défaut et nouvel aperçu/consentement pour un retour manuel. Le circuit gain/muet existant traite également les six pistes OBS et le monitoring d'une source : lecture préalable, UUID réel, révision, permissions, intention durable, écriture puis relecture. Un réglage déjà présent n'écrit rien ; un refus ou résultat incertain n'est pas relancé. Après redémarrage du routeur, l'historique reste disponible et un rollback exige que la source et ses valeurs soient encore compatibles.

Ce routage concerne les sources OBS, y compris la capture du PC jeu ; il ne prétend pas contrôler les périphériques système Windows du PC jeu. Le numéro de piste VOD Twitch n'est pas deviné et sa correspondance doit être vérifiée dans OBS. La séparation effective stream/VOD et l'audibilité demeurent des essais matériels. Le défaut hérité de réactivation du bouton après une réponse de routage arrivée hors connexion est corrigé ; une réponse ancienne ne débloque pas non plus une inspection plus récente.

**Ressources livrables.** Le build runtime regénère le graphe public et le service worker, incluant le module d'édition/progression des macros. Le manifeste de cache modifié provient de `scripts/build-public-assets.mjs`, non d'une réécriture manuelle. Aucun nouveau moteur de régie, service de mise à jour ou périmètre V3.1/V4 n'est créé par cette reprise.

### Qualification consolidée, sans additionner les répétitions
| Campagne | PASS | FAIL | Ignorés | Preuve locale |
|---|---:|---:|---:|---|
| Première suite Vitest générale | 2 888 | 10 | 129 | `.git/sc3-closure-full-tests.json` |
| Reprise ciblée des contrats en échec, avec contrôles indépendants | 61 | 0 | 0 | `.git/sc3-closure-regression-repair-final.json` |
| Suite Vitest générale finale, 365 fichiers | 2 898 | 0 | 129 | `.git/sc3-closure-final-vitest.json` |
| Tests Node sur runtime compilé | 352 | 0 | 6 | `.git/sc3-closure-final-node-built.log` |
| Revalidation F03/F05 sur l'UI intégrée, 7 suites | 31 | 0 | 0 | `.git/sc3-closure-current-ui-final.json` |

La dernière campagne ciblée comprend **10 scénarios Microsoft Edge réels**, notamment l'éditeur, le routage, l'historique, la reconnexion et le retour manuel. HTTP, WebSocket OBS de test, fichiers temporaires et SQLite sont exécutés réellement ; les fournisseurs, scènes et sources physiques sont simulés sur loopback. Ces tests n'ont pas contacté OBS ou Twitch de production.

Les dix échecs de la première campagne générale n'ont pas été effacés. Ils provenaient d'un certificat TLS de test expiré le 5 novembre, d'un mock de chemins Electron devenu incompatible avec l'exclusion de maintenance, de deux assertions textuelles antérieures au helper de fraîcheur, et d'un test Streamlabs qui attendait encore une reprise d'écriture/fermeture propre après un COMMIT rendu incertain. Les fixtures TLS **jetables et ignorées par Git** ont été renouvelées avec le générateur existant ; aucun signataire de production n'est créé. Les tests de ports gardent leurs assertions exactes, avec OBS désactivé et l'ownership testé séparément dans ses vrais processus Windows. Le test Streamlabs exige maintenant le blocage persistant, l'absence de nouvel essai CAS et l'arrêt signalé incertain, conformément au comportement F10 existant. Aucun garde produit n'a été retiré pour faire réussir ces tests.

Le build runtime, TypeScript global, les types navigateur, le contrôle des JavaScript livrés, la syntaxe et `security:check` (**6 856 fichiers**) passent ; `git diff --check` passe. Le build produit **150 ressources publiques**, sans package Windows/APK. Un worker à priorité basse ; HEAD et empreintes des sources applicatives inchangés pendant la campagne générale. Après celle-ci, seul le test historique qui lisait l'ancien `git show HEAD` a été raccordé à l'UI actuelle avec un sélecteur de consentement précis ; les 31 tests ciblés le requalifient. Les 129 et 6 tests ignorés ne sont pas des validations, et les dix scénarios Edge ne sont pas dix appareils physiques.

### État de sortie et limites réelles
Le blocage de propriété F03/F05 est levé et leurs parcours ci-dessus sont intégrés. **Cela ne clôt pas encore tout le CDC ni G2.** Restent notamment la transaction de mise à jour native Windows/Squirrel et Android, la confiance/signature de production, la paire Windows x64/APK du même commit et la réception matérielle. Le raccordement Desktop à la maintenance par dossiers du commit précédent est conservé, sans être présenté comme une transaction native Android/Squirrel complète.

Aucune nouvelle candidate de distribution ni installation n'est effectuée par cette consolidation. La version en usage, OBS et le live restent intacts. G0/G1 historiques ; G2 `in_progress`, G3–G5 `open`. La suite reprend **ce même lot** au raccordement final de distribution F10 ; ne pas rouvrir les macros, l'historique audio ou les garde-fous déjà intégrés, et ne pas inventer un autre lot pour les mêmes corrections.

## Clôture Work — nuit du 6 au 7 novembre 2026

**Version de réception : 3.0.0-alpha.2.** Même lot, FIXE uniquement, aucun déploiement ni action OBS/Twitch de production. F03/F05 sont conservés, sans réécriture de leurs éditeurs, journaux ou moteurs. CONTINUITY et les huit rapports AUDIT tiers restent préservés et hors index.

### Résultat et limite de développement

Le chemin Windows réellement observé est `C:\Users\damie\StreamCockpit-QA\f15845bcc242\app\StreamDashboard.exe` : distribution QA par dossiers. La réception conserve ce format. Le menu, le choix opérateur, l’exécutant externe, les sauvegardes/migrations/relectures et le retour manuel réutilisent le planificateur durable déjà intégré. Les clients sans rôle OBS utilisent désormais leur association et leur pin TLS existants pour lire l’état hors live de FIXE. La lecture native est accessible aux appareils appairés avec permission **observe**, sans affaiblir la gestion complète du v2.

La notification de version disponible lit seulement les métadonnées publiques. Elle ne lance plus un téléchargement Squirrel susceptible de préparer une application au prochain démarrage. Le choix explicite conduit au même contrat signé et à la même maintenance. Sources de référence : [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater), [Android PackageInstaller](https://developer.android.com/reference/android/content/pm/PackageInstaller).

Android propose dans **Plus → Mise à jour Android** la préparation d’un APK, sa provenance, son identité, son signataire et une version de code supérieure. La confirmation requiert une observation FIXE fraîche et hors live. Le consentement système et les autorisations Android sont respectés. Un identifiant de session et un état durable précèdent l’effet ; une interruption n’entraîne aucun recommit automatique. La reprise vérifie le paquet effectivement installé, la version, le signataire et le dossier de données. Une correction système ultérieure, de version supérieure et du même signataire, peut être constatée comme récupération en conservant l’ancienne tentative ; jamais comme succès inventé de celle-ci. Ni désinstallation ni downgrade n’est présenté comme rollback.

**Le CDC n’est pas annoncé à 100 %.** La transaction native d’une installation issue de Squirrel/Setup.exe reste non implémentée dans ce parcours par dossiers. Elle est détectée et refusée. Le maker existant reste présent ; ce refus n’est pas une installation réussie. Les signatures de production et la réception réelle restent également ouvertes. Cette limite de code est distincte des certificats manquants et des essais matériels.

### Confrontation F00–F10

| Exigence existante | État logiciel de cette consolidation | Réception encore nécessaire |
|---|---|---|
| F00 Agent et autorité | Circuit existant conservé ; horloge/anti-replay et processus Windows isolés revalidés | Trio, arrêt/reprise réels de la version livrée |
| F01 Santé | Fraîcheur et inconnus conservés ; pas de batterie DJI inventée | Matériel DJI/audio/performance |
| F02 Modération | Permissions, AutoMod et journaux couverts par la régression | OAuth et décisions fournisseur réelles |
| F03 Macros | Éditeur et reçus du commit intégré conservés, cas navigateur activés | Scènes, catégories et rôles réels |
| F04 Moments simples | Marqueurs/replay/clips simples revalidés ; ClipForge V4 exclu | Fichier replay et disponibilité Twitch |
| F05 Mixeur | Gain/muet/pistes/monitoring/historique et retour manuel revalidés | Capture PC jeu et séparation réelle stream/VOD |
| F06 Planning | Brouillons et publication explicite revalidés ; tests ouvrent le volet actuel avant de choisir | Google réel, conflits externes et trio |
| F07 Deck | Navigation/contexte/reconnexion revalidés | Toucher et suspension Android physique |
| F08 Interactions | Sondages/prédictions/raid/shoutout revalidés sans fournisseur public | Résultats Helix/EventSub et destinataires réels |
| F09 Timeline | Persistance/migration/partage logiciel revalidés | Session complète et Streamlabs réels |
| F10 Maintenance | Parcours par dossiers Windows et PackageInstaller Android raccordés ; contrôle appairé testé par vrai HTTPS | Squirrel absent ; production et récupération sur appareils non qualifiées |

### Qualification consolidée, campagnes non additionnées

| Campagne finale | PASS | FAIL | Ignorés |
|---|---:|---:|---:|
| Vitest général, 370 fichiers | 3013 | 0 | 61 |
| Node sur runtime compilé | 352 | 0 | 6 |
| Java QA, 12 rapports JUnit | 57 | 0 | 0 |

TypeScript, types navigateur, sécurité, build runtime, JavaScript livré et diff : codes 0. Compilation et lint Android : codes 0. Les premiers échecs et leurs causes sont conservés dans les journaux locaux ; ils ne sont pas effacés des historiques. La confidentialité du raid est contrôlée par les champs publics exacts, avec une échéance déterministe contenant 999. Les parcours planning conservent leurs assertions de non-publication après ouverture du volet réel. Le contrôle distant a une preuve RED puis une preuve HTTPS appairée positive ; ce n’est pas une simple vérification locale sans middleware.

Les **61 ignorés Vitest** sont **54 cas ClipForge V4**, **6 cas d’adaptateur POSIX non applicable à la distribution Windows** et **1 test nécessitant le privilège Windows de création de liens**. Les **6 ignorés Node** sont des fixtures shell du runner CI Android Linux. Aucun n’est compté comme PASS. Le détail nominatif et les comptes se trouvent dans [software-validation.json](evidence/SC3-CLOTURE-UNIQUE-FINISH-001/software-validation.json).

Edge, les serveurs HTTP/HTTPS, TLS, le pairing temporaire, les fichiers/SQLite et les processus Windows de laboratoire sont réels. OBS, Twitch, Google et les succès de signature de production sont simulés. Java s’exécute sur le JDK de FIXE, sans appareil Android ni installation système. Ces preuves ne sont ni un live public ni une réception du trio.

### Paire unique et provenance

La construction utilise un arbre Git propre du même dépôt sur FIXE, en HEAD détaché, avec dépendances et caches réutilisés. Le worker est généré depuis les octets canoniques de cet arbre avant le gel ; aucun document tiers n’est stasé, réinitialisé ou indexé, aucun indicateur sourceTreeDirty n’est falsifié. Aucun autre candidat ni branche produit n’est créé.

Le résultat effectif de construction est le manifeste `out/sc3-reception-unique/<sourceCommit12>/reception-manifest.json`. Il fournit commit complet, empreinte des sources, identités/versions, SHA-256, observations de signatures et compatibilité QA. Son absence signifie que la paire n’a pas été produite. Windows inclut son dossier complet et une archive ; l’APK est de type QA `.next.qa`, jamais annoncée compatible avec une installation signée autrement. La clé QA existante peut signer cet artefact ; aucune nouvelle clé n’est créée.

Le smoke Electron standard utilise les ports réservés aux instances en usage : il n’est pas exécuté ici. La vérification du binaire préparé se fait en mode Node, sans démarrage de l’application, fenêtre, port ou profil, et ne certifie donc pas un démarrage graphique installé. Le contrôle EXE/ASAR et des ressources livrées reste obligatoire. G2 demeure en cours ; G3/G4/G5 restent ouverts, sans promotion automatique.

### Checklist unique — réception de Dam

**Pendant le live, après préparation et lancement autorisés hors live de cette paire précise :**

- [ ] Vérifier version et commit des trois appareils ; régie FIXE et minuteur uniques.
- [ ] Scènes Intro/Pause/Fin, micro et son du PC jeu : commandes et états cohérents.
- [ ] Macro existante : confirmation, étapes, reçus ; aucun départ automatique après reconnexion.
- [ ] Mixeur, pistes et monitoring : relecture ; Spotify effectivement absent de la VOD après publication.
- [ ] Chat relayé, permissions et modération choisie par Dam.
- [ ] Planning identique ; brouillon local conservé, publication seulement sur choix explicite.
- [ ] Un marqueur/replay/clip simple et une interaction Twitch décidée par Dam.
- [ ] Streamlabs et timeline ; DJI inconnu tant qu’aucune mesure fraîche n’est reçue.
- [ ] Reconnexion Android/laptop sans deuxième maître, commande répétée ni faux résultat.
- [ ] Mise à jour disponible reportée pendant la diffusion.

**Hors live exclusivement :**

- [ ] Contrôler le manifeste et les SHA-256 ; distinguer QA et production, vérifier le signataire compatible sans désinstaller.
- [ ] Pour Windows, confirmer la distribution réelle ; ne pas appliquer un contrat par dossiers à Squirrel.
- [ ] Vérifier la politique publique de confiance et la chaîne de signature autorisée.
- [ ] Mise à jour consentie, sortie normale, version et données relues ; associations, comptes, planning et journaux conservés.
- [ ] Reprise interrompue : conserver l’incertitude, aucun renvoi automatique.
- [ ] Retour Windows sur la sauvegarde qualifiée sans écraser un journal plus récent ; récupération Android par correction supérieure compatible, jamais par effacement/downgrade.
- [ ] Réception effective FIXE/laptop/Android puis décision séparée de Dam pour G3/G4/G5.
