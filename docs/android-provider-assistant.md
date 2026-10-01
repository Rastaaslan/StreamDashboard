# Assistant de connexion Android

Dans **Plus → Comptes connectés → Connexions du téléphone**, chaque compte
existant dispose du même parcours : Configuration → OAuth → Test → Prêt.
Les comptes du PC restent distincts, avec leurs actions issues du contrat
`ConnectionSnapshot.capabilities`. Aucune nouvelle connexion n'est créée pour
le diagnostic ou le retest.

- Configuration : le build doit contenir `TWITCH_ANDROID_CLIENT_ID` ou
  `GOOGLE_ANDROID_CLIENT_ID`. Le diagnostic affiche uniquement leur présence.
  Installer un build configuré si un identifiant manque ; aucun secret client
  n'est demandé à l'utilisateur.
- OAuth : utiliser Autoriser et terminer dans le navigateur. Au retour,
  utiliser Diagnostic / Tester. En cas d'annulation sans callback, Relancer
  OAuth remplace la demande en attente, même si une ancienne session existe.
- Test : Twitch valide la session, les scopes et le statut affilié/partenaire
  requis pour écrire le planning. Google vérifie les scopes Calendar et le
  droit d'écriture du calendrier principal, cible des nouvelles publications.
- Prêt : les capabilities autorisent les publications. Leur contrôle est
  effectué à nouveau avant mutation, côté adaptateur et côté Android.
  Les liens existants conservent leur identifiant de calendrier et d'événement.

Les tokens restent dans le stockage natif. Les diagnostics JavaScript utilisent
une projection fermée (booléens, scopes connus, capabilities connues, date et
messages prédéfinis), jamais les messages OAuth bruts. Le dernier succès de
synchronisation est conservé sur l'appareil. Les tests de permissions expirent
après cinq minutes ; Retester renouvelle leur résultat sans lancer OAuth.

## Vérification sans npm

```sh
node tests/node/provider-diagnostics.test.mjs
node tests/node/provider-controls.test.mjs
node --check apps/mobile/mobile.js
node --check apps/mobile/provider-sync.js
node --check apps/mobile/provider-diagnostics.js
node --check apps/mobile/sw.js
```

La validation sur appareil nécessite un build Android configuré et des comptes
de test : annuler OAuth, revenir après succès, refuser des scopes, révoquer une
session, retester hors ligne et vérifier qu'une publication refusée ne crée
aucun événement. Le build Android complet et ce parcours réel ne sont pas
couverts par les tests Node.
