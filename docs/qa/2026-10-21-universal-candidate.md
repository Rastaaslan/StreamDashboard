# StreamDashboard Next 2.1 — candidat de qualification

Ce candidat réunit les évolutions universelles sur le commit de code `763da840e8dfc4bb92a9b6164a8e244ec6512445`. Il est intermédiaire : Next 2.1 n’est pas encore qualifié comme version finale universelle. La matrice conserve 75 cellules ouvertes.

## Réalisation réunie

- Modèle commun appareils, capacités, rôles, permissions et six préréglages.
- Exécuteurs Windows et Android, HTTPS avec empreintes, associations par appareil, routage des boutons et reçus persistants.
- Exécuteur des contenus autonomes Windows sans fenêtre : sons et raccourcis restent actifs après fermeture de l’interface ; aucune lecture n’est rejouée au redémarrage.
- Continuité des espaces et des modifications locales après changement d’adresse d’un appareil.
- Audio simultané, arrêt pendant une préparation, transfert audio Android reprenable avec empreinte et publication atomique.
- Copie de bibliothèques audio entre agents Windows et espaces autonomes Windows/Android : prévisualisation, identités et réglages conservés, empreintes vérifiées, reprise et reçus persistants, conflits sans écrasement. Les fichiers sources sont conservés.
- Assistant commun de basculement : configurations, fichiers audio, responsabilité du planning et destinations des boutons ; reprise après coupure, retour arrière conservant les événements modifiés, protection des autres contrôleurs. Les rôles nécessaires sont vérifiés sur les appareils.
- Copie prévisualisée et réversible des configurations et macros : collection de boutons atomique, comparaison stricte, reprise après interruption et protection des modifications ultérieures. Indexation des anciens fichiers audio sans remplacement.
- Déplacement bidirectionnel du planning entre agents Windows et espaces autonomes Windows/Android : prévisualisation, verrouillage de la source, activation confirmée, annulation, reprise et retour sur l’appareil précédent ; conservation des identités de publication sans appel fournisseur pendant le transfert.
- Découverte locale Windows/Android, suivie de l’association sécurisée obligatoire.
- Conservation des permissions restreintes après redémarrage réel du serveur Windows.
- Export/import prévisualisé de l’installation, restauration précédente et export JSON natif Android.
- Checkpoint vérifié des configurations et identités chiffrées RC11.7 avant création du modèle universel.

## Vérification de cette version

| Campagne | Résultat |
|---|---:|
| Vitest | 1 456 réussis, 165 fichiers |
| Node | 348 réussis |
| Parcours navigateur | 108 réussis |
| Android JVM | 47 réussis |
| Electron et aperçus | 8 réussis, dont 5 Electron réels |
| Compilation, lint Android, sécurité et syntaxe distribuée | Réussis |
| Construction et intégrité du paquet Windows | Réussies |

Les assets de l’APK ont été comparés aux sources. La campagne complète représente **1 967 tests réussis**, auxquels s’ajoutent les vérifications de compilation, de sécurité et d’intégrité des paquets.

Sur les vrais clients Windows, trois changements complets ont réussi : FIXE vers Laptop depuis FIXE, Laptop vers FIXE depuis FIXE, puis Laptop vers FIXE depuis Laptop. Chacun a copié un fichier audio, les configurations compatibles et un événement, puis perdu volontairement la confirmation d’activation avant le changement des destinations. Après arrêt et redémarrage des deux candidats, la reprise et le retour arrière ont réussi. Une modification de l’événement après transfert a été conservée au retour. Les sons sont restés disponibles sur les deux appareils et n’ont jamais été lus.

L’association TLS fonctionne dans les deux sens, refuse une mauvaise empreinte et conserve identités, empreintes et autorisations après redémarrage. La fermeture de la fenêtre Laptop laisse son agent joignable. Les connexions TCP Laptop vers FIXE ont réussi sur Tailscale et le LAN. Les règles bloquantes trouvées sur FIXE visaient uniquement le candidat temporaire précédent ; aucune règle réseau n’a été changée.

Les profils étaient isolés, sans rôle OBS ni comptes réels. Aucun live, message de chat, son ou macro n’a été déclenché. Les processus stables et OBS sont restés actifs. Les candidats et le serveur temporaire de transfert ont été arrêtés, leurs ports libérés et leurs paquets temporaires retirés. Détails : `2026-10-21-setup-migration.md` et `2026-10-21-setup-migration-hardware.json`.

Les audits antérieurs des copies RC11.7 restent partiels : le portable passe les contrôles de fichiers et d’identité ; sur FIXE, le profil actif a changé pendant l’audit. Les cookies et l’accès aux comptes chiffrés ne sont pas encore qualifiés.

## Travail restant avant livraison universelle

1. Qualifier les six setups et leurs transitions avec un téléphone Android réel, plusieurs contrôleurs, arrêts, veille et changements de réseau. Aucun téléphone n’est visible dans ADB sur FIXE.
2. Vérifier les sessions web authentifiées Twitch/YouTube et le cycle complet du chat pendant une diffusion autorisée, avec les identités propres à chaque appareil.
3. Terminer la migration et le retour arrière matériels RC11.7, y compris les sessions navigateur et les accès chiffrés aux comptes, sur une copie cohérente d’un profil fermé. Les profils stables actuellement actifs n’ont pas été arrêtés.

Les succès simulés ne ferment pas les cellules matérielles. `npm run universal:release-check` reste volontairement bloquant. La RC11.7 demeure la base stable ; aucun remplacement d’installation, arrêt d’OBS, changement de `main` ou publication finale n’a été effectué.

## Paquets

Le ZIP Windows et l’APK Android de test proviennent du même commit de code. Leurs tailles et SHA-256 figurent dans `2026-10-21-universal-candidate-artifacts.json`. Ils servent à la qualification contrôlée et ne doivent pas être présentés comme la livraison finale universelle.
