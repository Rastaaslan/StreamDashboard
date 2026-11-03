# StreamCockpit 3.0 — Gates G2 à G5 : preuves de livraison à produire

_Créé sur FIXE Windows 11 le 03/11/2026 ; document d'exécution, **pas une qualification ni une autorisation d'installation**._

## G2 — F04 ClipForge Windows intégré et sûr

1. **Binaires** : fournir une chaîne de confiance vérifiable et externe pour FFmpeg, FFprobe et `StreamCockpitClipJob.exe`. Les trois exécutables doivent être des fichiers locaux normaux, sans reparse point ou lien multiple, avec SHA-256 et Authenticode `Valid` associés à des empreintes de certificats explicitement approuvées. La commande de préflight `npm run streamcockpit3:clipforge-status` ne modifie aucun fichier ; elle doit rapporter les refus jusqu'à provisionnement. Le FFmpeg WinGet observé le 03/11 est `NotSigned`.
2. **Staging NTFS** : source et sortie sous des racines réellement contrôlées par FIXE, sans dossier partagé ni droits Allow pour des SIDs étrangers (y compris groupes sandbox), héritage de DACL protégé ; rejeter les liens/jonctions et toute course d'identité de fichier. Réserver l'intent durablement avant encodage, et ne jamais relancer une opération incertaine.
3. **OBS ReplayBufferSaved** : connecter une identité de fichier vidéo réel au grant serveur de façon durable, sans donner chemin local ou token à Android. Respecter la session OBS FIXE et son époque ; ne pas copier des centaines de Mo durant un live sans contrôle de ressources. Ne jamais créer une seconde régie OBS ou un nouveau minuteur.
4. **API + UX** : route management appairée `observe+clips`, prévisualisation non mutante, sélection du segment et des légendes, consentement distinct avant tout traitement, reçus rejouables seulement en lecture et résultat incertain visible. Ne pas autoriser la commande si le codec/Job Object/source/permissions/hôte ne sont pas qualifiés. Vérifier Desktop et Android en vrai navigateur et sur téléphone.
5. **Échec et durabilité** : encoder des replays OBS autorisés avec vraie identité de fichier, vérifier dimensions/durée/hash, ressources CPU/mémoire/durée, interruption/tuer superviseur, collision, disk full, coupure/reprise de données sur copie, rejeu refusé, et audit de l'opération. Les 15 tests du laboratoire vidéo synthétique ne qualifient pas ces obligations.

## G2 — autres fonctionnalités

Toutes F00–F10 doivent disposer d'un parcours Desktop/API/Android couvert et de preuves adaptées ; code seulement `partial`/tests simulés ne suffit pas à `qualified`. En particulier, les intentions Twitch incertaines F08 nécessitent une procédure opérateur de réconciliation et une preuve fournisseur valide ; les boutons OBS/Twitch critiques ne doivent jamais être déclenchés automatiquement pendant les tests. F09-Q reste isolé jusqu'à revue et tests spécifiques.

## G3 — essais sur matériel réel, non simulables

- Faire les tests **uniquement dans une fenêtre autorisée par l'opérateur** : FIXE (régie et autorité OBS unique), laptop (jeu, jamais régie de repli), Android physique (client appairé).
- Vérifier identité du FIXE et époque OBS, état déconnecté puis reconnecté, perte Wi-Fi Android, redémarrage de l'Agent, perte du PC jeu, redémarrage FIXE pendant session inactive, et affichage des accusés incertains sans deuxième commande.
- Vérifier minuteur maître sur les trois appareils sans décalage mesuré au-delà du seuil accepté par l'opérateur ; Spotify Windows présenté comme lecteur local, batterie DJI uniquement si télémétrie et âge effectivement observables, VOD Spotify/audios réellement routés comme attendu.
- Pour les actions Twitch publiques, ne procéder **qu'avec permission ponctuelle explicite et contexte de test approprié** ; sinon les marquer non testées. Ne jamais démarrer/arrêter un vrai live par automatisation.
- Pour chaque scénario : horodatage, versions/copie du commit, appareil, mesures et logs expurgés, statut PASS/FAIL/skipped. Laptop hors ligne et téléphone Android inaccessible au contrôle du 03/11 : aucune qualification G3 revendiquée.

## G4 — intégrité de la livraison et réversibilité

- Signer une version Windows **x64** avec certificat de code signing approuvé ; signer l'APK avec la **clé de mise à jour Android de production**, sans la recopier dans le dépôt.
- Enregistrer l'empreinte SHA-256 exacte de chaque artefact, un identifiant de commit source **embarqué dans les deux fichiers**, vérifier signature Authenticode valide et empreinte signataire, `apksigner verify` et digest de certificat Android ; recouper les deux attestations et le `git rev-parse HEAD`, pas seulement la déclaration d'un manifeste libre.
- Sur **copies isolées et explicitement autorisées** de la configuration utilisateur, tester les migrations RC2→3.0, sauvegarde vérifiée, redémarrage/rollback après panne au milieu d'une migration, retour RC2 sans corruption, conflits de sources des minuteurs et non-répétition des opérations OBS/Twitch.
- Aucun script `release:check` ne doit retourner 0 avant la preuve des gates et la qualification indépendante des signatures. Au contrôle FIXE du 03/11 : 0 certificat utilisateur de code signing avec clé privée détecté, SDK Android non configuré ; pas d'EXE/APK prod vérifiable.

## G5 — unique candidate et accord utilisateur

Une fois G2, G3 et G4 documentés et qualifiés : figer **un seul** commit, régénérer les deux artefacts depuis lui, vérifier leurs signatures et leurs hashes, produire la matrice des scénarios et soumettre la candidate à l'approbation de l'opérateur. **Aucune publication, installation ou RC finale** avant cette approbation. La 3.1 modulaire n'est pas une dépendance de 3.0.

## Statut actuel

G0/G1 historiquement `qualified` ; G2 `in_progress` ; G3/G4/G5 `open`, F04 `partial`. Ce document définit la marche à suivre et ne change aucun statut par lui-même.
