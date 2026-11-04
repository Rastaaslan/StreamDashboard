# SC3-FLOW-ONESHOT-001 — restitution finale

Corrections de flux intégrées et qualifiées en logiciel. La livraison globale 3.0 et J10/G5 ne sont pas déclarés terminés. Les fonctions de la matrice conservent PARTIAL ; le succès des suites n’efface ni les manques fonctionnels existants ni les réceptions physiques manquantes.

## Corrections et répartition

- Android appairé : chat FIXE par défaut sans connexion OAuth Android supplémentaire ; compte Android direct seulement sur choix explicite. Aucun jeton Windows copié, aucun basculement silencieux lors d’une panne.
- Modération tactile à 320 px selon les permissions ; capacités rechargées au changement de compte ; brouillons isolés par source.
- Reprise visible/online : ancien GET invalidé, nouvelle identité requise avant envoi ; arrêt du polling caché ; aucun POST rejoué. Un reçu failed/uncertain ne peut plus afficher envoyé avec un simple messageId.
- Windows : espaces Régie/Administration. Android conserve Accueil/Live/Sons/Planning/Plus ; le conflit CSS de titres Windows en mode compact est corrigé et testé à 320/390/1366 px.
- FIXE reste maître OBS, scènes, minuteur, mixeur, soundboard de régie, replays et macros. Laptop contrôle ; Android dispose de projections et de comptes autonomes nommés. Les options locales explicites ne deviennent jamais une deuxième régie OBS.

## Audit et chat Android

22 flux sourcés, 11 fonctions inventoriées, registre des anomalies et contrats de synchronisation conservés. Le chat UI utilise son GET périodique, indépendamment du rafraîchissement OBS et du WS global. Réception FIXE EventSub, cache de 200 messages et dédoublonnage par ID observés dans le code. Le cache ne constitue pas un historique durable et ne garantit pas le replay des messages manqués. Batterie et latence matérielles des deux architectures n’ont pas été mesurées ; aucun bénéfice ne justifie une migration générale vers le compte direct. Le relais est conservé pour 3.0.

Chat Android : correction source et parcours Edge 320 px PASS ; six nouveaux scénarios couvrent relais, compte explicite, déconnexion, veille simulée, reçu et modération/navigation. Aucun téléphone physique ni envoi/modération Twitch public reçu dans cette campagne.

## Qualification réelle

Commit qualifié et emballé : 73a6aae2a8e59c1c22c1f0d304cccb08c1586718. La source était propre ; campagnes séquentielles, priorité basse, aucune installation ni opération publique.

| Vérification | Réussis | Échecs | Ignorés |
|---|---:|---:|---:|
| Vitest — 312 fichiers | 2412 | 0 | 110 |
| Node construit | 351 | 0 | 6 |
| Playwright Edge | 59 | 0 | 0 |
| Electron réel, profil temporaire | 2 | 0 | 0 |
| Android Java QA — rapports réutilisés par Gradle, entrées à jour | 52 | 0 | 0 |

TypeScript, contrôle JS navigateur, sécurité, build runtime 143 assets, syntaxe JS livrée, intégrité paquet Windows, compilation/lint Android et garde de périmètre : PASS, voir evidence/qualification.json. Les tests ignorés ne sont pas qualifiés. Les 59 tests Playwright comprennent aussi des tests de helpers historiques ; ces helpers ne deviennent pas des fonctions YouTube livrées.

Les échecs initiaux sont conservés dans evidence/first-campaign.json : 10 anciennes attentes de contrat, 5 attentes navigateur YouTube retiré et des erreurs d’appel Gradle (dossier puis argument JVM mal cité), corrigées sans changement Java. Les assertions ont été alignées strictement, YouTube reste absent de la production et la commande Gradle corrigée ; la campagne finale est distincte, pas une réécriture des résultats initiaux.

## Fonctions et gates

