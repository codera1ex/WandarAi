# WanderAI — Phase 4 Handoff Report

## 1. Files created

- `src/lib/ai/itinerary-schema.ts`
- `src/lib/ai/itinerary-types.ts`
- `src/lib/ai/itinerary-prompt.ts`
- `src/lib/ai/itinerary-validate.ts`
- `src/lib/ai/itinerary-provider.ts`
- `src/lib/ai/itinerary-config.ts`
- `src/lib/ai/itinerary-generate.ts`
- `src/lib/ai/itinerary-persist.ts`
- `src/app/api/trips/[id]/generate-itinerary/route.ts`
- `src/app/api/trips/[id]/generate-itinerary/route.test.ts`
- `supabase/migrations/0002_phase4_itinerary.sql`
- `src/lib/ai/__tests__/itinerary-validate.test.ts`
- `src/lib/ai/__tests__/itinerary-generate.test.ts`

## 2. Files modified

- `package.json` — added the Phase 4 test script and `vitest` dev dependency.
- `package-lock.json` — synchronized with the declared Vitest dependency so clean
  installs work.
- `.env.example` — added the three server-only itinerary LLM variables.
- `docs/API_CONTRACT.md` — added the Phase 4 generation endpoint, response, and error contract.
- `README_PHASE1.md` — documented Phase 4 additions.

Phase 1 implementation files were not redesigned or rewritten.

## 3. Database migrations created

### `0002_phase4_itinerary.sql`

Creates:

- `public.itinerary_days`
  - UUID primary key
  - `trip_id` FK → `public.trips(id)` with cascade
  - `day_number`
  - `date`
  - optional `theme`
  - unique `(trip_id, day_number)`
  - index on `trip_id`

- `public.itinerary_items`
  - UUID primary key
  - `itinerary_day_id` FK → `public.itinerary_days(id)` with cascade
  - `order_index`
  - `time_of_day`
  - `title`
  - `description`
  - `category`
  - unique `(itinerary_day_id, order_index)`

Both tables have RLS policies for select/insert/update/delete. Ownership is derived through the trip relationship and `auth.uid()`.

An atomic PostgreSQL function, `replace_itinerary(uuid,jsonb)`, deletes the existing itinerary and inserts the new complete itinerary in one database transaction. It explicitly verifies that the authenticated user owns the trip.

## 4. API endpoint implemented

`POST /api/trips/[id]/generate-itinerary`

Behavior:

1. Authenticate using the existing `requireUser()`.
2. Validate UUID using the existing `tripIdSchema`.
3. Fetch the trip with authenticated-user ownership filtering.
4. Reject >14 days before any LLM call.
5. Validate server-only LLM configuration.
6. Construct the exact Phase 3 prompts.
7. Call the provider abstraction.
8. Retry provider failure once after 2 seconds.
9. Parse JSON.
10. Run strict Zod validation.
11. Run semantic validation.
12. Perform exactly one repair attempt for invalid received output.
13. Revalidate repaired output.
14. Persist only after complete validation.
15. Atomically overwrite any existing itinerary.
16. Return HTTP 200 with the persisted itinerary.

## 5. LLM abstraction

`src/lib/ai/itinerary-provider.ts` defines a provider-neutral `ItineraryLLMProvider` interface.

The factory intentionally does NOT select an LLM vendor/model. The authoritative documents leave provider/model selection to the product owner. Unsupported/unregistered providers therefore produce `ITINERARY_CONFIG_ERROR`.

There is no production fake/mock itinerary provider.

## 6. Validation implemented

Structural validation uses the Phase 3 schema with strict objects:

- exact top-level fields
- exact nested fields
- required string lengths
- date format
- 14-day maximum output
- activity maximum of 8/day
- exact enums

Semantic validation checks:

- output day count equals trip duration
- day numbers are contiguous `1..N`
- dates exactly match the trip calendar
- duplicate `(title, time_of_day)` pairs are rejected within a day
- order indexes are unique and contiguous from 0
- minimum activity density: 3 for a 1-day trip, 2 for multi-day trips
- empty itinerary is impossible after schema validation

The Phase 3 >6 activity density rule remains advisory; Zod's maximum of 8 is the hard ceiling.

## 7. Retry / repair behavior

Provider failures:

- 30-second per-attempt timeout
- one retry only
- exactly 2-second delay
- maximum two provider attempts

Invalid received output:

- exactly one repair call
- repair receives the original request, invalid output, and validation error
- repaired output is fully revalidated
- no further calls after repair failure

Maximum total LLM calls: **3**.

No partial itinerary is persisted.

## 8. Authentication and security

- Existing Supabase SSR/auth infrastructure is reused.
- Client-supplied `user_id` is never trusted.
- Trip lookup is scoped to authenticated user.
- Cross-user trip IDs resolve as `TRIP_NOT_FOUND`, preserving anti-enumeration behavior.
- Itinerary tables use RLS ownership through the trip relationship.
- Atomic RPC independently verifies `auth.uid()` owns the target trip.
- LLM API key/model/provider variables are server-only and are not `NEXT_PUBLIC_*`.
- No user ID, email, authentication token, Supabase credential, or unrelated user data is sent to the model.
- No booking, live pricing, confirmed reservation, or real-time availability claims are introduced.

