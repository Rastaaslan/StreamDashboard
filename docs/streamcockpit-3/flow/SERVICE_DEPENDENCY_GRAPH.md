# Dépendances vérifiées dans les sources

Les arêtes correspondent à SERVICE_FLOW_DETAILS.json. Android local est un choix explicite indépendant ; les effets de régie restent sur FIXE.

```mermaid
flowchart TB
  A["Android appairé"] --> P["API FIXE"]
  L["Windows laptop"] --> P
  W["Interface Windows FIXE"] --> P
  P --> O["OBS FIXE"]
  P --> T["Twitch Helix"]
  P --> S["Planning et journaux"]
  E["Twitch EventSub"] --> P
  G["Google Calendar"] <--> P
  C["Compte Android explicite"] --> I["IRC et Helix Twitch"]
```

Autres intégrations FIXE : Streamlabs Socket.IO alimente le feed et les moments ; Discord REST et WizeBot utilisent des actions explicites ; Spotify utilise le lecteur Windows local. Soundboard, mixeur et replay de régie restent des effets FIXE. Aucun diagramme ne prétend montrer une connexion matérielle constatée dans ce lot.
