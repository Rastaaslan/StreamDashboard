# StreamDashboard Next 2.1 — candidat de qualification

Ce candidat réunit les évolutions universelles sur le commit de code `226aa6863ebc87cd92af968e5eeb5855cf44e92c`. Il est intermédiaire : Next 2.1 n’est pas encore qualifié comme version finale universelle. La matrice conserve 75 cellules ouvertes.

## Réalisation réunie

- Modèle commun appareils, capacités, rôles, permissions et six préréglages.
- Exécuteurs Windows et Android, HTTPS avec empreintes, associations par appareil, routage des boutons et reçus persistants.
- Exécuteur des contenus autonomes Windows sans fenêtre : sons et raccourcis restent actifs après fermeture de l’interface ; aucune lecture n’est rejouée au redémarrage.
- Continuité des espaces et des modifications locales après changement d’adresse d’un appareil.
- Audio simultané, arrêt pendant une préparation, transfert audio Android reprenable avec empreinte et publication atomique.
- Adoption du planning par Android avec conservation des identités de publication, sans appel fournisseur pendant le transfert.
- Découverte locale Windows/Android, suivie de l’association sécurisée obligatoire.
- Conservation des permissions restreintes après redémarrage réel du serveur Windows.
- Export/import prévisualisé de l’installation, restauration précédente et export JSON natif Android.
- Checkpoint vérifié des configurations et identités chiffrées RC11.7 avant création du modèle universel.

## Vérification de cette version

| Campagne | Résultat |
|---|---:|
| Vitest | 1 451 réussis |
| Node | 312 réussis |
| Parcours navigateur | 97 réussis |
| Android JVM | 47 réussis |
| Electron et aperçus | 8 réussis, dont 5 Electron réels |
| Compilation TypeScript, lint Android, sécurité, syntaxe distribuée | Réussis |
| Construction et intégrité du paquet Windows | Réussies |

Les tests automatisés isolent les fournisseurs et n’envoient aucun message public ni commande réelle de live. Les tests de fermeture et redémarrage Electron utilisent notamment une lecture audio silencieuse réelle.

Sur les copies de données réelles : le portable passe le checkpoint, la conservation des fichiers, la persistance d’identité et l’aller-retour des rôles. Sur FIXE, la copie et le checkpoint passent, mais le profil utilisé par l’application active a changé pendant l’audit ; cet essai reste partiel. Les dix processus observés sur FIXE et les neuf sur le portable sont restés actifs. Les bases navigateur et l’accès aux comptes chiffrés ne sont pas couverts par cet audit de copie.

## Travail restant avant livraison universelle

1. Terminer le déplacement distribué complet des responsabilités et les transferts inverses depuis les espaces appartenant au serveur, avec reprise et restauration croisées.
2. Qualifier les six setups et leurs transitions avec un téléphone Android réel, plusieurs contrôleurs, arrêts, veille et changements de réseau.
3. Vérifier les sessions web authentifiées Twitch/YouTube et le cycle complet du chat pendant une diffusion autorisée.
4. Terminer la migration et le retour arrière matériels RC11.7, y compris les sessions navigateur et les accès chiffrés aux comptes.

Les succès simulés ne ferment pas les cellules matérielles. `npm run universal:release-check` reste volontairement bloquant. La RC11.7 demeure la base stable ; aucun remplacement d’installation, arrêt d’OBS, changement de `main` ou publication finale n’a été effectué.

## Paquets

Le ZIP Windows et l’APK Android de test proviennent du même commit de code. Leurs tailles et SHA-256 figurent dans `2026-10-21-universal-candidate-artifacts.json`. Ils servent à la qualification contrôlée et ne doivent pas être présentés comme la livraison finale universelle.
