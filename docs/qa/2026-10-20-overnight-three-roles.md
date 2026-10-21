# Audit des trois entités — nuit du 20 au 21 octobre 2026

## État et point de reprise

Statut : CONSOLIDÉ — corrections logicielles et paquets RC11.7 prêts ; installations et essais physiques en attente des appareils.

Demande de Damien : auditer et corriger le PC stream FIXE, le PC jeu Laptop-damien et le téléphone Android. Campagne commencée le 20 octobre à 23 h 16, Europe/Paris. Dernier contrôle des appareils vers 00 h 13 le 21 octobre : dam-server accessible ; FIXE et Laptop-damien hors ligne ; aucun accès direct au téléphone.

Dépôt autoritatif : /home/damien/StreamDashboard-Next-desktop-live  
Branche : work/streamdashboard-desktop-live-reliability  
Base initiale vérifiée : fc0fb3c026d52798be8229385d0a4b218d5c3baf, RC11.6.  
Version préparée : 2.0.0-rc.11.7 ; Android versionCode 2000020.  
La révision finale doit être lue avec git rev-parse HEAD : ne pas repartir d’une ancienne copie RC11.4.

Les neuf lots ont été intégrés après vérification du HEAD, du SHA-256 de chaque préimage et du contenu transféré. Le bundle mobile partagé a été reconstruit. Les corrections RC11.5 et RC11.6 sont incluses.

**Aucune installation sur les PC ni sur le téléphone n’a été effectuée pendant cette campagne.** Dernière version active constatée sur les deux PC avant leur déconnexion : RC11.4. Les paquets RC11.5 précédemment déposés, la RC11.6 construite et la RC11.7 actuelle ne doivent pas être confondus avec une version active.

## Autorisations et invariants de reprise

- Corriger, tester, construire et sauvegarder sur la branche de travail existante ; ne pas fusionner vers main ni forcer un push.
- L’installation sur les deux PC est autorisée lorsqu’ils sont accessibles et qu’une nouvelle observation confirme l’arrêt de Twitch, YouTube, de l’enregistrement et de toutes les sorties de diffusion OBS/Aitum.
- Ne pas lancer de live, envoyer du chat réel, modifier scène ou micro pour simuler un essai ; ne pas interrompre OBS ni réveiller une machine.
- dam-server sert au développement et aux builds, pas de hub de l’application. Préserver WorldPrep, Minecraft, Sentinel et les autres services. Pas de CodexBridge ni de job Codex.
- Compiler et tester à priorité faible, sur les deux premiers CPU autorisés, avec au plus deux workers ; Playwright utilise un worker.
- Ne pas demander ou exposer de secrets. Préserver les comptes Google Calendar et YouTube distincts, leurs déconnexions indépendantes et les données hors ligne.
- Une mutation dont le résultat est incertain ne doit pas être répétée automatiquement.
- Les tests simulés ne prouvent ni une connexion fournisseur réelle, ni la capture matérielle d’un raccourci, ni la sortie audio d’un téléphone.

Une reprise automatique est programmée cette nuit autour de 03 h, Europe/Paris. Elle doit partir de ce point consolidé et des résultats CI réels, sans recommencer les suites vertes sans changement ni risque concret. Si une campagne travaille encore, conserver les contrôles en lecture seule et éviter un second chemin d’écriture.

## Corrections — PC stream / hôte OBS

