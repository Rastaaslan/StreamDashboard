# StreamDashboard Next 2.1 — candidat de qualification

Ce candidat réunit les évolutions universelles sur le commit de code `8be0d5c388772486c81a2328617db2c79d46e835`. Il est intermédiaire : Next 2.1 n’est pas encore qualifié comme version finale universelle. La matrice conserve 75 cellules ouvertes.

## Réalisation réunie

- Modèle commun appareils, capacités, rôles, permissions et six préréglages.
- Exécuteurs Windows et Android, HTTPS avec empreintes, associations par appareil, routage des boutons et reçus persistants.
- Exécuteur des contenus autonomes Windows sans fenêtre : sons et raccourcis restent actifs après fermeture de l’interface ; aucune lecture n’est rejouée au redémarrage.
- Continuité des espaces et des modifications locales après changement d’adresse d’un appareil.
- Audio simultané, arrêt pendant une préparation, transfert audio Android reprenable avec empreinte et publication atomique.
- Copie de bibliothèques audio entre agents Windows et espaces autonomes Windows/Android : prévisualisation, identités et réglages conservés, empreintes vérifiées, reprise et reçus persistants, conflits sans écrasement. Les fichiers sources sont conservés.
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
| Node | 335 réussis |
| Parcours navigateur | 106 réussis |
| Android JVM | 47 réussis |
| Electron et aperçus | 8 réussis, dont 5 Electron réels |
| Compilation, lint Android, sécurité et syntaxe distribuée | Réussis |
| Construction et intégrité du paquet Windows | Réussies |

Les assets de l’APK ont été comparés aux sources. Le transfert des configurations a également été essayé sur les vrais clients Windows, de FIXE vers Laptop-damien : association TLS, réponse perdue, arrêt des deux candidats, redémarrage, reprise et restauration exacte de la configuration précédente. Les processus stables et OBS sont restés actifs. La connexion inverse vers FIXE n’a pas abouti sur Tailscale ni sur le LAN ; cette direction n’est pas validée par cet essai.

Les premières tentatives ont mis en évidence deux défauts du harnais, corrigés avant le nouvel essai : sélection de la fenêtre interne et réécriture d’un libellé accentué par PowerShell au redémarrage. Les journaux distinguent ces tentatives du cycle réussi. Détails : `2026-10-21-configuration-copy.md` et `2026-10-21-configuration-hardware.json`.

Les profils de test sont isolés, sans rôle OBS ni comptes réels. Aucun live, message de chat ni macro n’a été déclenché. Les deux candidats et le serveur temporaire de transfert ont été arrêtés, leurs ports libérés et leurs paquets temporaires retirés.

Les audits antérieurs des copies RC11.7 restent partiels : le portable passe les contrôles de fichiers et d’identité ; sur FIXE, le profil actif a changé pendant l’audit. Les cookies et l’accès aux comptes chiffrés ne sont pas encore qualifiés.

## Travail restant avant livraison universelle

1. Réunir les transferts de configuration, de fichiers, du planning et des responsabilités dans un basculement coordonné. Les opérations dédiées sont implémentées avec reprise et protections ; elles ne constituent pas encore un assistant global atomique. Les anciens fichiers audio sans empreinte sont maintenant vérifiés lors d’un transfert retour.
2. Qualifier les six setups et leurs transitions avec un téléphone Android réel, plusieurs contrôleurs, arrêts, veille et changements de réseau.
3. Vérifier les sessions web authentifiées Twitch/YouTube et le cycle complet du chat pendant une diffusion autorisée.
4. Terminer la migration et le retour arrière matériels RC11.7, y compris les sessions navigateur et les accès chiffrés aux comptes.

Les succès simulés ne ferment pas les cellules matérielles. `npm run universal:release-check` reste volontairement bloquant. La RC11.7 demeure la base stable ; aucun remplacement d’installation, arrêt d’OBS, changement de `main` ou publication finale n’a été effectué.

## Paquets

Le ZIP Windows et l’APK Android de test proviennent du même commit de code. Leurs tailles et SHA-256 figurent dans `2026-10-21-universal-candidate-artifacts.json`. Ils servent à la qualification contrôlée et ne doivent pas être présentés comme la livraison finale universelle.
