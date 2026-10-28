# Liaison permanente Controller / Agent Node — candidate d'intégration

Base : 4f2460b. Branche : agent/next-runtime-completion-20261028.
Cette candidate ajoute l'observation permanente au runtime existant. Les commandes
OBS du canal V2 restent absentes : seules GetStats et GetStreamStatus existent sur
l'adaptateur Agent. Aucun service Windows, secret ou réseau actif n'est installé.

## Comportement raccordé

Le monitor Windows ouvre OBS local, publie des observations fraîches et reconnecte
après une déconnexion ou un délai de lecture dépassé. Ses révisions progressent
à travers les reconnexions. Toute panne invalide immédiatement la dernière santé.
Un retour tardif d'une connexion/lecture abandonnée ne peut pas publier un succès.

Une option explicite expose la même observation par HTTPS TLS 1.3, avec certificat
client épinglé. Le listener est limité à une adresse IPv4 locale privée/Tailscale
ou loopback ; aucun wildcard, DNS ou IP publique. Il reste vivant pendant une panne
OBS et répond alors 503. Arrêt : signal, annulation des lectures et fermeture des
connexions, y compris un handshake incomplet.

Le main Electron utilise le client mTLS existant dans une boucle permanente,
recharge les identités protégées après échec et conserve les clés hors renderer.
Le panneau Live lit un état par IPC natif autorisé. L'affichage expire même si une
lecture IPC reste suspendue. Fermer un panneau ne coupe pas le poller natif.

Le lanceur PowerShell existant supervise le processus : arrêt normal sans relance,
trois redémarrages maximum sur sortie en erreur par défaut, délai croissant plafonné
à 5 s et verrou Windows FileShare.None entre deux lanceurs Monitor. Ctrl+C termine
le monitor. Il ne s'agit pas d'une installation SCM ou d'un démarrage automatique.

## Options d'activation — Agent

Le lanceur fournit déjà l'opt-in de lecture OBS. Sans les options suivantes aucun
port Agent n'est ouvert. Elles s'utilisent uniquement avec -Monitor.

| Variable | Valeur |
|---|---|
| SD_AGENT_MTLS_OPT_IN | I_ACCEPT_PRIVATE_MTLS_READ_ONLY |
| SD_AGENT_MTLS_HOST | Adresse IPv4 réellement affectée à ce PC |
| SD_AGENT_MTLS_PORT | Port privé libre, entier 1024–65535 |
| SD_AGENT_MTLS_DPAPI_DIR | Dossier absolu du coffre TLS sous le compte Windows courant |

Le coffre TLS est distinct du choix de mot de passe OBS. Ces quatre variables
ne déclenchent aucune copie ou migration du mot de passe OBS. Le comportement
historique lit toujours la configuration OBS locale en mémoire, sauf activation
séparée des options SD_AGENT_DPAPI_DIR / SD_AGENT_DPAPI_OPT_IN du RC2.

## Options d'activation — Controller

| Variable | Valeur |
|---|---|
| SD_CONTROLLER_AGENT_OPT_IN | I_ACCEPT_PRIVATE_MTLS_READ_ONLY |
| SD_CONTROLLER_AGENT_URL | https://IP-privee:port/v2/obs/health |
| SD_CONTROLLER_AGENT_DEVICE_ID | Identifiant exact de l'Agent (-DeviceId) |
| SD_CONTROLLER_AGENT_DPAPI_DIR | Coffre local du Controller, même compte/profil Windows |

Configuration incomplète, mauvais pin, certificat expiré, clé absente ou observation
périmée donnent indisponible, sans autorisation de secours ni trust automatique.

## Identités préprovisionnées

Cette passe ne génère/provisionne aucun secret réel. L'API WindowsAgentSecretStore
existante conserve les valeurs sous DPAPI CurrentUser. Les buffers sont UTF-8 ; les
certificats/clés sont PEM et les empreintes SHA-256 portent sur le certificat DER.
Les clés privées restent sur leur PC respectif ; seules identités publiques et
empreintes peuvent être échangées hors bande.

| Coffre | IDs nécessaires |
|---|---|
| Agent TLS | tls_key, tls_certificate, authorized_controller_fingerprint |
| Controller TLS | tls_key, tls_certificate, peer_server_certificate, peer_server_fingerprint |

Le certificat serveur doit convenir à serverAuth ; celui du Controller à clientAuth.
Changer les identités nécessite une mise à jour explicite des pins protégés.
Les buffers du coffre sont effacés à l'arrêt/échec ; les copies internes TLS/JS ne
constituent pas une garantie d'effacement physique complet de la mémoire.

## Vérifications réellement exécutées

- 148 tests ciblés PASS, 2 LAB opt-in SKIP : Agent, Controller, desktop lifecycle/
  sécurité/recovery et invariants mobile/micro.
- Après séparation du coffre TLS et du choix de secret OBS : Agent 60 PASS,
  2 LAB SKIP ; TypeScript noEmit PASS.
- UI status : 2 tests Node PASS, fraîcheur, lecture unique et retour tardif après fermeture.
- Intégration TLS réelle sur loopback éphémère, faux OBS : observation → panne
  et 503 → reconnexion → nouvelle révision ; arrêt des sockets vérifié.
- Script PowerShell : AST natif Windows PowerShell 5.1.26100.9711 PASS,
  sans exécuter le lanceur, Agent, OBS ou un accès matériel.
- Assets publics et bundle Agent : compilation PASS. Sécurité sources PASS.
- Réservation d'écriture existante reliée uniquement à un faux compteur OBS :
  identité, grant, révision et confirmation refusés avant effet ; reçu durable
  uncertain avant l'effet factice, puis rejeu bloqué après réouverture du journal.
  Aucun reçu de succès durable ni exécuteur réel V2 n'est annoncé.

Un premier test du simulateur attendait le mauvais libellé CAPABILITY_DENIED ;
le contrat existant retourne NOT_AUTHORIZED. Seule l'attente du nouveau test a été
corrigée. Les premières erreurs de typage des APIs natives sont conservées en logs,
puis corrigées sans affaiblir les contrôles.

## Mobile déjà présent

Les volets Live/Planning/Deck, suivi du doigt, retour court et réduction des
animations existent dans mobile-panes.js. Chat, Spotify, micro et soundboard sont
déjà raccordés au cockpit alpha27. Le bouton Live spontané et sa confirmation
existent dans control.js. La fausse alerte silence reste supprimée ; alertes
DJI 6/7 et 7/7 et absence de pourcentage inventé sont couvertes par les tests ciblés.
Aucune réécriture mobile facultative n'a été entreprise.

## Intégration et suite

Relire le commit de la branche, puis le cherry-pick dans la branche alpha27 sous
l'autorité d'intégration. Après disponibilité des ressources Director : npm test,
build complet, contrôles des assets/package Windows et reconstruction Android.
Le kit RC2 antérieur reste inchangé dans l'autre worktree.

Restent à qualifier : Electron visuel sur Windows, lanceur/restart natif avec
processus factice puis environnement OBS sûr, deux PC et identité réelle, Android
physique, signature/migration/rollback utilisateur. La supervision Windows n'est
pas homologuée physiquement par un simple AST. Aucun package NEXT complet ou
service de production n'est déclaré terminé.

Rollback du code : revert du commit d'intégration dans la branche isolée. En QA
exécutée ultérieurement : arrêter uniquement ce lanceur par Ctrl+C, retirer ses
variables SD_AGENT_MTLS_* / SD_CONTROLLER_AGENT_* et revenir au kit antérieur.
Ne supprimer aucun coffre existant et ne remplacer aucune application active.