## 9. Tests created

Unit tests cover:

- authoritative schema acceptance
- strict unexpected-key rejection
- duplicate activity detection
- order-index validation
- repair behavior
- provider failure + retry + repair
- retry exhaustion
- three-call maximum behavior
- 14-day request rejection before configuration or generation
- fail-closed invalid output after exactly one repair attempt

The repository does not have Supabase credentials or a selected production LLM provider in this environment, so live endpoint/database integration tests cannot honestly be reported as passed.

## 10. Exact test/build execution results

### `npm ci --ignore-scripts --no-audit --no-fund`
**PASSED.** The original lockfile was out of sync with `package.json` because it
did not include Vitest; the lockfile was synchronized before this clean install.

### `npm run typecheck`
**PASSED.**

### `npm run lint`
**PASSED.**

### `npm run build`
**PASSED.** Next.js compiled the Phase 4 route and completed static page
generation.

### `npm test`
**PASSED.** 3 test files passed; 8 tests passed; 0 failed; 0 skipped.

## 11. Remaining limitations

1. The authoritative master specification intentionally leaves the LLM provider/model selection to the product owner.
2. Consequently, no real provider adapter has been selected or hardcoded.
3. The provider factory currently rejects an unregistered provider with `ITINERARY_CONFIG_ERROR`; this prevents fake production success.
4. The Phase 4 migration must be applied to the actual Supabase project before the endpoint can persist itineraries.
5. Deployment/infrastructure timeout configuration above approximately 120 seconds remains a Phase 6/Replit concern.

## 12. Files/components Gemini must use later

For Phase 5, Gemini should consume:

- `docs/API_CONTRACT.md`
- `src/lib/ai/itinerary-schema.ts` for the itinerary data shape
- the `POST /api/trips/[id]/generate-itinerary` response contract
- the persisted response IDs for activity identity

Gemini should not implement a second itinerary schema.

## 13. Things future AIs must NOT change

Without explicit product-owner approval, future AIs must not change:

- 14-day maximum
- HTTP 200 generation success
- overwrite regeneration behavior
- no `409 ITINERARY_ALREADY_EXISTS`
- 30-second provider timeout
- one provider retry
- fixed 2-second retry delay
- one output-repair attempt
- three-call maximum
- exact itinerary enums
- exact JSON schema
- Phase 4 error codes/statuses
- server-only LLM environment variable names
- RLS ownership model
- Phase 1 auth/Supabase architecture
- no frontend work in Phase 4

## 14. Recommended Phase 5

**Phase 5 — Itinerary UI + Editing + Sharing**

This is the frontend phase defined by `WANDERAI_MASTER.md`.

No Phase 5 work has been started.

## 15. Best AI for Phase 5

**Gemini**

Reason: Phase 5 is explicitly frontend-focused: itinerary rendering, editing interactions, responsive UI, and sharing UI. That matches Gemini's assigned responsibility and avoids spending ChatGPT/Claude credits on UI work.

## 16. Complete next-AI prompt

```text
You are continuing WanderAI after Phase 4.

SOURCE OF TRUTH:
1. WANDERAI_MASTER.md
2. PHASE3_AI_ITINERARY_SPEC.md
3. docs/API_CONTRACT.md
4. Existing Phase 1 + Phase 4 implementation

Phase 1 backend is approved.
Phase 3 itinerary specification is finalized.
Phase 4 backend generation endpoint has been implemented.

Your task is PHASE 5 ONLY.

Build the frontend itinerary experience:
- Render the generated itinerary returned by:
  POST /api/trips/:id/generate-itinerary
- Display trip summary, days, themes, and activities.
- Allow itinerary activity editing as specified by the product scope.
- Allow swapping/removing/reordering activities through the appropriate backend contract once available.
- Build the read-only share-link view according to the finalized backend sharing contract when that contract exists.
- Maintain responsive desktop/mobile-browser UI.
- Integrate with the existing Phase 1 authentication and trip APIs.
- Do not redesign backend architecture.
- Do not modify Supabase Auth.
- Do not change the Phase 4 itinerary schema.
- Do not change the 14-day rule.
- Do not change generation error codes.
- Do not add live pricing, bookings, payments, social features, native mobile functionality, or other out-of-scope features.

IMPORTANT:
Before changing code, inspect the existing Phase 2 frontend and the Phase 4 API contract.
If the required editing/sharing backend endpoints do not yet exist, DO NOT invent backend behavior or modify the Phase 4 generation endpoint. Clearly document the dependency/blocker instead.

Do not start Phase 6.

At the end provide:
1. Completed
2. Files created
3. Files modified
4. API endpoints consumed
5. UI/data-model integration
6. Problems/blockers
7. Tests/build results
8. Things Replit must handle in Phase 6
9. Credit optimization
10. Handoff report

Stop after Phase 5.
```

## 17. Credit optimization

Do not spend another Claude call on Phase 5.

Use **Gemini** for the frontend work because this phase directly matches its assigned responsibility.

Before Phase 6, use **Replit** for integration/runtime/deployment rather than repeatedly asking Gemini or ChatGPT to troubleshoot deployment infrastructure.

Phase 4 should remain closed unless a documented Phase 4 bug is discovered.
