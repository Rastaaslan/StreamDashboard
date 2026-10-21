# Exécution des contenus autonomes Windows — 21 octobre 2026

Le profil Windows de pilotage conserve son espace autonome IndexedDB, ses identités, ses fichiers audio et ses brouillons à la même origine. Un exécuteur Electron sans fenêtre, appartenant à l’agent, lit cet espace. Il n’effectue aucune migration de données et ne crée pas de connexion OBS.

Les boutons audio et WizeBot compatibles peuvent être associés aux touches globales. Les définitions sont relues avant l’effet ; une identité d’espace remplacée ou un bouton modifié suspend la commande. Les destinations explicites vers d’autres appareils continuent à utiliser leur association et leur empreinte propres.

Les clics locaux et les raccourcis utilisent le même exécuteur. Fermer ou rouvrir le tableau de bord ne recrée pas le lecteur et ne coupe pas les sons lorsque l’arrière-plan est actif. Quitter l’agent les arrête. Au démarrage sans fenêtre, les associations sont relues et vérifiées ; aucune commande enregistrée n’est rejouée.

Chaque commande est inscrite avant son effet. Une interruption laisse un résultat à vérifier. Stop reste accessible pendant une préparation et invalide une lecture qui n’a pas encore commencé. Le journal et l’historique utilisent des transactions de mise à jour IndexedDB afin de conserver les reçus simultanés.

L’exécuteur ne possède aucun preload ni pont natif. Il ne charge pas de pages externes et refuse les nouvelles fenêtres et navigations. Sa CSP limite les connexions aux deux adresses locales du runtime. Les comptes continuent d’appartenir au coffre Windows ; ils ne sont pas copiés dans IndexedDB.

Le changement de rôle par l’ancienne interface rejoint désormais la même file et la même récupération que l’assistant d’installation. Un redémarrage déjà demandé interdit une deuxième écriture de rôle. Les rôles effectivement démarrés restent distincts de la configuration persistée.

## Vérification

- Compilation TypeScript : réussie.
- Contrôleur natif et cycle de vie : 41 tests Vitest réussis, dont les conflits entre interfaces de changement de rôle.
- Exécuteur local, détachement de la fenêtre et continuité des associations : 15 tests Node réussis.
- Non-régression navigateur sur macros et espace autonome : 13 tests réussis.
- Electron réel : 2 tests réussis, dont deux lectures silencieuses simultanées conservées après fermeture de la fenêtre, puis restauration de la macro après redémarrage sans lecture rejouée.

Les essais Electron utilisent Linux/Xvfb et des profils temporaires. Le backend de chiffrement basique n’est activé que dans le test Linux sans trousseau, pour des associations synthétiques sans compte réel. La production Windows conserve son coffre natif.

Ces preuves ne remplacent pas les essais matériels Windows et Android ni la qualification des autres modules et transitions. Aucun live, changement de scène, micro ou message réel n’a été déclenché.
