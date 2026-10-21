# StreamDashboard Next 2.1 — candidat de qualification

Ce candidat réunit les évolutions universelles sur le commit de code `34613731afdf56c1a5b4d9581bf7b1b25805dc08`. Il est intermédiaire : Next 2.1 n’est pas encore qualifié comme version finale universelle. La matrice conserve 75 cellules ouvertes.

## Réalisation réunie

- Modèle commun appareils, capacités, rôles, permissions et six préréglages.
- Exécuteurs Windows et Android, HTTPS avec empreintes, associations par appareil, routage des boutons et reçus persistants.
- Exécuteur des contenus autonomes Windows sans fenêtre : sons et raccourcis restent actifs après fermeture de l’interface ; aucune lecture n’est rejouée au redémarrage.
- Continuité des espaces et des modifications locales après changement d’adresse d’un appareil.
- Audio simultané, arrêt pendant une préparation, transfert audio Android reprenable avec empreinte et publication atomique.
- Copie de bibliothèques audio entre agents Windows et espaces autonomes Windows/Android : prévisualisation, identités et réglages conservés, empreintes vérifiées, reprise et reçus persistants, conflits sans écrasement. Les fichiers sources sont conservés.
- Déplacement bidirectionnel du planning entre agents Windows et espaces autonomes Windows/Android : prévisualisation, verrouillage de la source, activation confirmée, annulation, reprise et retour sur l’appareil précédent ; conservation des identités de publication sans appel fournisseur pendant le transfert.
- Découverte locale Windows/Android, suivie de l’association sécurisée obligatoire.
- Conservation des permissions restreintes après redémarrage réel du serveur Windows.
- Export/import prévisualisé de l’installation, restauration précédente et export JSON natif Android.
- Checkpoint vérifié des configurations et identités chiffrées RC11.7 avant création du modèle universel.

## Vérification de cette version

| Campagne | Résultat |
|---|---:|
| Vitest | 1 455 en suite complète, puis 85 tests ciblés après les derniers ajustements |
| Node | 328 en suite complète + 1 nouvelle régression réussie dans un ciblage de 6 tests |
| Parcours navigateur | 102 réussis, puis 8 contrôles audio ciblés |
| Android JVM | 47 réussis |
| Electron et aperçus | 8 réussis, dont 5 Electron réels |
| Compilation TypeScript, lint Android, sécurité, syntaxe distribuée | Réussis |
| Construction et intégrité du paquet Windows | Réussies |

La campagne générale valide les 164 fichiers Vitest et les 102 parcours navigateur. Le dernier ajustement ajoute un reçu durable Windows empêchant une ancienne tentative de recréer un son supprimé après sa copie ; il passe 85 tests ciblés, les huit parcours audio, la compilation et les contrôles de distribution. Les six tests Node ciblés incluent la nouvelle protection contre une destination trop ancienne, soit 329 tests Node distincts réussis au cours du chantier.

Le premier essai Electron de cette livraison a échoué avant le démarrage de l’application : son chemin temporaire dépassait la limite des sockets Unix. Après choix d’un répertoire temporaire court et isolé, les huit essais passent, puis le paquet Windows est construit et son intégrité vérifiée. Les assets de l’APK sont comparés octet par octet aux sources. Les détails des transferts figurent dans `2026-10-21-audio-library.md` et `2026-10-21-planning-ownership.md`.

Les tests automatisés isolent les fournisseurs et n’envoient aucun message public ni commande réelle de live. Les tests de fermeture et redémarrage Electron utilisent notamment une lecture audio silencieuse réelle.

Lors des audits antérieurs sur les copies de données réelles : le portable passe le checkpoint, la conservation des fichiers, la persistance d’identité et l’aller-retour des rôles. Sur FIXE, la copie et le checkpoint passent, mais le profil utilisé par l’application active a changé pendant l’audit ; cet essai reste partiel. Les dix processus observés sur FIXE et les neuf sur le portable sont restés actifs. Les bases navigateur et l’accès aux comptes chiffrés ne sont pas couverts par cet audit de copie.

## Travail restant avant livraison universelle

1. Terminer le déplacement global des configurations, des macros et des responsabilités combinées. La copie additive des bibliothèques audio et le transfert réversible du planning sont implémentés et vérifiés automatiquement ; ils ne constituent pas encore un basculement global atomique. Les anciens fichiers locaux sans empreinte peuvent encore nécessiter une réconciliation lors d’un retour vers une identité préexistante.
2. Qualifier les six setups et leurs transitions avec un téléphone Android réel, plusieurs contrôleurs, arrêts, veille et changements de réseau.
3. Vérifier les sessions web authentifiées Twitch/YouTube et le cycle complet du chat pendant une diffusion autorisée.
4. Terminer la migration et le retour arrière matériels RC11.7, y compris les sessions navigateur et les accès chiffrés aux comptes.

Les succès simulés ne ferment pas les cellules matérielles. `npm run universal:release-check` reste volontairement bloquant. La RC11.7 demeure la base stable ; aucun remplacement d’installation, arrêt d’OBS, changement de `main` ou publication finale n’a été effectué.

## Paquets

Le ZIP Windows et l’APK Android de test proviennent du même commit de code. Leurs tailles et SHA-256 figurent dans `2026-10-21-universal-candidate-artifacts.json`. Ils servent à la qualification contrôlée et ne doivent pas être présentés comme la livraison finale universelle.