| Domaine | Défaut établi et résultat de la correction |
| --- | --- |
| YouTube / comptes | Une ancienne réponse OAuth, un refresh ou une page de catalogue pouvait terminer après déconnexion ou remplacement du compte. La génération de session est contrôlée après chaque attente ; les écritures de secrets sont sérialisées ; une pagination reste liée à une seule identité. |
| OBS / tampon / clips | Une perte d’accusé ou un remplacement de connexion pouvait produire une fausse confirmation. Les résultats certains et incertains sont distincts ; une ancienne connexion ne confirme plus un tampon ou un fichier de clip ; aucune répétition automatique après résultat ambigu. |
| Twitch / informations v1 | La route historique pouvait dépendre des préconditions YouTube. Elle applique maintenant le contrat Twitch seul, conserve les champs facultatifs et accepte les mises à jour des tags seuls. |
| Twitch / refus de tags | Le repli sans tags n’est autorisé qu’après un HTTP 400 fournisseur explicitement relatif aux tags. Une panne réseau, un 5xx ou un autre 400 ne provoque plus de seconde écriture. |
| Streamlabs / sessions | Une restauration de démarrage ou un ancien OAuth pouvait réinstaller des identifiants après déconnexion. Une génération commune et une file d’écriture empêchent ces retours tardifs ; la connexion réseau ne bloque pas la déconnexion. Un callback invalide ne consomme plus une tentative valide. |
| Redémarrage / mise à jour | La garde lit des observations fraîches, toutes les sorties natives de service et toutes les sorties Aitum de diffusion, y compris non sélectionnées. Elle refuse les états inconnus, un enregistrement, une commande en attente et les changements de configuration, connexion ou révision pendant la lecture. |
| Commandes en file | Le suivi des commandes comprend leur présence en file et une révision d’activité. Une commande commencée puis terminée pendant la vérification invalide aussi la preuve de redémarrage. |

Les vérifications de sélection exacte Aitum, préparation/catalogue YouTube, état d’ingestion et transition fournisseur des corrections précédentes sont conservées dans les suites de régression. Une émission OBS n’est pas utilisée comme preuve suffisante d’un live YouTube.

Fichiers principaux : integrations/youtube/src/client.ts ; integrations/obs/src/client.ts ; integrations/twitch/src/client.ts et preflight.ts ; apps/server/src/live-control-routes.ts, twitch-metadata-route.ts, restart-safety.ts, command-service.ts et index.ts.

## Corrections — PC jeu / contrôleur

- Le chat Twitch dispose de sa propre lecture toutes les 2,5 secondes, indépendante d’une attente OBS. Les requêtes ne se superposent pas ; un état périmé ou une reconnexion sans lecture fraîche désactive l’envoi tout en conservant le brouillon. La destruction du composant arrête son timer.
- Un état OBS inconnu reste inconnu dans l’interface. Un lancement Twitch n’est plus proposé quand sa sortie émet déjà. La finalisation YouTube reste disponible lorsque l’ingestion fonctionne mais que YouTube doit encore passer en direct.
- Le changement de rôle et la mise à jour revérifient l’inactivité après les attentes asynchrones. Le changement de rôle publie son fichier atomiquement ; un refus conserve le rôle précédent. Fenêtre, frame principale et origine de l’appel sont contrôlées.
- L’import audio du contrôleur utilise son stockage device-runtime/soundboard.
- Les diagnostics, ports et fixtures Electron ont été remis en cohérence avec la véritable page /mobile/control/ et le port hôte 48133.

### Macros sans premier plan

La RC11.7 reprend les corrections RC11.6 : réception globale du raccourci et requête d’action dans le processus principal Electron, installation du contrôleur sur les deux rôles, conservation des associations confirmées pendant une panne transitoire, nouvelle tentative d’enregistrement d’un raccourci refusé toutes les cinq secondes et backgroundThrottling désactivé.

La revue n’a trouvé aucun nouvel appel show/focus/restore nécessaire à ce chemin. Les appuis pendant une commande en cours reçoivent un résultat explicite, sans attente différée ni replay. Les changements de régie/identité et les refus d’authentification suspendent toujours les associations. L’arrêt d’un live reste réservé au parcours explicite de confirmation dans le tableau de bord.

**Reste à démontrer sur les appareils : PC jeu minimisé → raccourci Synapse/Windows → réseau → PC stream minimisé → OBS réel.** Les tests actuels de contrôleur simulent Electron et le bridge. Le retour au premier plan observé par Damien ne doit pas être déclaré définitivement résolu avant cet essai.

### Visionneuse Twitch

Le chat authentifié et la session web du lecteur restent distincts. La fenêtre de connexion Twitch partage la session Electron locale du tableau de bord, sans injection du token API. Sa fermeture donne un résultat « fermé », jamais une preuve d’authentification.

La vidéo reste une iframe publique player.twitch.tv. La connexion réelle, sa persistance et sa reconnaissance dans le lecteur doivent être vérifiées sur chaque PC. **Aucune absence de publicité ni identité diffuseur du lecteur n’est garantie.** Aucun aperçu OBS local sans publicité n’a été ajouté dans ce parcours.

