# Use Server Display Name in Hub Voice Channels Design

## Overview
When a user joins a Hub voice channel, the bot creates a temporary voice channel named using a template (`hubConfig.templateName`, defaulting to `"🏠 {user}'s Room"`). Currently, the bot uses `member.user.username` for `{user}`, which inserts the global Discord account username (e.g. `p20ium`) rather than the user's server nickname/display name (e.g. `Vitin`).

This design updates the channel creation logic to use `member.displayName`.

## Proposed Changes

### `src/listeners/voiceStateUpdate.ts`
- Update the `{user}` placeholder replacement logic to use `member.displayName`.
- `member.displayName` returns the guild nickname if set, falling back to global display name or username.

```typescript
const channelName = hubConfig.templateName.replace('{user}', member.displayName);
```

## Verification
- Run `pnpm build` to verify TypeScript compilation.
- Join a Hub channel with a user that has a server nickname and verify the temporary channel uses the server display name.
