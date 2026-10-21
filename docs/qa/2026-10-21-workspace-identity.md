# Continuité des espaces lors des changements d’adresse

Date : 21 octobre 2026. Candidat : 2.1.0-alpha.1, qualification universelle ouverte.

## Comportement

L’adresse réseau est désormais distincte de la copie locale d’un espace. Après une lecture authentifiée de l’espace et de l’identité physique disponible, une nouvelle adresse retrouve le même enregistrement IndexedDB. Le passage de HTTP vers HTTPS et le changement d’IP conservent les identifiants des modifications en attente, les brouillons, les favoris du deck et les destinations de boutons.

Le lien et l’initialisation éventuelle sont enregistrés dans une transaction IndexedDB. Chaque écriture retrouve ce lien dans sa propre transaction : une fenêtre ouverte avant l’association ne crée pas une seconde file de modifications. Le transfert de créations autonomes vers la nouvelle adresse utilise aussi l’espace original. Aucune commande de lecture audio, OBS ou chat n’est mise en file ou rejouée par ce mécanisme.

Les autorisations et empreintes restent liées à leur origine. Elles ne sont jamais transférées depuis l’ancienne adresse. Le nouveau lien doit être associé séparément par le transport sécurisé existant. L’ouverture d’un appareil connu vérifie aussi son identité physique avant de changer l’espace affiché.

Une identité différente à la même adresse, une copie d’espace annoncée par un autre appareil physique ou plusieurs anciennes copies indépendantes produisent un diagnostic. Aucune copie n’est supprimée ou sélectionnée silencieusement. Pour ces cas ambigus, la réconciliation explicite reste à compléter ; le diagnostic demande de conserver et d’exporter les copies existantes.

## Vérifications ciblées

- `tests/node/replica-identity.test.mjs` : changement d’IP/HTTPS, association répétée, adresse réutilisée, identité physique différente, anciennes copies concurrentes, compatibilité RC11.7 et séparation de l’espace autonome.
- `tests/replica-identity-ui.spec.ts` : véritable IndexedDB dans Chromium, persistance après rechargement, écritures de fenêtres déjà ouvertes, absence d’écriture lors d’un refus et transfert autonome sans doublon.
- `tests/node/mobile-performance.test.mjs` : la fonction utilisée dans le contrôleur conserve les choix du deck lorsque l’adresse change.
- `tests/controller-bindings-ui.spec.ts` : le véritable formulaire d’association retrouve les brouillons, les modifications en attente et les destinations de boutons ; les identifiants restent séparés entre les deux origines et les macros restent suspendues tant qu’un conflit subsiste.

Les 1 441 tests Vitest, 291 tests Node et 85 tests navigateur de l’intégration passent, ainsi que les quatre scénarios Electron Linux. Après ajout du contrôle de l’identité physique déjà connue, les neuf tests Node concernés et les onze tests navigateur concernés passent à nouveau, avec un cas supplémentaire dans chaque suite. Les contrôles de sécurité et de syntaxe JavaScript distribuée passent sur ce dernier code. Ces nombres distinguent l’exécution complète des vérifications ciblées et ne les additionnent pas.

Le test de reconnexion WebSocket attend maintenant la réception asynchrone du ticket réseau avant de vérifier qu’une seule socket est ouverte. L’état HTTP connecté peut légitimement précéder cette étape ; une assertion immédiate avait produit un échec de qualification sans panne du transport.

## Portée

Le code est intégré aux ressources communes Windows, Android et navigateur, ainsi qu’au cache hors ligne. Ces preuves automatisées ne qualifient pas matériellement Android. Elles ne constituent pas non plus une transaction distribuée entre le coffre d’identifiants, le document d’installation et les services cloud. Les données RC11.7 et les profils stables restent préservés.
