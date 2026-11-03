# Le StreamCockpit 3.0 — notes préparatoires
Statut : développement 3.0.0-alpha.1 ; aucune candidate G5 publiée.

## Périmètre
Régie Twitch avec FIXE comme propriétaire OBS/minuteur, interfaces Windows et Android, santé, modération, macros, audio, planning, interactions, moments et mise à jour sûre. Les écarts détaillés de FINAL_DELIVERY_AUDIT_20261103.md doivent être fermés avant validation de cette promesse.

## Changements intégrés dans SC3-FINAL-DELIVERY-001
- ClipForge, montage et exports verticaux reportés en V4 ; personnalisation modulaire maintenue en V3.1.
- Refus explicite des routes/commandes ClipForge en production 3.0 ; code de laboratoire conservé dans Git et exclu des fichiers livrables.
- Autorisations Twitch demandant les scopes réellement utilisés par les interactions 3.0, lors de la prochaine reconnexion volontaire.
- Identité locale éphémère via l’interface Windows autorisée pour les nouvelles commandes Twitch ; aucune autorisation fondée seulement sur l’adresse loopback.
- Shield Mode et niveau global AutoMod : lecture préalable, confirmation volontaire, commande unique et résultat relu.
- Marqueurs et clips Twitch simples : prévisualisation et confirmation ; un clip accepté n’est pas présenté comme une vidéo déjà disponible. Observation dans la timeline liée, sans dépendance ClipForge.
- Chemins des anciens reçus replay retirés des projections HTTP/autonomy ; journaux hôtes conservés.
- Provenance Git et empreinte des sources préparées dans les ressources Windows et Android communes.

## Réception et migration
Les validations physiques et les signatures restent requises. Voir G3_MANUAL_RECEPTION_20261103.md et MIGRATION_ROLLBACK_3_0.md. Aucune installation, mise à jour d’une installation existante, publication ou action Twitch publique n’est autorisée par ces notes.

Compléments intégrés le 03/11 : mixeur gain/muet avec aperçu, relecture et retour manuel protégé ; banques contextuelles du Deck issues des observations de la régie et de droits appairés, suspendues en cas de source périmée. Ces circuits réutilisent le maître OBS et les reçus existants. Routage audio avancé, matériels, OAuth réel et mise à jour transactionnelle restent décrits comme incomplets dans l’audit ; ces notes ne constituent pas une annonce de release.