## Corrections — téléphone et espace autonome

| Domaine | Résultat |
| --- | --- |
| Deck / sons locaux | Import d’un fichier audio, stockage IndexedDB, lecture, volume persistant, temporisation et arrêt. Stop reste disponible pendant le chargement. Un changement d’espace annule la lecture et libère les Blob URL ; une réponse tardive ne relance pas le son. |
| Audio / sécurité de la page | media-src autorise self et blob dans les contextes desktop/serveur ; le shell de contrôle possède aussi sa CSP pour Android. Un test Chromium utilise réellement Audio.play() avec un WAV importé. |
| Streamlabs autonome | Lecture de l’historique cloud via le bridge natif, cache durable de 1000 éléments maximum, identité de cache opaque par compte, intervalle de 30 secondes et recul après HTTP 429. Les réponses d’un ancien compte sont écartées. |
| Événements Streamlabs | Le module partagé de normalisation/déduplication est inclus dans le bundle mobile. Les messages de contrôle tels que rollendcredits ne deviennent pas des follows ou événements d’activité. L’import ne déclenche aucune alerte. |
| Capacités natives | Android n’affiche pas de connexion Socket fictive. Sans bridge disponible, la configuration Streamlabs échoue explicitement et ne prétend pas avoir enregistré ou synchronisé l’historique. |
| WizeBot local | Le bouton utilise l’identité fraîche du compte de l’appareil. Son identifiant de commande est sauvegardé avant l’envoi ; reçu durable, absence de répétition après résultat incertain et protection contre changement de chaîne/compte. Le fallback desktop local suit les mêmes règles. |
| Secrets et comptes | Une écriture ou une suppression refusée conserve les identifiants précédents. Le cache JavaScript n’annonce pas une sauvegarde qui a échoué. Calendar et YouTube restent séparés. |
| Planning hors ligne | Dates de fin invalides refusées ; conservation des notes, tags et intentions lors des reprises et changements de contexte. |
| Hors ligne | Le service worker précache la chaîne complète de la véritable interface de contrôle, ses styles et le bundle partagé ; l’activation ne supprime pas les caches des autres applications. |
| Fichiers / liens Android | Sélection via ACTION_OPEN_DOCUMENT, refus des URI file/network et des fichiers privés du propre fournisseur ; navigation externe bornée aux domaines/parcours requis, sans credentials ni ports arbitraires. |

Limites : aucun essai physique sur le téléphone, aucune authentification réelle ni autorisation Android confirmée cette nuit. Le test de vrai son utilise Chromium ; il ne prouve pas le haut-parleur ou le focus audio du téléphone.

## Planning et durabilité

Deux problèmes fonctionnels ont été corrigés :

1. Une modification des notes ou de l’affichage journée entière entraînait des updates logiques inutiles du planning Twitch. La comparaison porte maintenant sur les champs réellement publiés, avec migration du format précédent. Les lectures fraîches de conflit restent conservées.
2. Une création Twitch dont la réponse était perdue pouvait bloquer toute la synchronisation. L’objet conserve désormais son intention incertaine et son diagnostic, sans adoption fondée seulement sur le contenu, sans nouveau CREATE et sans import du candidat en doublon. Les objets indépendants continuent à se synchroniser.

La route HTTP /twitch/sync dispose maintenant du callback de sauvegarde nécessaire avant CREATE. Le test d’une écriture disque refusée prouve qu’aucun POST Helix n’est émis et que le planning précédent reste sur disque.

Le cycle quotidien mesuré conserve 7 CREATE, 7 DELETE et 0 PATCH, avec 22 GET schedule au lieu de 29 et 42 écritures durables au lieu de 48. Le budget initial de 36 incluait tous les magasins : six écritures supplémentaires légitimes correspondent à autonomy-v1.json et streamlabs-events.json, une chacune aux trois démarrages. Les tests bornent exactement ces six initialisations et conservent le budget de 36 pour le reste. Aucun journal nécessaire à la durabilité n’a été retiré.

