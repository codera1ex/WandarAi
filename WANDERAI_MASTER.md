# WANDERAI — MASTER PROJECT SPECIFICATION
**Status:** Source of truth. Do not contradict silently — flag conflicts before changing.
**Version:** 1.0 (initial blueprint, pre-implementation)
**Owner:** Product owner (human)
**Maintained via:** Multi-AI workflow (Claude / ChatGPT / Gemini / Replit)

---

## 1. PRODUCT VISION

WanderAI is a travel platform that uses AI to generate and manage personalized trip itineraries. Core value proposition: a user describes a trip (destination, dates, budget, interests, constraints) and receives an AI-generated itinerary they can view, edit, save, and share.

### 1.1 Primary user
A traveler planning a trip who wants a fast, personalized itinerary without manually researching every activity.

### 1.2 Core loop
1. User signs up / logs in
2. User creates a trip (destination, dates, preferences)
3. AI generates a day-by-day itinerary
4. User views, edits, and saves the itinerary
5. User can revisit, duplicate, or share past trips

Everything in v1 exists to support this loop. Anything else is deferred to a later version.

---

## 2. V1 FEATURE SCOPE (in) vs OUT OF SCOPE

### In scope for v1
- Email/password authentication
- Trip creation form (destination, dates, budget tier, interests, travel style, group size)
- AI-generated day-by-day itinerary (activities, rough timing, brief descriptions)
- Ability to view saved trips (dashboard/list)
- Ability to edit an itinerary (swap/remove/reorder activities)
- Basic trip sharing via a read-only link
- Responsive web UI (desktop + mobile browser)

### Explicitly out of scope for v1 (future versions)
- Real-time flight/hotel booking or payment processing
- Live pricing from third-party travel APIs
- Social features (following users, public feeds)
- Native mobile apps
- Multi-language support
- Collaborative real-time trip editing (multiple users editing at once)
- Offline mode

Keeping this list explicit prevents scope creep across AI handoffs — any AI proposing an out-of-scope feature must flag it and wait for approval rather than building it.

---

## 3. SYSTEM ARCHITECTURE (HIGH LEVEL)

```
[ Frontend (React/Next.js) ]
        |
        | REST/HTTPS
        v
[ Backend API (Node/Express or Next.js API routes) ]
        |
        |--- Auth: Supabase Auth
        |--- Database: Supabase (Postgres)
        |--- AI Service: Itinerary generation module (calls LLM API)
        |
        v
[ Supabase (Postgres + Auth + Storage) ]
```

**Stack decisions (defaults — confirm before deviating):**
- Frontend: React (Next.js) — chosen for SSR support and wide AI-tool familiarity, minimizing ramp-up cost for Gemini/Replit
- Backend: Node.js, either Next.js API routes or a thin Express layer — kept simple to reduce integration surface area
- Database/Auth: Supabase — bundles Postgres + Auth + Storage, reducing the number of services other AIs need to wire together
- AI itinerary generation: a dedicated backend module/service, isolated from other business logic, so its prompt/logic can be revised without touching unrelated code

This stack was chosen specifically to minimize integration complexity for Replit and API/auth complexity for ChatGPT — not because it's the most powerful option available.

---

## 4. DATA MODEL (CONCEPTUAL — NOT FINAL SCHEMA)

This is a conceptual model. ChatGPT will finalize actual Supabase schema/migrations in its phase, and must document any deviation from this concept.

- **users**: id, email, display_name, created_at
- **trips**: id, user_id, destination, start_date, end_date, budget_tier, interests[], travel_style, group_size, created_at, updated_at
- **itinerary_days**: id, trip_id, day_number, date
- **itinerary_items**: id, itinerary_day_id, order_index, title, description, time_of_day, category
- **share_links**: id, trip_id, token, created_at, expires_at (nullable)

---

## 5. AI ITINERARY GENERATION — LOGIC OWNERSHIP

This is Claude's core technical responsibility and the most complex/differentiated part of the product.

