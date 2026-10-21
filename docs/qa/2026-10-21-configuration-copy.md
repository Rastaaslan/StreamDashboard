# Copie réversible des configurations et macros

Le contrôleur commun propose « Copier les configurations et macros » dans Appareils et comptes. Il compare les espaces source et destination, affiche les anciennes et nouvelles valeurs et permet de choisir les groupes à copier. Les identités des boutons, modèles et automatismes sont conservées. Une absence sur la source ne supprime pas un élément propre à la destination.

Les boutons et raccourcis sont enregistrés ensemble, dans une seule écriture de configuration. Un échange de raccourcis entre deux boutons ne crée donc pas de conflit intermédiaire. Un raccourci déjà utilisé par un bouton supplémentaire de destination provoque un refus explicite. Aucune action de bouton n’est exécutée pendant la copie.

Windows reçoit les réglages de présentation et de scènes, les boutons, les modèles, le profil, les préférences, les sorties, les cibles YouTube, les paramètres publics Discord/Calendar et les automatismes. Les copies d’automatismes arrivent désactivées. L’espace autonome Windows et Android reçoit les réglages compatibles, boutons, modèles, profil et préférences. Les autres groupes sont listés comme conservés sur la source. Les sessions API, cookies, mots de passe, associations et chemins physiques ne sont pas déplacés. Le planning et les fichiers audio conservent leurs transferts dédiés.

## Reprise et retour arrière

Le contrôleur conserve le travail dans IndexedDB avant toute écriture. Chaque opération possède une identité stable et compare exactement la version prévisualisée. Un agent trop ancien ou un espace d’identité différente est refusé. La lecture des reçus ne déclenche pas de nouvelle écriture. Une réponse perdue peut donc être retrouvée après reconnexion ou redémarrage.

Sur Android, la modification et son reçu sont enregistrés dans une seule transaction IndexedDB. Sur Windows, les reçus de l’agent précèdent et suivent ses écritures atomiques ; une interruption non réconciliable reste explicitement incertaine. La copie de plusieurs groupes est une séquence récupérable : elle ne prétend pas être une transaction atomique sur plusieurs magasins ou appareils.

Le retour arrière inverse les opérations confirmées. Il compare la version effectivement enregistrée par la destination, sans écraser une modification ultérieure. Un conflit arrête le retour arrière et conserve le journal ainsi que les valeurs précédentes. La source reste intacte. Un retour arrière déjà engagé ne peut pas relancer la copie dans l’autre sens.

Les fichiers audio issus des anciens imports locaux peuvent maintenant recevoir une empreinte calculée sur leur Blob existant. Cette indexation ne remplace pas le fichier et ne recrée pas une entrée retirée du catalogue. Une modification du catalogue pendant la vérification bloque sa validation. Le transfert retour vérifie ensuite cette empreinte et refuse un contenu différent sous la même identité.

## Preuves

- `tests/configuration-transfer.test.ts` : deux agents HTTP réels, collection de macros atomique avec échange de raccourcis, réponse perdue, redémarrage, refus d’identité et retour arrière protégé.
- `tests/node/configuration-transfer.test.mjs` : prévisualisation, conservation des réglages physiques, automatisme désarmé, versions périmées, reprise, annulation sans réexécution d’une requête inconnue et retour arrière.
- `tests/configuration-transfer-ui.spec.ts` : stockage IndexedDB réel, réouverture, reçu atomique, permissions et révocation de l’exécuteur Android, sélection et retour arrière par l’interface.
- `tests/sound-transfer-ui.spec.ts` : ancien fichier sans empreinte, copie retour et refus d’un fichier différent.
- `scripts/qa-tls-agent.ps1` : profils Windows temporaires, séparation des ports, association TLS, copie, interruption du contrôleur, reprise et retour arrière. OBS est désactivé dans ces profils ; les processus stables ne sont jamais arrêtés par le harnais.

## Essai matériel Windows

La copie FIXE → Laptop-damien a réussi avec les clients Windows empaquetés : réponse volontairement perdue, arrêt des deux candidats, redémarrage, reprise du journal et restauration exacte des boutons précédents. Les libellés accentués sont conservés. La direction inverse reste bloquée : aucune connexion TCP au port du candidat FIXE, sur Tailscale comme sur le LAN, malgré son écoute vérifiée. Aucune règle réseau n’a été modifiée. Les applications stables et OBS sont restés actifs ; les candidats ont été arrêtés et leurs paquets temporaires retirés. Voir `2026-10-21-configuration-hardware.json`.

Le harnais a été corrigé pour sélectionner le tableau de bord visible, encoder les requêtes JSON PowerShell en UTF-8 et ne plus réécrire les raccourcis au redémarrage. La vérification de cohérence a détecté cette réécriture lors du premier essai. Le nouvel essai conserve son journal distinct.

## Limites de livraison

Ces transferts sont maintenant réunis dans l’assistant décrit dans `2026-10-21-setup-migration.md`. Les rôles physiques restent modifiables dans Mon installation ; l’assistant vérifie leur activation et bascule les destinations après confirmation des contenus. La qualification matérielle des six setups, les sessions authentifiées des plateformes et la migration complète des profils RC11.7 restent nécessaires. Aucun de ces contrôles automatisés ne remplace un essai sur téléphone.
