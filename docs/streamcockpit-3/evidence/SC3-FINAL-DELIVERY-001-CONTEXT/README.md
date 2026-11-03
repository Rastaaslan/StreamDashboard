# Preuves contexte maître et régression précédente

Les journaux integrated2-vitest(-tls) concernent le commit propre **37214d5e189b764b509119d26dba0bec79922168**, avant F03/F07. Le premier passage a deux suites TLS non préparées, le second passe **2271 tests / 112 skipped / 0 FAIL** avec OpenSSL déjà installé dans le PATH du processus.

Le complément F03/F07 est qualifié ici par **context-qualified-targets.txt : 129 PASS**, dix fichiers, avec vrai HTTP/OBS MessagePack simulé, DashboardServer complet et Edge 320 px. **context-electron.txt : 1 PASS** vérifie le vrai shell Electron, le clic du Deck, la commande OBS fictive et son reçu natif. Il ne s’agit pas d’une réception matérielle Android ou d’un OAuth Twitch de production.

Les originaux sont conservés dans original-logs.zip avec SHA-256 ; les copies texte normalisent encodage, ANSI et espaces uniquement. Types, build, JavaScript livré et sécurité sont enregistrés séparément. La prochaine campagne générale devra être attribuée au commit qui intègre ces sources.
