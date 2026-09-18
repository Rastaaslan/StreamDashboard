# Live safety

## Règle

Une perte de télémétrie ne doit jamais devenir une perte de contrôle. Les commandes critiques utilisent HTTP; WebSocket ne transporte que l'état temps réel.

## Canaux

- **Commande HTTP**: autorisée si le credential existe, indépendamment du WebSocket.
- **Temps réel**: peut être `connecté` ou `en reconnexion` sans invalider le dernier état connu.
- **Disponibilité PC**: devient hors ligne seulement après échec du probe REST, jamais sur le seul événement `ws.close`.

## Concurrence

Les commandes sont verrouillées par ressource. Une opération `stream` lente ne bloque ni `scene`, ni `audio:<input>`, ni `timer`. Le verrou est toujours libéré après succès, erreur ou timeout.

## Start/Stop

- timeout critique: 30 secondes;
- après erreur/timeout: lecture de `/api/v1/state`;
- succès annoncé seulement si la postcondition OBS attendue est observée;
- Start conserve la préparation puis le bypass explicite de checklist;
- Stop reste soumis à confirmation.

## Validation requise avant GO

Ce document ne certifie pas le produit **live-safe**. Un opérateur doit encore valider sur matériel réel Android + PC + OBS:

1. couper le WebSocket en conservant REST et exécuter Start, Pause, Scène et Micro;
2. provoquer un timeout Start puis vérifier la réconciliation;
3. flapper le réseau durant 100 commandes et vérifier zéro bouton bloqué;
4. confirmer une seule requête par tap;
5. vérifier Start et Stop une seule fois avec confirmation OBS réelle;
6. valider APK signée et package Windows signé correspondant au même SHA.
