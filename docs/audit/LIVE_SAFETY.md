# Live Safety

## Invariants logiciels

1. Le WebSocket transporte la télémétrie ; il ne conditionne jamais une commande HTTP.
2. Une fermeture WebSocket conserve le dernier état connu et déclenche un probe REST avant de déclarer le PC indisponible.
3. Chaque commande possède un `commandId`, une ressource verrouillée localement et, pour Start/Stop, une postcondition réconciliée après timeout.
4. Start appartient à un seul handler : préparation, tentative normale, puis bypass checklist uniquement après confirmation explicite.
5. Un snapshot de révision inférieure à la dernière révision appliquée est ignoré.

## Smoke matériel obligatoire avant usage live

- couper/reprendre le Wi‑Fi pendant un live test et confirmer Pause/Scène/Micro via REST ;
- provoquer une coupure WebSocket seule et vérifier que les commandes restent actives ;
- démarrer/arrêter OBS avec confirmation réelle et vérifier une seule requête StartStream/StopStream ;
- provoquer un timeout côté téléphone et vérifier la réconciliation ;
- vérifier que deux taps Start rapides ne produisent qu’un démarrage ;
- tester écran verrouillé, rotation, reprise Android et révocation du téléphone.

**Le projet ne doit pas être qualifié de “live-safe” avant réussite documentée de ce smoke matériel.**
