# Basculement coordonné de l’installation

Le tableau de bord commun propose **Changer d’installation** dans Appareils et comptes. Le même parcours prépare les changements mono-PC, double-PC, ajout ou retrait d’un Deck et configurations personnalisées. Il sélectionne deux espaces existants, les configurations compatibles, les fichiers audio, les événements et les destinations des boutons de ce contrôleur. La prévisualisation montre les configurations avant/après et les fonctions conservées sur la source faute de compatibilité.

Les appareils sont associés au préalable. Leurs rôles effectifs et les permissions sont vérifiés. Les rôles physiques restent configurables dans **Mon installation**, sur chaque appareil ; le basculement ne redémarre pas un agent distant et ne déclare pas un rôle actif sur la seule foi d’une configuration copiée. Les sessions API, identités de chat et cookies restent propres à chaque appareil. Les comptes correspondants doivent être connectés sur la destination avant de publier une modification du planning.

## Ordre et reprise

1. Vérification de l’installation prévisualisée, des identités, des permissions et des contenus.
2. Copie additive des fichiers audio avec leurs identités et empreintes.
3. Copie des configurations, macros et modèles compatibles. Les automatismes copiés sont désactivés.
4. Transfert de responsabilité de chaque événement avec son journal de publications.
5. Vérification des définitions de boutons sur la destination, puis écriture unique des destinations et du preset de ce contrôleur.

Le journal est conservé dans IndexedDB avant les mutations et après chaque confirmation. Un verrou entre fenêtres sérialise l’assistant. Les comparaisons strictes et les journaux des exécuteurs protègent aussi les interventions d’autres contrôleurs. Une réponse perdue est réconciliée grâce aux identités déjà utilisées ; aucune commande ni publication n’est rejouée.

Il s’agit d’une opération récupérable composée de validations locales, pas d’une transaction atomique entre ordinateurs. Une interruption peut laisser des copies confirmées et un événement temporairement gelé ; l’interface garde le changement pour le reprendre ou revenir en arrière. L’appareil source conserve ses contenus, son identité et ses associations. Un retrait reste une désactivation réversible séparée, après vérification des fonctions qui y demeurent.

## Retour arrière

Les destinations sont d’abord restaurées, si la configuration du contrôleur n’a pas changé. Le planning revient ensuite à la source. Un transfert encore en préparation est annulé avec confirmation des deux côtés ; un événement déjà actif revient par un nouveau transfert, avec ses modifications et identifiants de publication actuels. Une réponse perdue pendant cette compensation est également récupérable.

Les configurations sont restaurées uniquement si elles correspondent toujours aux valeurs confirmées après copie. Un conflit bloque l’étape sans écraser le travail intervenu depuis. Les fichiers audio restent disponibles sur les deux appareils ; le retour arrière ne les supprime pas. Un événement supprimé ou confié depuis à un troisième appareil nécessite une réconciliation explicite.

Le basculement ne change pas les destinations des autres contrôleurs. Les espaces autonomes Windows et l’agent Windows restent distincts, même sur un seul appareil physique. Une destination autonome locale est utilisable en ouvrant cet espace ; le parcours ne lui invente pas une adresse d’exécution distante.

## Correction du suivi des rôles

Une association pouvait garder la description ancienne d’un rôle distant et empêcher sa réactivation d’être constatée. Le routage vérifie maintenant à nouveau l’agent avant un déclenchement ; son observation authentifiée remplace la description ancienne du rôle distant. Un appareil retiré ou une capacité incompatible restent bloquants. Les rôles configurés sur l’appareil local gardent leur autorité. Aucune commande n’est répétée lors de cette vérification.

## Preuves

- `tests/node/setup-migration.test.mjs` : six presets, transfert complet, chaque frontière de réponse perdue, retour arrière à chaque frontière, interruption de la compensation, modifications concurrentes et conservation des données récentes.
- `tests/setup-migration-ui.spec.ts` : parcours réel Chromium, IndexedDB et fichiers audio, rechargement de la page après activation sans réponse, reprise, changement ultérieur du planning et retour arrière ; concurrence entre deux contrôleurs.
- `tests/node/action-routing.test.mjs` : arrêt et réactivation d’un rôle distant sans nouvelle association et sans répétition d’effet.
- `scripts/qa-tls-agent.ps1`, modes `MigrationPrepare`, `MigrationResume`, `MigrationUndo` : essai matériel sur des candidats Windows isolés, sons silencieux jamais lus, planning sans publication externe, interruption avant basculement des destinations et vérification de la conservation des processus stables.

Trois cycles matériels ont réussi sur les deux PC Windows, avec les deux contrôleurs, les deux sens de transfert, perte de réponse, arrêt/redémarrage des deux agents, reprise et retour arrière conservant le planning modifié. Les identités TLS et les associations sont conservées. Les preuves détaillées figurent dans `2026-10-21-setup-migration-hardware.json`. Les résultats de construction sont consignés dans le bilan universel. Ces preuves ne ferment pas la qualification Android physique, les sessions authentifiées des plateformes ni la migration complète RC11.7.
