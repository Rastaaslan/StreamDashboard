# Exécution OBS V2 isolée — faux pair uniquement

Port Agent seul sur la base publique PR84 12e985a8e1241f8407b061f4a10ebeb7dbdd4e79,
branche locale agent/pr84-runtime-port-20261028. Les changements sont extraits
de la candidate b7665eec5290825ae14b608ec7e602ab8d1fe590 ; aucun historique alpha27,
Controller ou mobile n'est fusionné. Les binaires RC3 antérieurs restent séparés.

Le module raccorde le protocole AgentCommand, AgentCommandGuard,
AgentCommandReservation et DurableReceiptJournal à un faux OBS parlant réellement
le protocole WebSocket OBS 5. Il couvre seulement obs.stream.start et
obs.stream.stop. Aucun import n'est ajouté au service Windows, au Controller,
au renderer ou à une route HTTP d'écriture.

## Interlocks et API

SimulatedObsWriter.open(options) exige :

- optIn : I_ACCEPT_FAKE_OBS_WRITER_ONLY ;
- URL ws://127.0.0.1:PORT/sd-fake-obs/TOKEN, port explicite hors 4455,
  aucun DNS, login, query, IP LAN/publique ou découverte automatique ;
- TOKEN factice de 64 caractères hexadécimaux ;
- Hello du pair avec obsWebSocketVersion=SD_FAKE_OBS_SIMULATION_V1,
  puis GetVersion renvoyant exactement simulationToken=TOKEN ;
- journalFile absolu sous un sous-dossier canonique de os.tmpdir(), sans
  symlink de fichier, nom limité à un identifiant .json ;
- localDeviceId, controllerDeviceId et grants explicites.

Le jeton est un interlock de laboratoire. Il ne remplace pas une authentification
de production. Un OBS ordinaire ne possède pas l'attestation requise et ne peut
recevoir aucune mutation via ce module.

| Méthode | Effet |
|---|---|
| observation() | Copie de l'état observé ; null si fermé, périmé ou incertain |
| refresh() | Lecture explicite, nouvelle révision ; refus si commande en cours |
| submit(command, authenticatedDeviceId, confirmedCriticalAction) | File bornée de 16 commandes, reçu V2 |
| receipt(commandId) | Dernier reçu durable connu pour cette commande |
| close() | Annule l'attente, ferme le socket, libère uniquement son verrou |

L'identité authentifiée est fournie par le processus de test de confiance.
Il n'existe aucune route réseau V2 d'écriture ni liaison à une identité réelle.
L'autorité prend un verrou exclusif local par localDeviceId, y compris si un
second appel propose un autre journal. Un verrou laissé après crash n'est pas
repris automatiquement. Le compteur d'autorité sous os.tmpdir(), indexé par
localDeviceId, réserve durablement un bloc de révisions distinct à chaque ouverture,
y compris si le journal change. Il reste conservé à close() ; aucune remise à zéro
automatique. Une ancienne commande non exécutée ne retrouve donc pas sa révision
à la réouverture. Le banc utilise un identifiant aléatoire et nettoie seulement son
propre compteur après ses scénarios. Une purge externe du stockage temporaire ou
une panne électrique Windows reste hors qualification.

## Garanties exercées en simulation

Identité, destination, permission, protocole, date, confirmation critique, payload
vide et révision sont contrôlés avant effet. Le module copie l'enveloppe et les
grants pour empêcher leur modification pendant l'attente. Il relit le statut
avant réservation ; un changement externe expose une nouvelle révision et refuse
la commande qui ne vise plus cet état.

Une réservation uncertain/PRE_EXECUTION_RESERVED est fsync avant l'appel factice.
Un succès RPC seul ne suffit pas : GetStreamStatus doit ensuite observer l'état
demandé, puis confirmReservation() doit persister le reçu confirmed. Cette méthode
du journal ne finalise qu'une réservation existante ; record() refuse toujours
les doublons. La finalisation préserve les autres commandes et refuse un horodatage
antérieur à la réservation.

Timeout, arrêt pendant l'appel, état divergent ou échec du stockage de confirmation
laissent la réservation uncertain. Une réponse ou un effet tardif ne change pas
ce reçu. Le writer se bloque ; sa réouverture avec le même journal exige une
réconciliation explicite. Aucun retry ou effacement de journal automatique.

Un Stop autorisé supprime les Starts encore en file et bloque de nouveaux Starts
pendant son attente. Il ne peut pas retirer une commande déjà envoyée au pair :
il attend son résultat borné et reste soumis aux préconditions. Après un résultat
uncertain, même le Stop en file est refusé. Cette priorité de file ne promet donc
ni interruption d'une opération déjà émise, ni arrêt d'urgence d'un OBS réel.

## Vérification reproductible et limites

Les tests agent-v2-simulated-obs-execution.test.ts créent un WebSocketServer sur
127.0.0.1 avec port éphémère, un jeton factice et un dossier temporaire unique.
Ils vérifient les refus, l'autorité unique, la réservation durable avant effet,
la confirmation observée, le rejeu après réouverture, la priorité Stop, les
mutations du caller, le statut invalide/périmé, la perte de réponse, un effet tardif,
l'échec de confirmation durable et l'arrêt pendant l'appel. Aucun client OBS réel
ou credential utilisateur n'entre dans ce banc.

Commande ciblée :

    nice -n 19 node node_modules/vitest/vitest.mjs run tests/agent-v2-simulated-obs-execution.test.ts tests/agent-v2-durable-receipts.test.ts tests/agent-v2-reservation.test.ts tests/agent-v2-command-guard.test.ts --maxWorkers=1

La toute première exécution du nouveau banc a refusé dix connexions :
l'import OBS par défaut négociait msgpack alors que le faux pair parle JSON.
Le transport isolé utilise maintenant l'export JSON existant. Le log rouge est
conservé ; aucune modification de l'adaptateur OBS Windows n'a été nécessaire.

Les résultats du port public figurent dans AGENT_PR84_MANAGED_MONITOR.md.
Le banc comprend 14 scénarios WebSocket faux OBS et 7 scénarios du journal.
Aucune suite Dashboard complète ou compilation Windows/Android n'est requise
pour ce simulateur sans import de production.

Limites : Windows writer/journal et coupure électrique NOT_RUN, OBS réel NOT_RUN,
deux PC NOT_RUN, appareil Android NOT_RUN. Le journal garde la limite existante
sur la durabilité des métadonnées rename sous Windows. Aucun chemin de production,
provisioning, signature, déploiement ou service SCM n'est autorisé par ce module.
Ce lot ne constitue pas une release NEXT complète.

Intégration : relire ce commit séparé puis cherry-pick sous l'autorité du root.
Rollback : revert du seul commit dans la branche PR84 isolée. Les kits RC2/RC3,
applications et coffres existants restent intacts.