Conceptual flow:
1. Backend collects trip input (destination, dates, interests, budget, style, group size)
2. Input is formatted into a structured prompt
3. LLM call returns a structured itinerary (day-by-day, activities with title/description/time-of-day/category)
4. Backend validates/parses the response into the itinerary_days / itinerary_items shape
5. Result is persisted and returned to frontend

Claude owns: prompt design, output structure/schema, validation logic, edge-case handling (e.g., vague input, conflicting constraints, unsupported destinations). ChatGPT owns: wiring this logic into an actual API endpoint, error handling at the API layer, and connecting it to the database.

---

## 6. PHASE BREAKDOWN & AI ASSIGNMENT

Each phase is scoped to one AI's core strength, minimizes cross-AI back-and-forth, and produces a clean, documented handoff. Phases are sequential; do not skip ahead without approval.

### Phase 0 — Master Planning (this document)
- **Owner:** Claude
- **Output:** This blueprint, phase breakdown, data model, architecture decisions
- **Status:** Complete (this document)

### Phase 1 — Backend Foundation: Auth + Core Schema
- **Owner:** ChatGPT
- **Scope:** Set up Supabase project structure, implement users/trips tables, email/password auth, basic CRUD API endpoints for trips (create/read/update/delete)
- **Why ChatGPT:** This is standard API/database/auth wiring — ChatGPT's core strength — with no AI-itinerary complexity yet. Doing it before frontend work avoids Gemini building UI against a moving API contract.
- **Explicitly excluded:** No AI itinerary logic yet, no frontend

