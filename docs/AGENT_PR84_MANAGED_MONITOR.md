# Agent PR84 : monitor supervisé et endpoint health optionnel

Base publique vérifiée : 12e985a8e1241f8407b061f4a10ebeb7dbdd4e79,
branche feat/sd00-agent-protocol-v2. Candidate locale :
agent/pr84-runtime-port-20261028. Le port extrait uniquement les sources Agent,
les ressources de son lanceur, leurs tests et notes. Aucun historique alpha27,
UI Controller/mobile, JAR ou changement de version du projet n'est fusionné.
Le contrat V2 et le cache health existaient déjà, identiques : ils restent inchangés.

## Comportement et périmètre

Le mode --monitor de windows-readonly-service utilise le runtime Node existant
avec reconnexion bornée, annulation des attentes et invalidation immédiate du cache
en cas de déconnexion/timeout. Les révisions avancent pendant la vie du processus.
Les seules méthodes RPC OBS du paquet portable sont GetStats et GetStreamStatus.
Un retour tardif d'une connexion ou lecture abandonnée ne devient pas un succès.

Start-Agent-ReadOnly.ps1 reste un lanceur au premier plan. Il prend un verrou
FileShare.None pour éviter deux lanceurs Monitor dans le même dossier et autorise
trois redémarrages du fils après erreur, délai plafonné à cinq secondes.
-RestartLimit accepte 0 à 5. Une sortie normale n'est pas relancée. Ctrl+C arrête
la surveillance. Aucun service SCM, tâche planifiée, registre ou pare-feu modifié.

L'endpoint HTTPS optionnel partage le même cache. TLS 1.3, possession de la clé
client et empreinte exacte du certificat sont exigés. GET /v2/obs/health seulement :
200 si observation fraîche, 503 sinon, POST 405, autre route 404. Le listener reste
disponible pendant une panne OBS. L'arrêt ferme aussi les handshakes incomplets.

Ce port ne démarre aucun poller ou panneau Controller. Le client programmatique
readPinnedAgentHealth déjà présent dans PR84 peut lire cet endpoint ; son appelant
doit gérer son propre cycle de vie. Les options SD_CONTROLLER_AGENT_* et l'IPC/UI
de la candidate alpha27 ne sont pas portés et ne s'activent pas via ce commit.

## Construire et installer manuellement dans un dossier QA séparé

Avec les dépendances du dépôt disponibles et Node >=22.12 :

    node scripts/build-agent-readonly-qa.mjs

Le builder produit exactement ces fichiers dans dist/agent-readonly-qa :

- StreamAgent-ReadOnly.mjs ;
- Start-Agent-ReadOnly.ps1 ;
- LISEZ-MOI-Agent-ReadOnly-QA.txt ;
- MANIFEST-QA.json, contenant taille/SHA-256 des trois fichiers exécutés/lus.

Conserver le dossier RC2 antérieur. Copier ces quatre nouveaux fichiers ensemble
dans un nouveau dossier QA sur le PC Windows souhaité, sans remplacer l'application
Dashboard ou un paquet déjà utilisé. Vérifier les SHA du manifeste avant de lancer.
Sous le compte Windows habituel, avec Node disponible et OBS WebSocket déjà
configuré/authentifié, démarrer manuellement depuis ce nouveau dossier :

    .\Start-Agent-ReadOnly.ps1 -Monitor -DeviceId FIXE_QA -RestartLimit 3

Cette instruction d'installation n'a pas été exécutée sur un PC utilisateur.

## Options du listener — uniquement avec Monitor

Sans les quatre variables ci-dessous, aucun listener Agent n'est ouvert.

| Variable | Valeur requise |
|---|---|
| SD_AGENT_MTLS_OPT_IN | I_ACCEPT_PRIVATE_MTLS_READ_ONLY |
| SD_AGENT_MTLS_HOST | IPv4 réellement affectée à ce PC, privée/Tailscale ou 127.0.0.1 |
| SD_AGENT_MTLS_PORT | Port libre entier 1024–65535 |
| SD_AGENT_MTLS_DPAPI_DIR | Dossier absolu local du coffre TLS CurrentUser déjà provisionné |

Le coffre doit fournir tls_key et tls_certificate en PEM, ainsi que
authorized_controller_fingerprint : SHA-256 du certificat DER exact du client.
Aucune clé/certificat réel n'est fourni, généré, copié ou installé par ce port.
Ni wildcard, DNS, IP publique, interface d'un autre PC, chemin relatif ou UNC.
Une configuration demandée mais incomplète échoue ; aucun listener de secours.

Le mode once refuse ces options réseau. Le coffre TLS ne change pas le choix
du mot de passe OBS. Le comportement RC2 est conservé : sans
SD_AGENT_DPAPI_DIR / SD_AGENT_DPAPI_OPT_IN, la configuration OBS locale existante
fournit son mot de passe uniquement en mémoire. Avec ces deux options exactes,
seul obs_password préprovisionné est accepté ; absence/corruption refuse sans
fallback au mot de passe JSON. Aucune migration ou copie automatique de secret.
Les buffers natifs sont nettoyés au teardown/échec ; les copies JS/TLS internes
n'offrent pas de garantie d'effacement physique complet de la mémoire.

## Migration et rollback

Il n'existe pas de migration de données Dashboard, profil OBS, port actif ou
coffre. Pour une migration QA ultérieure : arrêter seulement l'ancien lanceur QA,
conserver son dossier et ses variables, utiliser le nouveau dossier et activer
séparément le listener si les identités existent déjà. Ne jamais lancer deux
instances QA contre un service existant sans vérifier leurs interfaces/ports.

Rollback : Ctrl+C sur ce lanceur QA ; retirer uniquement les SD_AGENT_MTLS_*
ajoutées dans cette session ; reprendre le dossier RC2 conservé avec ses choix
DPAPI précédents. Garder les coffres existants. Aucun service à désinstaller.
Rollback source : revert du seul commit de ce port après revue d'intégration.

## Simulation d'écriture distincte

SimulatedObsWriter et son transport ne sont importés par aucun runtime portable
ou route HTTP. Ils acceptent seulement un faux pair attesté sur loopback avec
optIn=I_ACCEPT_FAKE_OBS_WRITER_ONLY ; Start/Stop factices uniquement. Autorité,
permissions, révisions, reçus durables et résultat uncertain sont testés avec le
vrai protocole WebSocket 5. Voir AGENT_V2_SIMULATED_WRITER.md, notamment la priorité
Stop limitée à la file et l'absence de retry/réconciliation automatique.

## Qualification de cette candidate

Les résultats exacts du port et SHA du builder sont inscrits dans le manifeste
AGENT_PR84_MONITOR_QUALIFICATION_20261029.json. Les logs conservent aussi les échecs
éventuels avant correction. Seuls tests Agent, types, sécurité et build portable
sont exécutés ; aucune suite Dashboard complète, Gradle ou reconstruction RC3.

Le lanceur est identique aux octets précédemment acceptés par le parseur natif
Windows PowerShell 5.1 ; l'exécution du superviseur sur Windows reste NOT_RUN.
OBS réel, liaison entre deux PC, appareil Android, installation SCM et coupure
électrique Windows : NOT_RUN. Le journal conserve sa limite connue sur la
durabilité des métadonnées rename Windows. Cette candidate Agent ne certifie
ni une UI Controller raccordée, ni un Dashboard NEXT complet ou une release
de production. Aucun déploiement ni push n'a été effectué par cette préparation.
