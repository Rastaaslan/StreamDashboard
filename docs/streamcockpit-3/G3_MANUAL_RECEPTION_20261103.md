# Réception G3 — Dam, FIXE / laptop / Android
Aucun scénario ci-dessous n’est déclaré PASS. Utiliser la même révision de test identifiée sur les trois appareils, dans une fenêtre hors diffusion. Le laptop et Android sont manipulés manuellement par l’opérateur.

## Préparation
1. Conserver RC2 et ses données. Employer les copies/profils de test isolés préparés avec la candidate ; ne pas remplacer les installations avant accord.
2. FIXE reste seul propriétaire OBS/minuteur. Laptop = client, téléphone = client Android.
3. Relever commit/version sur chaque appareil et l’identité de régie affichée. Ouvrir le journal de commandes et le diagnostic.
4. Capturer un diagnostic avant et après chaque essai : node scripts/streamcockpit3-collect-g3.mjs --url http://127.0.0.1:48133 --out out/sc3-g3/avant.json
5. Ne pas démarrer/arrêter un live et ne pas envoyer d’action Twitch publique dans cette campagne. Les cases correspondantes restent non exécutées sans autorisation séparée.

| ID | Manipulation opérateur | Résultat à relever | État |
| --- | --- | --- | --- |
| G3-01 | Associer laptop et Android à FIXE | Même ID de régie, rôles distincts, aucun repli local | pending |
| G3-02 | Afficher le minuteur sur les trois écrans | Valeurs et instant de lecture, écart mesuré, absence de seconde horloge | pending |
| G3-03 | Couper puis rétablir le Wi-Fi Android | État hors ligne, commandes bloquées, reconnexion sans replay | pending |
| G3-04 | Arrêter/reprendre Agent sur profil de test | Une seule autorité, nouvelles observations, conservation des reçus | pending |
| G3-05 | Fermer/reprendre OBS de test | État inconnu puis frais ; anciens consentements invalidés | pending |
| G3-06 | Consulter planning et connexions | Occurrences identiques et erreurs Google/Twitch explicites | pending |
| G3-07 | Piloter une scène de test depuis Android | Réception et effet OBS concordants, aucune commande live | pending |
| G3-08 | Interrompre une réponse de commande de test | Incertain visible, même identifiant, aucune réémission automatique | pending |
| G3-09 | Vérifier sources et mixeur, VOD et sorties | Distinguer observation, commande et fonction encore indisponible | pending |
| G3-10 | Tuer puis relancer uniquement la copie Agent | Données/réservations relues, pas d’action OBS/Twitch rejouée | pending |

Consigner pour chaque ID : appareil, commit, heure, opération exacte, résultat observé, diagnostic avant/après, PASS/FAIL/skipped et motif. Un résultat manquant reste pending. Aucun accès distant au laptop ni au téléphone requis.