### Phase 2 — Frontend Foundation: Core Screens
- **Owner:** Gemini
- **Scope:** Auth screens (login/signup), trip creation form, trip dashboard/list, responsive layout shell, component structure — wired against the Phase 1 API contract
- **Why Gemini:** Pure UI/frontend implementation against an already-defined API, no backend logic needed
- **Explicitly excluded:** No itinerary display yet (itinerary shape isn't finalized until Phase 3)

### Phase 3 — AI Itinerary Generation Logic
- **Owner:** Claude
- **Scope:** Design the itinerary generation prompt/logic, define the exact output schema, handle edge cases and validation rules, specify the exact request/response contract for the API endpoint
- **Why Claude:** This is the differentiated, complex logic — not routine API work
- **Explicitly excluded:** No actual endpoint wiring or DB writes (handed to ChatGPT next)

### Phase 4 — Itinerary API Integration
- **Owner:** ChatGPT
- **Scope:** Build the actual `/trips/:id/generate-itinerary` endpoint using Claude's Phase 3 logic/contract, persist results to itinerary_days/itinerary_items, add error handling
- **Why ChatGPT:** Mechanical integration of already-designed logic into the existing API — no new architectural decisions needed
- **Explicitly excluded:** No frontend rendering

### Phase 5 — Itinerary UI + Editing + Sharing
- **Owner:** Gemini
- **Scope:** Render the generated itinerary, allow reorder/edit/remove of items, implement the read-only share-link view, visual polish across all screens
- **Why Gemini:** Pure frontend work against a now-finalized API and data shape

### Phase 6 — Integration, Environment Config & Deployment
- **Owner:** Replit
- **Scope:** Combine all modules, resolve dependency/environment conflicts, configure env vars, run full build/runtime tests, deploy
- **Why Replit:** This is exactly Replit's role — nothing here is net-new logic, it's making already-built pieces run together

### Phase 7 — Security & Code Review Pass
- **Owner:** ChatGPT
- **Scope:** Audit auth flows, input validation, API security, review code from all prior phases before/after deployment
- **Why ChatGPT:** Review/audit is an explicit ChatGPT strength; doing this as a final pass (not per-phase) minimizes redundant review credits

**Credit optimization note:** Phases are ordered so no AI has to guess at another's not-yet-built interface for long — each phase either finalizes a contract (Phase 1, Phase 3) or consumes an already-finalized one (Phase 2, 4, 5). This avoids rework, which is the main hidden credit cost in multi-AI workflows.

---

## 7. INTEGRATION CONTRACTS (TO BE FINALIZED, NOT ASSUMED)

Each phase must produce and document its outward-facing contract before the next phase starts:
- Phase 1 → API endpoint list + request/response shapes for trips/auth
- Phase 3 → itinerary generation request/response schema
- All phases → env vars required, dependencies added, files created/modified/must-remain-unchanged

No phase should require re-opening a prior phase's files except to fix a documented bug.

---

## 8. OPEN QUESTIONS (FOR PRODUCT OWNER, NOT TO BE DECIDED UNILATERALLY BY ANY AI)

- Which LLM/API will power itinerary generation (cost/quality tradeoff)?
- Is a free tier / paid tier distinction needed in v1, or added later?
- Any specific destinations/regions to prioritize or exclude at launch?
- Target browsers/devices for the "responsive" requirement?

---

# HANDOFF REPORT

**1. COMPLETED**
Full master product/technical blueprint for WanderAI: product vision, v1 scope boundaries, high-level architecture, conceptual data model, ownership of AI itinerary logic, and a 7-phase breakdown with AI assignment and rationale for each.

**2. FILES**
- Created: `WANDERAI_MASTER.md` (this document)
- Modified: none
- Removed: none

**3. TECHNICAL CHANGES**
None yet — this phase is planning only. No dependencies, APIs, env vars, or database changes were implemented.

**4. PROBLEMS**
- No existing code was reviewed (none provided) — this blueprint is based purely on the concept and workflow doc. If existing code already exists, it must be checked against this spec before Phase 1 starts.
- Stack choices (Next.js/Supabase) are defaults chosen to minimize integration overhead — not yet confirmed by the product owner.
- Open questions in Section 8 are unresolved and could affect Phase 1 scope (e.g., tiering affects the users/trips schema).

**5. NEXT PHASE**
Phase 1 — Backend Foundation: Auth + Core Schema (Supabase setup, users/trips tables, auth, basic trip CRUD endpoints).

**6. BEST AI FOR NEXT PHASE**
**ChatGPT.** Phase 1 is standard API/database/auth wiring with no complex AI logic or UI work involved — ChatGPT's core strength, and lower-cost than using Claude for routine CRUD/auth implementation.

**7. NEXT-AI PROMPT**

```
You are continuing work on WanderAI, a travel platform being built across multiple AI
assistants (Claude = planning/complex logic, ChatGPT = APIs/backend/review, Gemini =
frontend, Replit = integration/deployment). Treat the attached WANDERAI_MASTER.md as
the single source of truth — do not contradict it silently; flag any conflict first.

Your task (Phase 1 only — do not start Phase 2):
Build the backend foundation:
- Set up Supabase project structure (Postgres + Auth)
- Implement the `users` and `trips` tables per Section 4 of the master spec
  (conceptual model — finalize actual schema/migrations yourself and document any
  deviation from the concept)
- Implement email/password authentication via Supabase Auth
- Implement basic CRUD API endpoints for trips: create, read (single + list), update, delete
- Do NOT implement AI itinerary generation yet (that's Phase 3/4, owned by Claude then ChatGPT)
- Do NOT build any frontend

At the end, provide a full handoff report (completed, files created/modified, technical
changes — dependencies/APIs/env vars/DB changes, problems/bugs/security concerns, next
phase recommendation, best AI for next phase with reasoning, a copy-paste prompt for
that AI, and credit optimization guidance). Do not proceed into Phase 2 automatically —
stop and wait for explicit instruction.
```

**8. CREDIT OPTIMIZATION**
This task should go to ChatGPT, not stay with Claude — Phase 1 is routine implementation work with no architectural ambiguity left to resolve. Do not split it further; auth + core schema + basic CRUD is small enough to be one clean, self-contained handoff. Wait until Phase 1 is complete before starting Phase 2 (Gemini) — Phase 2 depends on the finalized API contract from Phase 1.