Les attentes de tests incompatibles avec le nouveau contrat ont été corrigées sans réduire la preuve métier : comparaison des données définies après sérialisation JSON, événement incertain conservé, pas de doublon et zéro nouvelle écriture distante après retry/redémarrage. L’ancien rejet global n’est plus attendu.

## Qualification exécutée

| Contrôle | Résultat et preuve |
| --- | --- |
| TypeScript / bundle livré | Build réussi ; paquet Windows recompilé après les derniers changements. |
| Vitest complet | 1401/1401 tests réussis, zéro en attente. /tmp/sd-night-final-vitest-02.json |
| Node complet | 229/229 tests réussis. /tmp/sd-night-final-node.log |
| CI Android additionnelle | 7/7 tests Node exécutant les vrais blocs shell avec outils APK/clés simulés ; les quatre tests Vitest de bootstrap signature ont aussi été rejoués et passent. |
| Navigateur | 70/70 scénarios réussis, zéro ignoré et zéro flaky. /tmp/sd-night-final-browser.json |
| Sécurité statique | security:check réussi. |
| JavaScript livré | check:shipped-js réussi. |
| Flux distant/mobile | mobile:smoke réussi. |
| Dépendances npm | Zéro alerte, toutes sévérités, sur runtime et outillage après correction. /tmp/sd-night-final-audit-prod.log et audit-dev.log |
| Android | lintDebug réussi ; 38/38 tests JUnit, zéro échec/erreur/ignoré ; assembleDebug et assemblePreview réussis. |
| Windows portable | Version, IDs publics, ports par rôle, fichiers livrés, absence de données utilisateur et concordance intégrité PE/ASAR vérifiés par le vrai checker. ZIP vérifié par CRC et comparaison de l’EXE/ASAR. |
| APK | Signature vérifiée ; même certificat que la RC11.5 locale ; package/version/code vérifiés ; 71 assets embarqués comparés aux fichiers de référence ; CRC vérifié. |
| Electron Windows / PowerShell | Qualification sur runner Windows à obtenir via le workflow de la PR ; ne pas la confondre avec un essai sur FIXE/Laptop. Le serveur n’a ni Electron Linux exécutable ni affichage. |

Le contrôle Node additionnel utilise de faux APK/outils/certificats pour vérifier les refus ; la signature de l’APK local a été contrôlée séparément avec apksigner.

Les fixtures Electron conservent la persistance, la bonne version, vingt demandes de seconde instance et vingt cycles de lancement/fermeture avec contrôle de libération du port 48133. Le harnais PowerShell comporte 60 cas et extrait uniquement huit gardes par AST, sans exécuter le corps d’installation ni fermer de processus.

## Sécurité de l’outillage et CI Android

npm audit a signalé Vite 8.3.0 dans la chaîne de développement, avec les avis GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw et GHSA-587h-7wmj-h5pm. Vite est maintenant verrouillé en 8.3.4, compatible avec la contrainte de Vitest. La mise à jour porte sur 20 entrées de développement de sa fermeture de dépendances ; les dépendances déclarées et celles du runtime sont inchangées. Installation avec scripts désactivés, puis suites complètes et nouveaux audits à zéro.

La CI Android utilisait encore l’ancien package sans .next et une version 0.9/code 900000 + run. Elle lit maintenant l’identité et la version des sources, vérifiées contre package.json. Les PR qualifient debug/preview sans secrets et publient des artefacts explicitement QA. La release manuelle conserve les secrets de signature obligatoires, la vérification d’un certificat unique et de son SHA-256, ainsi que package/version avant upload. Le keystore décodé est supprimé ensuite.

Seule l’obligation d’un GOOGLE_ANDROID_CLIENT_ID embarqué inutilisé a été retirée : le flux Google natif existant utilise AuthorizationClient et l’identité package/certificat. L’identifiant Twitch effectif reste exigé. Aucun repli de signature release vers un certificat temporaire n’a été ajouté.

## Paquets RC11.7 vérifiés

### Windows x64

