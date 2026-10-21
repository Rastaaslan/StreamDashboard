# Déplacement bidirectionnel du planning

Le même protocole est utilisé par l’agent Windows et les espaces autonomes Windows/Android. Le parcours « Appareils et comptes → Déplacer le planning » permet de choisir les espaces source et destination, prévisualiser un événement, le transférer, reprendre un transfert interrompu ou l’annuler avant activation. Un transfert terminé se renverse par un nouveau transfert, en conservant les modifications effectuées sur la destination.

La source devient consultable sans droit de publication avant la réservation de la destination. Elle confirme ensuite la libération ; la destination active l’événement et conserve les identifiants, comptes propriétaires, récurrences et journaux de publication. Ces étapes n’appellent aucun fournisseur. Les connexions restent propres à chaque appareil.

Les reçus et les changements de propriété sont persistés ensemble. Une réponse perdue n’autorise pas une seconde publication. L’annulation écrit un reçu permanent sur la destination avant de restaurer la source ; une activation retardée est alors refusée. Aucun délai n’efface automatiquement un verrou. Le contrôleur conserve les transferts dans IndexedDB sans identifiants de connexion, vérifie l’identité physique des appareils et réutilise leur association actuelle.

Les protections couvrent les mises à jour, suppressions, reprises de publication, résolutions de conflit, synchronisations Twitch/Google et modifications provenant d’un ancien compagnon. Les copies créées par l’ancien transfert local sont aussi récupérables. Un autre appareil ne peut pas détourner un événement déjà réservé. La source conserve ses données consultables.

## Vérifications ciblées

- Coupure après chacune des quatre étapes, réouverture des données et reprise.
- Annulation avant départ, après préparation, après réservation et après libération.
- Transfert inverse après modification sur la destination ; un ancien reçu ne réactive pas une ancienne copie.
- Deux serveurs réels sur ports locaux isolés, redémarrages entre étapes et conservation des identités.
- Parcours de l’interface avec IndexedDB réel, réponse d’activation perdue et reprise.
- Deux contrôleurs concurrents et tentative de suppression de la copie source.
- Blocage des publications, reprises, suppressions et conflits sur une copie transférée.

## Frontières conservées

Le transfert est explicite, événement par événement. Les publications incertaines, le suivi d’un live en cours et les travaux fournisseurs en attente doivent être réconciliés avant le départ. Les données et comptes ne sont jamais supprimés pour contourner ces blocages.

Ce lot termine le transfert réversible du planning entre ces espaces, pas une migration atomique de tous les contenus d’un appareil. Les transferts inverses de bibliothèques audio complètes, les configurations globales et les changements combinés de responsabilités restent à compléter. Les essais matériels Android, les six setups et leurs transitions, les sessions web authentifiées et la migration complète RC11.7 restent à qualifier. Aucun résultat simulé ne clôt ces exigences.
