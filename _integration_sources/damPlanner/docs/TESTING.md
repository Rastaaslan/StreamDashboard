# Tests

- `pnpm test` : domaine, dates, DST, conflits.
- `pnpm test:integration` : fake Google/Twitch, succès partiel, retry, offline, activation/désactivation et réconciliation.
- `pnpm test:e2e` : navigateur mocké LIVE Google+Twitch, PERSONAL Google, conflit forcé et suppression.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, ou tout via `pnpm check`.

`FakeGoogleCalendarProvider`, `FakeTwitchScheduleProvider` et `FakeSecureTokenStore` interdisent toute dépendance à de vrais comptes. Les API réelles doivent être couvertes exclusivement par le smoke test manuel avec un compte de test.