Chemin : /home/damien/StreamDashboard-Next-desktop-live/out/StreamDashboard-Next-2.0.0-rc.11.7-windows-x64.zip  
Taille : 152983971 octets ; 78 fichiers.  
Disposition conservée : StreamDashboard-Next-2.0.0-rc.11.7-windows-x64/out/StreamDashboard-win32-x64.  
Lanceurs conservés : Lancer_StreamDashboard_Regie.cmd avec --role=host et Lancer_StreamDashboard_PC_Jeu.cmd avec --role=client.

- ZIP SHA-256 : 170b7b4958e5dc46f0e8956aa5cf3fdc380f29b7b1b70fbea1a068eb4fa683c4
- EXE SHA-256 : 7c6ea3d488c978b744ab4f4c637acf7a30ffdae8c250f11819b0c18e4026fb17
- ASAR SHA-256 : 9ad3473fdc763313afcd8a1d497a78005548f79e8850576a60d9842ad150ff6a
- Métadonnées : out/rc117-package-meta.json.

### Android

Chemin : /home/damien/StreamDashboard-Next-desktop-live/out/StreamDashboard-Next-2.0.0-rc.11.7.apk  
Taille : 3622347 octets.  
Package : com.rastaaslan.streamdashboard.remote.next.  
Version : 2.0.0-rc.11.7 ; code : 2000020.  
APK de la chaîne debug locale existante, avec identité de signature conservée ; ne pas le présenter comme une release officielle signée par la CI.

- APK SHA-256 : f22a040904fc37140d1eae5594d0ea5574f2044f6df4e628ff16e3c32d8d19cf
- Certificat SHA-256 : c09e61d51adcc0e06398e5f23bc4a88aa3afb68493dea1564f0b248fcb3403b0
- Métadonnées : out/rc117-apk-meta.json.
- Preview construit et vérifié séparément : com.rastaaslan.streamdashboard.remote.next.preview, version suffixée -preview.

## Installation et contrôles réels restants

| Appareil | Accès et rôle |
| --- | --- |
| dam-server | RDC ee881f3f-7909-4993-a915-04a1d994f366 ; build uniquement |
| FIXE | RDC b5db7551-143d-410a-8b84-157070125122 ; hôte OBS ; Tailscale 100.126.186.44 ; API 48133 |
| Laptop-damien | RDC b9d58a49-3cc5-454f-9a64-db0e0b22db48 ; contrôleur/macros ; Tailscale 100.120.68.119 ; API locale 48135 |

Runtime actif attendu sur les deux PC : C:\Users\damie\StreamDashboard-RC10\out\StreamDashboard-win32-x64\StreamDashboard.exe.  
Profil à conserver : C:\Users\damie\AppData\Roaming\StreamDashboard-Next.

1. Relire les versions réellement actives, puis vérifier les SHA-256 du ZIP transféré et de l’EXE/ASAR extrait. Ne pas supposer qu’une version préparée est installée.
2. Exécuter scripts/qa-rc117-idle-guard.ps1 sous Windows PowerShell 5.1 avant l’installateur.
3. Utiliser scripts/install-rc117-damien.ps1 avec le rôle correct et les hashes ci-dessus. Il part seulement de la RC11.4 observée, conserve une sauvegarde du profil et les anciens binaires, ferme normalement StreamDashboard et ne tue jamais OBS.
4. Sur l’hôte, la preuve lit V1 pour recording — absent de la projection V2 en RC11.4 — ainsi que V2, toutes les sorties natives et Aitum, puis relit les états. Un inventaire natif vide est ambigu et bloque. Les PID OBS doivent rester identiques.
5. Pour le client, fournir une preuve hôte réellement collectée et âgée de moins de 30 secondes. Le timestamp seul n’est pas une preuve : ne jamais le fabriquer pour passer le garde. Renouveler l’observation après installation de l’hôte si nécessaire.
6. Après bascule, confirmer version/health, rôle, persistance du profil, connexion de régie et PID OBS inchangé. Si une nouvelle activité apparaît, arrêter la bascule ; le rollback ne force aucune fermeture et ne réécrit que les binaires.
7. Vérifier ensuite les macros avec les deux fenêtres minimisées, sans modifier scène/micro ni lancer de live pour le test. Un clip peut servir seulement si le tampon est déjà actif ; sinon utiliser un environnement isolé.
8. Sur chaque PC, terminer et observer réellement la connexion web de la visionneuse Twitch ; conserver la distinction entre chat authentifié et lecteur public.
9. Un vrai essai YouTube/OBS/Aitum et un essai physique Android restent à programmer avec Damien dans un contexte approprié. Ne pas lancer une diffusion publique pour compléter cet audit.

