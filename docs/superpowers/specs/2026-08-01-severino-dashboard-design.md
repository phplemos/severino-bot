# Design Specification: Severino Discord Bot Management Dashboard

**Date:** 2026-08-01  
**Status:** Approved  
**Location:** `dashboard/`

## 1. Overview & Goals
The **Severino Discord Bot Dashboard** is a web application designed to provide a public server leaderboard (XP, Levels, Economy Coins) and an authenticated Admin Control Panel to manage server configurations, dynamic voice channels (Hubs), user economy balances, and moderation warning logs.

---

## 2. Architecture & Tech Stack

- **Framework**: Next.js 14/15 (App Router) located in `dashboard/` directory.
- **Database**: Shared SQLite database (`prisma/dev.db`) accessed via Prisma Client (`@prisma/client`).
- **Authentication**: Auth.js / NextAuth v5 with **Discord OAuth2 Provider** (`identify`, `guilds` scopes).
- **Styling**: Tailwind CSS + Lucide React Icons.
- **State & Actions**: Next.js Server Components, React Server Actions, and client-side modal states.

---

## 3. Directory Structure

```
severino-discord-bot/
├── prisma/
│   └── schema.prisma                  # Shared Database Schema
├── src/                               # Discord Bot Source
└── dashboard/                         # Next.js Web Dashboard
    ├── package.json
    ├── tailwind.config.ts
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx              # Root layout & providers
    │   │   ├── page.tsx                # Public Leaderboard & Landing
    │   │   ├── admin/
    │   │   │   ├── layout.tsx          # Admin layout with Sidebar & Auth Guard
    │   │   │   ├── page.tsx            # Admin Overview & Bot Stats
    │   │   │   ├── hubs/page.tsx       # Dynamic Voice Channel Hub Manager
    │   │   │   ├── users/page.tsx      # User Economy & XP Editor
    │   │   │   └── warnings/page.tsx   # Moderation Warning Logs
    │   │   └── api/
    │   │       └── auth/[...nextauth]/route.ts # NextAuth Discord OAuth handlers
    │   ├── components/                 # UI Components (Sidebar, Navbar, Modals, Tables)
    │   └── lib/
    │       ├── db.ts                   # Prisma client singleton pointing to dev.db
    │       └── auth.ts                 # Auth.js configuration & admin permission helpers
```

---

## 4. Feature Specifications

### 4.1 Public Leaderboard (`/`)
- **Hero Section**: Displays overall server metrics (Total Members registered in economy, Total Coins in circulation, Server Level Leader).
- **Leaderboard Table**:
  - Tab toggle: **Top XP / Level** vs **Top Coins**.
  - Rank badges for top 3 (Gold 🥇, Silver 🥈, Bronze 🥉).
  - Columns: Rank, Avatar, Username, Level, XP, Coins, Last Daily claim date.
  - Search bar for quick member search.

### 4.2 Auth & Role-Based Access Control (`/admin/*`)
- **Login**: Discord OAuth2 via `Sign in with Discord`.
- **Admin Verification**:
  - Middleware / Server Layout checks if the authenticated user has Discord `Administrator` or `Manage Guild` permissions (or matches designated Bot Owner ID / Guild ID).
  - Unauthenticated or non-admin users attempting to access `/admin` receive an access denied state.

### 4.3 Admin Features
1. **Dashboard Overview (`/admin`)**:
   - Metrics cards: Active Voice Hubs count, Total Users, Total Coins, Total Warnings logged.
   - Quick navigation shortcuts.
2. **Dynamic Voice Hubs Manager (`/admin/hubs`)**:
   - Table of configured Hub Channels (`HubChannel` model).
   - Modal/Form to set up a new Hub channel with ID, Guild ID, and template name (e.g. `🏠 {user}'s Room`).
   - Ability to edit or delete Hub channels.
3. **User Economy & Level Editor (`/admin/users`)**:
   - Paginated, searchable list of users (`User` model).
   - Action modal to edit Coins balance, update XP, or reset daily claim status.
4. **Moderation Warnings Log (`/admin/warnings`)**:
   - Table of recorded warnings (`Warning` model) with User ID, Moderator ID, Reason, and Timestamp.

---

## 5. Design System & Aesthetics
- **Theme**: Dark mode palette (`#0F172A` background, slate/zinc surfaces, `#5865F2` Discord brand purple accents).
- **Visuals**: Modern glassmorphic cards, crisp typography, clean data tables, smooth micro-animations, and status indicators.
