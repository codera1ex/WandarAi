# WanderAI — Phase 1 Backend Foundation

Phase 1 implements the backend foundation only, per WANDERAI_MASTER.md.

## Stack
- Next.js Route Handlers
- Supabase Auth
- Supabase PostgreSQL
- PostgreSQL Row Level Security
- Zod validation

## Setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Set:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY
4. Apply `supabase/migrations/0001_phase1_foundation.sql` in Supabase SQL Editor or through Supabase migrations.
5. Install dependencies with `npm install`.
6. Run `npm run typecheck` and `npm run build`.

## Important

The public `profiles` table is intentionally linked to `auth.users`. Supabase Auth remains the source of identity. Do not create a second independent authentication users table.

The service-role key is not required by these Route Handlers and must never be exposed to the browser.

No frontend or Phase 2 functionality is included.