Les gardes d’installation de RC11.4 sont des observations successives, pas une transaction atomique avec OBS. Si une donnée requise manque, si les machines restent hors ligne ou si le contrôle est incertain, conserver les paquets et signaler l’installation en attente.

## Journaux de campagne

- Résultats de référence : /tmp/sd-night-baseline-results.json et /tmp/sd-night-baseline-*.
- Résultats consolidés : /tmp/sd-night-final-results.json ; première passe Vitest à 1400/1401 conservée pour traçabilité ; passe corrigée à 1401/1401 dans /tmp/sd-night-final-vitest-02.json.
- Build et vérification des paquets : /tmp/sd-night-package-results.json et /tmp/sd-night-package-*.log.
- Traces de persistance : /tmp/sd-night-final-planning.log et /tmp/sd-night-planning-phases.log.
- Documents précédents : docs/qa/2026-10-20-rc11.5-stream-audit.md et docs/qa/2026-10-20-rc11.6-background-macros.md.

## Reprise sur appareils — 21 octobre 2026 (déploiement RC11.7)

Deux appareils Windows accessibles par Remote Desktop Commander ont été qualifiés et mis à jour depuis les paquets déjà consolidés au commit `4c80ba3` ; aucune correction de code supplémentaire n'était nécessaire pour ce déploiement.

- **FIXE / hôte OBS** : RC11.4 initialement active et API `ready`. OBS PID 4748. Avant bascule, lectures V1/V2 et inventaire natif + Aitum confirment OBS connecté, streaming et recording désactivés, sorties Twitch/YouTube inactives, aucun live fournisseur, zéro commande en cours, trois sorties OBS natives dont zéro sortie service active et une sortie Aitum stream inactive. Garde Windows PowerShell 5.1 : 60/60. ZIP SHA-256 vérifié `170b7b4958e5dc46f0e8956aa5cf3fdc380f29b7b1b70fbea1a068eb4fa683c4`. Installateur `success:true`, phase `READY`, sauvegarde de profil vérifiée (11 fichiers critiques), ancien runtime conservé, rollback non nécessaire. API après déploiement : `2.0.0-rc.11.7`, `ready`, config revision 24, 16 actions. OBS PID 4748 inchangé.
- **Laptop-damien / client macros** : Garde Windows PowerShell 5.1 : 60/60 ; ZIP avec la même empreinte vérifiée et extrait. Première tentative d'installation refusée proprement avant toute bascule (`CURRENT_RC114_HEALTH_REQUIRED`) car le client n'était pas démarré. Démarrage normal de RC11.4, API 48135 `ready`, puis nouvelle preuve réelle de l'inactivité du FIXE, collectée à `2026-10-21T03:09:56Z` et consommée dans les trente secondes. Deuxième installation `success:true`, phase `READY`, sauvegarde de profil vérifiée (9 fichiers critiques), ancien runtime conservé, rollback non nécessaire. API après déploiement : `2.0.0-rc.11.7`, `ready`, 10 actions ; aucun processus OBS sur le laptop.
- **Android** : APK RC11.7 prêt mais aucune installation physique constatée ; ne pas déclarer le téléphone mis à jour.
- **Limites** : aucune diffusion, envoi de chat, modification de scène ou micro, arrêt OBS, ni authentification fournisseur réalisés. Le test de raccourcis Synapse depuis une fenêtre minimisée jusqu'à OBS réel, l'identité web de la visionneuse Twitch, l'état fournisseur YouTube en vrai live, l'historique cloud Streamlabs et l'audio/Deck sur un téléphone réel restent à vérifier. Les réponses API et tests de garde ne prouvent pas ces parcours de bout en bout.
- **Intégrité** : développement sur dam-server uniquement ; aucun usage de dam-server comme hub. Les scripts de transfert Windows ne contiennent pas de secrets ; transfert temporaire du paquet via Tailscale. Les anciennes versions et profils sont conservés localement pour diagnostic/rollback.
