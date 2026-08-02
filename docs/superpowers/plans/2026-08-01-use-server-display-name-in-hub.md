# Use Server Display Name in Hub Voice Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the user's server display name (`member.displayName`) instead of global username (`member.user.username`) when generating temporary voice channel names from Hub templates.

**Architecture:** Update `voiceStateUpdate` listener in `src/listeners/voiceStateUpdate.ts` so that when a temporary voice channel is spawned from a Hub, `{user}` in the template string is replaced by `member.displayName`.

**Tech Stack:** TypeScript, Sapphire Framework, Discord.js v14.

## Global Constraints
- Replace `member.user.username` with `member.displayName` in `src/listeners/voiceStateUpdate.ts`.

---

### Task 1: Update voiceStateUpdate listener to use member.displayName

**Files:**
- Modify: `src/listeners/voiceStateUpdate.ts:38-41`

**Interfaces:**
- Consumes: `member.displayName` from Discord.js `GuildMember`
- Produces: Updated temporary channel name string

- [ ] **Step 1: Modify `src/listeners/voiceStateUpdate.ts`**

Change line 39 in `src/listeners/voiceStateUpdate.ts`:
```typescript
const channelName = hubConfig.templateName.replace('{user}', member.displayName);
```

- [ ] **Step 2: Run build to verify TypeScript compilation**

Run: `pnpm build`
Expected: `$ tsc` exits with code 0

- [ ] **Step 3: Verification**

Run `pnpm build` and verify code builds cleanly without errors.