| Fonction | État | Portée / limite |
|---|---|---|
| F00 — Agent V2 autonome + régie maîtresse | PARTIAL | Agent/autorité et minuteur logiciels ; vraie réception OBS/trio manquante. |
| F01 — Centre de santé intelligent | PARTIAL | Santé et provenance ; matériel et capteurs à recevoir. |
| F02 — Modération Twitch avancée | PARTIAL | Chat relayé et modération tactile corrigés ; AutoMod/historique avancés et réception complète restent partiels. |
| F03 — Régie et macros contextuelles | PARTIAL | Scènes et contexte logiciels ; scénarios réels/macros complètes non reçus. |
| F04 — Marqueurs OBS/Twitch, replays et clips simples | PARTIAL | Marqueurs/replays/clips simples ; confirmations réelles à recevoir. ClipForge V4. |
| F05 — Mixeur audio distribué | PARTIAL | Contrôles et routage logiciels ; vraie VOD/PC jeu à recevoir. |
| F06 — Planning assisté | PARTIAL | Planning et réconciliation ; publication Google réelle et cas avancés non reçus. |
| F07 — Deck Android adaptatif | PARTIAL | Cinq onglets et sources explicites ; téléphone/clavier/Wi-Fi/veille à recevoir. |
| F08 — Interactions Twitch enrichies | PARTIAL | Interfaces de consentement et fournisseurs simulés ; actions publiques non exécutées. |
| F09 — Moments marquants et bilans | PARTIAL | Journal et projections ; session réelle complète à recevoir. |
| F10 — Mise à jour sans interruption | PARTIAL | Préflight et QA ; installation transactionnelle/repli/signatures restent incomplets. |

| Gate | État final |
|---|---|
| G0/G1 | qualified historiques, preuves conservées |
| G2 | in_progress ; campagne logicielle ci-dessus PASS, validation globale non promue |
| G3 | open ; aucune réception trio sur ce commit. Les preuves QA a38305f restent historiques |
| G4 | open ; paire QA même commit disponible, signatures de production et migration/repli réels manquants |
| G5/J10 | open / NOT_RELEASE_ELIGIBLE ; accord explicite opérateur non fourni |

## Commits et livrables

- 9ce4215 : corrections chat/flux et audits ; 73a6aae : contrats Twitch-only et navigation compacte. Les preuves finales sont ajoutées par un commit documentaire ultérieur ; ce dernier ne change pas le code emballé.
- Les 11 livrables demandés sont dans ce dossier, avec SERVICE_FLOW_DETAILS.json et preuves. CONTINUITY et feature-matrix actualisés, sans surqualification.
- Une seule paire QA préservée dans C:\Users\damie\Dev\StreamCockpit-3.0-FullExperience\out\sc3-flow-qa\73a6aae2a8e5. Windows non signé et Android Debug .qa, pas une RC de production. Manifestes : evidence/artifacts.json et artifacts.json à côté des binaires.

## Blocages et intervention opérateur

La correction sur téléphone requiert une installation QA autorisée et une réception réelle : identité, chat, clavier, envoi, modération, ordre/doublons, Wi-Fi et veille. Les parcours OBS/minuteur/audio/VOD/sons/planning/reçus doivent être reçus sur FIXE/laptop/Android ; démarrer/arrêter un live ou publier sur Twitch nécessite l’autorisation distincte du ticket. Les manques fonctionnels avancés ci-dessus restent visibles, notamment F02 et F10 ; ne pas confondre tests des flux existants et intégration de tout le produit.

Pour la release : signatures Windows et Android stables compatibles à configurer sans créer de clé de remplacement, conservation des données/migration/repli à recevoir, puis validation formelle des gates et décision explicite de candidate unique. Aucune installation, publication, profil RC2, donnée Contra/Director/Crafty ou machine tierce modifié. Aucun processus d’un autre projet arrêté.

Le garde de release --final a effectivement refusé la publication (exit 1), comme attendu. Les 52 rapports JUnit Android ont été réutilisés par Gradle avec entrées à jour ; ils ne sont pas comptés comme une nouvelle exécution ni une réception physique. Les tâches de compilation des assets, lint et assemblage QA ont été vérifiées dans cette campagne.
