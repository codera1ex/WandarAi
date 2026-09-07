# WANDERAI — PHASE 3: AI ITINERARY GENERATION SPECIFICATION
**Status:** FINALIZED — specification only. Nothing in this document has been implemented.
**Revision:** v2 (finalization pass — resolves all V1 product decisions except the one WANDERAI_MASTER.md explicitly reserves for the product owner; see §8)
**Owner:** Claude (per WANDERAI_MASTER.md §5 — Claude owns prompt design, output schema, validation logic, edge-case handling)
**Depends on:** Phase 1 (verified — trips table, auth, RLS), NOT on Phase 2 frontend
**Consumed by:** ChatGPT in Phase 4 (endpoint wiring), Gemini in Phase 5 (rendering)

This document does not modify, depend on, or assume anything about the Phase 2 frontend. It treats Phase 1's `trips` table and `docs/API_CONTRACT.md` as the only existing source of truth, per WANDERAI_MASTER.md §2 (AI itinerary generation is in-scope for v1; live third-party pricing/booking is explicitly out of scope, which bounds what this spec is allowed to promise).

---

## 1. AI ITINERARY GENERATION ARCHITECTURE

### 1.1 Data flow

```
[ trips row (Phase 1, already stored) ]
        |
        | ChatGPT's Phase 4 endpoint reads the trip by id + user_id (RLS-scoped)
        v
[ Prompt Builder ]  -- pure function: trip fields -> {system_prompt, user_prompt}
        |
        v
[ LLM call ]  (provider/model: sole remaining OPEN DECISION — see §8; call config
              read from env vars WANDERAI_ITINERARY_LLM_PROVIDER / _MODEL / _API_KEY,
              see §2.7. Up to 2 attempts total on provider failure, §1.3/§1.4a)
        |
        v
[ Raw model output (expected: JSON text) ]
        |
        v
[ Schema Validator ]  -- Zod parse against the schema in §3
        |
   pass |  fail -> [ Repair/Retry step, §1.4b ] -- still fails -> [ Error contract, §6 ]
        v
[ Semantic Validator ]  -- business-rule checks from §4 that Zod can't express
        |
   pass |  fail -> reject, same error path as above
        v
[ Persist to itinerary_days / itinerary_items (Phase 4, §7) ]
        |
        v
[ Return itinerary in the Phase 4 response shape, §6 ]
```

### 1.2 Trip data used as input

Only fields that already exist on the Phase 1 `trips` row are used — nothing is invented:

| Trip field | Used for |
|---|---|
| `destination` | Where the itinerary is set; drives activity selection and pacing assumptions (see §2.5 for vague/unsupported destinations) |
| `start_date`, `end_date` | Trip length in days → number of `itinerary_days` generated (inclusive range) |
| `budget_tier` (`budget`\|`mid-range`\|`luxury`) | Shapes the *character* of suggested activities/venues (see §2.3) — never a real-time price, since live pricing is out of scope per WANDERAI_MASTER.md §2 |
| `interests` (string array, may be empty) | Weights activity category selection (see §2.3) |
| `travel_style` (free string, 1–100 chars) | Shapes pacing/activity density (see §2.3) |
| `group_size` (1–50) | Shapes activity *type* suitability (e.g. large groups → fewer intimate/small-capacity venues), never a literal headcount check against real venues |

No other data is sent to the model — no `user_id`, no email, no auth tokens, no other users' trips. The prompt builder receives only the seven fields above, so a prompt injection embedded in `destination` or `interests` (free text fields) cannot pull in unrelated context because there is no other context in the prompt to pull.

### 1.3 Generation failure handling (architecture level) — FINALIZED

Two independent failure classes, each with its own single-retry ceiling. They are independent mechanisms and can both fire in the same request (worst case: one provider retry, then one output-repair attempt — see the worked example at the end of this section):

1. **Provider failure** (timeout, 5xx, rate limit, network error). **Finalized V1 policy:**
   - Per-attempt timeout: **30 seconds**.
   - On timeout or any provider-level error (5xx, rate limit, network error): **1 retry** (2 attempts total), with a **fixed 2-second delay** before the retry. No exponential backoff in V1 — a fixed delay is sufficient given the low retry ceiling and keeps the implementation simple, consistent with WANDERAI_MASTER.md's stated priority of minimizing integration complexity.
   - If both attempts fail: return `ITINERARY_GENERATION_FAILED` (502) — see §6.6. No further retries.
   - This retry is scoped purely to *provider-level* failure (the call itself didn't complete or errored) — it is separate from and unaffected by output validation, which only applies once a response is actually received.
2. **Malformed/invalid output** (bad JSON, fails schema, fails semantic rules) → exactly **one** automated repair attempt is allowed (§1.4b), then fail closed with `ITINERARY_INVALID_OUTPUT` (502).
3. **Partial/truncated output** (valid JSON prefix, incomplete structure — e.g. cut off mid-array) → treated identically to malformed output (class 2 above); no partial acceptance, no partial persistence (§4.12).

In all cases, nothing is written to `itinerary_days`/`itinerary_items` unless the full itinerary passes both Zod schema validation and semantic validation. There is no partial-save path.

**Worst-case call count and latency budget:** attempt 1 (provider timeout, 30s) → attempt 2 after 2s delay (succeeds but produces invalid output) → repair attempt (succeeds). That's up to 3 total LLM calls and roughly 30s + 2s + 30s + 30s ≈ 92s worst-case wall-clock time for a single synchronous request. Phase 4 should set any surrounding HTTP/proxy timeout (e.g. a reverse proxy or serverless function timeout) to comfortably exceed **120 seconds** to avoid the infrastructure layer cutting off a request that Phase 3's own logic would have completed successfully.

### 1.4a Provider-failure retry

Identical request, same prompt, no modification — this is a plain retry, not a repair. Only applies when the provider call itself failed (timeout / 5xx / rate limit / network error), never when a response was successfully received (even an invalid one — that's §1.4b's job).

### 1.4b Output-repair retry

If a model response is successfully received but fails validation, the pipeline may make **exactly one** follow-up call that:
- Includes the original user prompt
- Includes the invalid output that was returned
- Includes the specific Zod/semantic error(s) produced
- Asks the model to return a corrected JSON object only, no prose

If this repair attempt also fails validation, the pipeline stops and returns `ITINERARY_INVALID_OUTPUT` (§6.6). This one-repair ceiling is a Phase 3 rule ChatGPT must implement as-is in Phase 4 — it is not an open decision, since uncontrolled retries would create unpredictable cost/latency, which conflicts with WANDERAI_MASTER.md's stated goal of minimizing integration/cost complexity.

### 1.5 Output validation before acceptance

Two layers, both mandatory, both must pass before persistence:
- **Structural** — Zod parse against §3's schema. Catches type errors, missing required fields, wrong enum values, malformed dates.
- **Semantic** — business rules Zod cannot express (§4): day count matches trip length, no duplicate activities in a day, activities stay within trip dates, activity density is within pace-appropriate bounds, no empty itinerary.

---

## 2. PROMPT ENGINEERING

### 2.1 System prompt structure

The system prompt is static (does not change per trip) and establishes role, output contract, and hard constraints. Exact text:

```
You are WanderAI's itinerary generation engine. You generate realistic, day-by-day
travel itineraries based on structured trip data.

OUTPUT CONTRACT:
- Respond with a single JSON object and nothing else — no prose, no markdown code
  fences, no explanation before or after the JSON.
- The JSON must conform exactly to the schema you are given. Do not add fields that
  are not in the schema. Do not omit required fields.
- Every activity you invent must be a plausible real category of thing to do at the
  destination (e.g. "visit a local market", "guided walking tour of the old town") —
  do not fabricate specific business names, exact prices, exact opening hours, or
  claims of real-time availability. You are not booking anything and must not imply
  that anything has been booked or reserved.
- Do not generate content unrelated to travel activities for the given destination.

SCHEDULING RULES:
- Produce exactly one itinerary day per calendar day of the trip, inclusive of both
  the start and end date.
- Order activities within a day in a realistic sequence (e.g. morning activities
  before evening ones; do not schedule two full-day activities in the same day).
- Respect realistic travel pace: do not schedule more activities in a day than a
  real traveler could plausibly complete, accounting for meals, rest, and transit
  between activities.
- Do not schedule activities that would require impossible travel (e.g. two
  activities in different cities on the same day) unless the destination input
  itself names a multi-city route.
- If the requested trip is very short (1 day), prioritize the highest-value/most
  iconic activities only. If the trip is long, vary activity categories across days
  rather than repeating the same category every day.
- If input fields are vague or unusual, make the most reasonable realistic
  interpretation and proceed — do not refuse to generate output.
```

### 2.2 User prompt template

The user prompt is generated per request by interpolating the trip's own fields — nothing else:

```
Generate a travel itinerary with the following trip details:

Destination: {{destination}}
Start date: {{start_date}}
End date: {{end_date}}
Number of days: {{computed_day_count}}
Budget tier: {{budget_tier}}
Travel style: {{travel_style}}
Group size: {{group_size}}
Interests: {{interests_joined_or_"none specified"}}

Return the itinerary as a single JSON object matching the required schema, covering
every day from {{start_date}} to {{end_date}} inclusive.
```

`computed_day_count` is derived server-side (`end_date - start_date + 1`), never left for the model to compute, to avoid off-by-one drift between the prompt and the schema's expected day count (used in semantic validation, §4.6).

### 2.3 How each field affects generation

| Field | Effect |
|---|---|
| `destination` | Primary driver of activity content. See §2.5 for vague/unsupported handling. |
| `start_date`/`end_date` | Drive `computed_day_count`, which is both told to the model and independently enforced in semantic validation (§4.6) — the model's own day count is never trusted alone. |
| `budget_tier` | `budget` → free/low-cost, self-guided activity categories emphasized (parks, walking areas, public sights). `mid-range` → mix of paid and free. `luxury` → higher-end categories (guided/private experiences, fine dining categories) — but never a specific real price or vendor. |
| `interests` | Used to weight `category` selection (§3.4) toward matching values where plausible for the destination; if an interest has no plausible match at the destination, the model should substitute the closest realistic alternative rather than force it in. |
| `travel_style` | Free string (per Phase 1's `travel_style` field — no fixed enum exists at the DB layer). The system prompt's "realistic pace" rule is the primary density constraint; `travel_style` is treated as a *modifier* rather than an override — e.g. a style suggesting "relaxed" should land on the lower end of the density bounds in §4.7; a style suggesting "packed"/"fast-paced" should land on the higher end, but never exceed the caps in §4.7 regardless of what the string says. |
| `group_size` | 1 → include some solo-friendly categories permitted; large (e.g. >10) → deprioritize categories implying small/intimate capacity. This is a soft weighting, not a hard filter, since Phase 3 has no real venue-capacity data. |

### 2.4 Rules for short vs. long trips

- **1-day trip (`start_date == end_date`):** exactly 1 itinerary day, lower activity count (see §4.7's per-day cap), highest-priority/iconic activities only, per the system prompt.
- **Short trips (2–3 days):** avoid repeating the same `category` on consecutive days where a destination plausibly offers variety.
- **Long trips:** V1 supports trip durations of **1–14 days inclusive** (finalized, §5.3/§5.5). For any trip in this range, categories must vary across the trip rather than looping identically; this is a semantic-validation soft check (warn-level, not reject-level — see §4 table) since "enough variety" isn't strictly machine-checkable. Trips requesting more than 14 days are rejected before the model is ever called (§6.4a) — the model is never asked to generate more than 14 days of content.

### 2.5 Vague or unusual destination input

- Phase 1 only constrains `destination` to a 1–200 character non-empty string — there is no destination allowlist or geocoding at any layer.
- If `destination` is vague (e.g. "somewhere warm," "Europe"), the model should pick one concrete, reasonable real place matching the description and generate for that place — it must not ask a clarifying question, since Phase 3 has no mechanism for back-and-forth (this is a single-shot generation, not a conversation).
- If `destination` is nonsensical or not a real place (e.g. random characters, "Narnia"), this is **not** rejected at the prompt-input level. **FINALIZED: V1 does not pre-filter or validate destinations against any places/geocoding service before calling the model.** Phase 1's existing 1–200 character non-empty-string validation is the only input-side check, and this spec deliberately does not add a stricter one — introducing an external geocoding/places API would add a new third-party dependency, cost, and failure mode that WANDERAI_MASTER.md never calls for and that isn't required to satisfy any stated v1 feature. Instead, the *model's output* is what gets validated: if the model cannot produce a coherent itinerary and instead returns non-conforming output, that is caught by structural/semantic validation same as any other bad output (§4), and surfaces as `ITINERARY_INVALID_OUTPUT` (§6.6) — this spec does not special-case "bad destination" as its own error code, since Phase 3 has no ground truth to detect it before calling the model.

### 2.6 No invented product features

This spec does not introduce booking, payments, live pricing, real vendor names, multi-language output, or social features — all explicitly out of scope per WANDERAI_MASTER.md §2. Every activity in the schema (§3) is descriptive text, not a bookable entity.

### 2.7 LLM configuration — environment variables (FINALIZED naming; provider choice remains open, §8)

Regardless of which provider/model the product owner selects (§8), Phase 4 must read the call configuration from environment variables rather than hardcoding it — the same posture Phase 1 already uses for Supabase config (`getSupabasePublicEnv()` in `src/lib/supabase/config.ts`). Finalized variable names:

| Env var | Purpose | Exposed to client? |
|---|---|---|
| `WANDERAI_ITINERARY_LLM_API_KEY` | Secret API key for the chosen provider | **No** — server-only, must never be `NEXT_PUBLIC_`-prefixed, must never be logged or returned in any response |
| `WANDERAI_ITINERARY_LLM_MODEL` | Model identifier string (e.g. a specific model name) | No |
| `WANDERAI_ITINERARY_LLM_PROVIDER` | Which provider's SDK/endpoint to use, if Phase 4's implementation supports more than one | No |

This resolves the *configuration surface* so ChatGPT can build the integration (config loading, error handling for missing config — mirroring Phase 1's `SupabaseConfigurationError` → `503 SUPABASE_CONFIG_ERROR` pattern, applied here as `503 ITINERARY_CONFIG_ERROR`, see §6.6) without being blocked on the actual provider decision. Only the *values* of `WANDERAI_ITINERARY_LLM_MODEL`/`_PROVIDER` depend on §8's outstanding decision — the variable names, loading pattern, and error behavior are finalized now.

---

## 3. EXACT AI OUTPUT JSON SCHEMA

Top-level object the model must return, and ChatGPT must Zod-parse in Phase 4:

```jsonc
{
  "trip_summary": "string, 1-500 chars",
  "days": [
    {
      "day_number": 1,
      "date": "2026-10-01",
      "theme": "string, 1-150 chars, optional",
      "activities": [
        {
          "order_index": 0,
          "time_of_day": "morning",
          "title": "string, 1-150 chars",
          "description": "string, 1-500 chars",
          "category": "sightseeing"
        }
      ]
    }
  ]
}
```

### 3.1 Zod schema (authoritative — this is what Phase 4 implements verbatim)

```typescript
import { z } from "zod";

export const timeOfDaySchema = z.enum([
  "morning",
  "afternoon",
  "evening",
  "night"
]);

export const activityCategorySchema = z.enum([
  "sightseeing",
  "food",
  "nature_outdoors",
  "culture_history",
  "relaxation",
  "shopping",
  "nightlife",
  "adventure",
  "transit_logistics"
]);

export const itineraryActivitySchema = z.object({
  order_index: z.number().int().min(0),
  time_of_day: timeOfDaySchema,
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().min(1).max(500),
  category: activityCategorySchema
});

export const itineraryDaySchema = z.object({
  day_number: z.number().int().min(1),
  date: z.string().date(),
  theme: z.string().trim().min(1).max(150).optional(),
  activities: z.array(itineraryActivitySchema).min(1).max(8)
});

export const itineraryOutputSchema = z.object({
  trip_summary: z.string().trim().min(1).max(500),
  days: z.array(itineraryDaySchema).min(1).max(14)
});

export type ItineraryOutput = z.infer<typeof itineraryOutputSchema>;
```

### 3.2 Field notes

- **No `id` fields in the AI output.** IDs (UUIDs) are generated by the database on insert (Phase 4), consistent with how Phase 1 already handles `trips.id` (`gen_random_uuid()` default) — the model never invents primary keys.
- **`day_number`** is 1-indexed and must be contiguous starting at 1 (enforced in semantic validation, §4.6) — Zod alone can't check contiguity across array elements, hence it's listed under §4, not just §3.
- **`date`** uses the same `z.string().date()` format Phase 1 already uses for `trips.start_date`/`end_date`, for consistency across the codebase.
- **`order_index`** is 0-indexed per day (not global across the trip), mirroring the `order_index` pattern already named in WANDERAI_MASTER.md §4's conceptual `itinerary_items` model.
- **`theme`** is optional — not every day needs a one-line label.
- **`activities` cap of 8 per day and `days` cap of 14** are hard ceilings enforced directly in the schema. The `days` cap of 14 is not an independent safety margin above some larger product limit — it **is** the finalized V1 maximum trip duration (§5.3/§5.5/§6.4a), so there is exactly one number to keep in sync across the schema, the request-time rejection check, and the database, not two.
- **`category` enum** (9 values) is Claude's proposed taxonomy per WANDERAI_MASTER.md §5 ("Claude owns... output structure/schema"). This enum does not exist yet anywhere in Phase 1 and must be introduced in Phase 4 as net-new (§7).

---

## 4. VALIDATION RULES

Two-layer validation, applied by ChatGPT in Phase 4, in this exact order:

| # | Check | Layer | On failure |
|---|---|---|---|
| 4.1 | Response is valid JSON | Structural | Reject → repair attempt (§1.4b) → `ITINERARY_INVALID_OUTPUT` |
| 4.2 | Matches `itineraryOutputSchema` (required fields present, correct types) | Structural (Zod) | Same as above |
| 4.3 | All enum values (`time_of_day`, `category`) are within the defined set | Structural (Zod) | Same as above |
| 4.4 | All dates parse as valid calendar dates | Structural (Zod `.date()`) | Same as above |
| 4.5 | No duplicate `(title, time_of_day)` pair within the same day | Semantic | Reject as invalid output |
| 4.6 | `days.length` equals `computed_day_count`; `day_number` values are contiguous `1..N` with no gaps/repeats; each `date` matches `start_date + (day_number - 1)` | Semantic | Reject — this is the primary check that activities stay within trip dates and that no day is invented outside the trip range |
| 4.7 | Per-day activity count is within pace-based bounds: **1-day trip →** 3–6 activities; **multi-day trip, any day →** 2–6 activities (hard ceiling of 8 enforced already at schema level, §3.1) | Semantic | Reject if a day is empty (0) or exceeds 8 (already impossible if Zod passed) or exceeds 6 by a wide margin without a `travel_style` justification (soft rule — implementers should treat >6 as a warning, not an automatic reject, since Zod's cap of 8 is the true ceiling) |
| 4.8 | `days` array is non-empty | Semantic (also Zod `.min(1)`) | Reject as empty itinerary |
| 4.9 | No unexpected top-level or nested fields beyond the schema | Structural (Zod `strict` parsing — implementers should call `.strict()` on each object schema in §3.1, or otherwise reject unknown keys) | Reject as invalid output |
| 4.10 | `order_index` values within a day are unique and form a contiguous sequence starting at 0 | Semantic | Reject as invalid output |
| 4.11 | Model output is not empty/whitespace and is not a truncated JSON fragment (i.e. `JSON.parse` itself succeeds — a truncated response will typically fail JSON parsing outright, which is already covered by 4.1) | Structural | Reject → repair attempt, same as 4.1 |
| 4.12 | No partial persistence: if any check 4.1–4.11 fails, **nothing** is written to the database — the whole itinerary is accepted or the whole request fails | Pipeline-level (not a single field check) | N/A — this is a rule about *when to write*, not what to validate |

All of 4.1–4.11 must pass. There is no "accept with warnings" outcome for anything except the soft density note in 4.7 (which is advisory to the implementer, not a defined product-facing warning state — no such state exists in the Phase 4 contract in §6).

---

## 5. EDGE CASES

| Case | Defined behavior |
|---|---|
| 5.1 1-day trip | `start_date == end_date`; exactly 1 day in output; 3–6 activities (§4.7); Zod's `days.min(1)` already permits this. |
| 5.2 Very short trip (2–3 days) | Normal generation; §2.4's variety guidance applies. |
| 5.3 Long trip | **FINALIZED:** V1 supports up to 14 days (`computed_day_count`). Trips longer than 14 days are rejected at request time — before the model is ever called — with `TRIP_DURATION_UNSUPPORTED` (400, §6.6/§6.4a). This is a new rule specific to the generate-itinerary endpoint; it does not change Phase 1's own trip validation (`POST`/`PATCH /api/trips` still permit any date range with no duration cap — a user can create a 30-day trip via Phase 1, they simply cannot generate an itinerary for the portion beyond 14 days in V1). |
| 5.4 Same start/end date | Identical to 5.1 — this is the 1-day-trip case, not a separate error condition. Phase 1's own validation already permits `start_date == end_date` (its check is `end_date >= start_date`, not `>`). |
| 5.5 Maximum supported trip duration | **FINALIZED: 14 days inclusive** (`computed_day_count` between 1 and 14). This single number is used consistently in the Zod schema's `days.max(14)` (§3.1), the request-time rejection check (§6.4a), and is the ceiling implementers should also expect the database to hold (though the DB itself doesn't need its own separate 14-day check constraint — see §7.1 note). |
| 5.6 No interests (`interests: []`) | Valid per Phase 1 (defaults to `[]` on create). Prompt substitutes `"none specified"` (§2.2); model falls back to popular/iconic categories for the destination. |
| 5.7 Many interests | Phase 1 caps `interests` at 30 items. All are joined into the prompt; the model is not required to represent every interest in the output (not all interests may be plausible together in the trip length) — this is inherent to §2.3's "weight, don't force" rule, not a separate failure mode. |
| 5.8 Budget / mid-range / luxury | Handled per §2.3 — affects activity *category framing* only, never a literal price value, since the schema (§3) has no price field at all. |
| 5.9 Relaxed vs. fast-paced travel style | Handled per §2.3 as a soft modifier within the §4.7 density bounds — never allowed to exceed the schema's hard caps. |
| 5.10 Group size 1 vs. large group | Soft weighting only (§2.3); no hard schema difference — the schema has no group-size-dependent field. |
| 5.11 Vague destination | Handled per §2.5 — model must commit to one concrete real place, not ask a clarifying question. |
| 5.12 Invalid/unsupported destination | Handled per §2.5 — not pre-filtered; caught only if it causes the model's output to fail validation, surfacing as `ITINERARY_INVALID_OUTPUT` (§6.6). |
| 5.13 AI provider failure (5xx, network, rate-limited) | **FINALIZED:** 1 retry (2 attempts total), fixed 2-second delay, per §1.3/§1.4a. Distinct error path from bad output — Phase 4 surfaces `ITINERARY_GENERATION_FAILED` (502, §6.6), not `ITINERARY_INVALID_OUTPUT`. |
| 5.14 Timeout | **FINALIZED:** 30-second per-attempt timeout (§1.3). Treated as a provider failure (5.13) — same retry policy, same error code. |
| 5.15 Malformed model response | Covered by §4.1/§4.2/§4.11 — triggers the single repair attempt (§1.4b), then `ITINERARY_INVALID_OUTPUT` if the repair also fails. |
| 5.16 Duplicate generation request (same trip, requested twice) | **FINALIZED:** overwrite — see §6.7. Calling the endpoint again for the same trip replaces the existing itinerary; there is no separate "already exists" rejection and no version history in V1. |

---

## 6. PHASE 4 API CONTRACT

**This section specifies the contract only. Nothing described here is implemented. ChatGPT implements this in Phase 4.**

### 6.1 Endpoint

```
POST /api/trips/:id/generate-itinerary
```

### 6.2 Authentication

Required — identical pattern to every existing trip endpoint in Phase 1: session resolved via `requireUser()` (or its Phase-4 equivalent), `401 UNAUTHENTICATED` if no valid session. No new auth mechanism is introduced.

### 6.3 Request

```jsonc
// No request body required or accepted in V1.
```

An optional body allowing a "regenerate with different emphasis" override is a plausible future enhancement, but it is not part of this V1 contract and is not needed to resolve any of the six finalized decisions — introducing it now would be adding scope, not finalizing existing scope.

`:id` is validated exactly as Phase 1's existing `tripIdSchema` (`z.string().uuid()`) — `400 INVALID_TRIP_ID` on malformed input, same code Phase 1 already uses.

### 6.4 Request validation / authorization / ownership

Identical pattern to every existing `/api/trips/:id` handler:
1. Resolve authenticated user; `401 UNAUTHENTICATED` if none.
2. Validate `:id` is a UUID; `400 INVALID_TRIP_ID` if not.
3. Fetch the trip scoped to `user_id = <authenticated user>` (same `.eq("user_id", user.id)` pattern as Phase 1); `404 TRIP_NOT_FOUND` if no row matches — including if the trip exists but belongs to someone else (same anti-enumeration behavior Phase 1 already uses for `GET`/`PATCH`/`DELETE`).
4. **New, finalized step (§6.4a):** compute `computed_day_count = end_date - start_date + 1` from the fetched trip. If it exceeds **14**, return `400 TRIP_DURATION_UNSUPPORTED` immediately — **before calling the LLM at all**, to avoid wasting a paid model call on a request that can never succeed. This does not require re-validating the trip's dates themselves (Phase 1 already guarantees `end_date >= start_date` at both the Zod and DB layers) — it only adds a duration ceiling specific to this endpoint.
5. RLS on the new itinerary tables (§7) must independently enforce ownership via a join back to `trips.user_id = auth.uid()`, mirroring how Phase 1's RLS backs up the API-layer check.

### 6.4a Duration check — FINALIZED

```
if (computed_day_count > 14) {
  return 400 { error: { code: "TRIP_DURATION_UNSUPPORTED", message: "..." } }
}
```

This check happens after step 3 (trip fetched and ownership confirmed) and before any LLM call, config load, or database write related to itinerary generation.

### 6.5 Success response — FINALIZED

**Status code: `200 OK`, always** — for both the first generation and any subsequent regeneration of the same trip (§6.7 finalizes regeneration as overwrite, so there is no meaningful "was this the first call" distinction to encode in the status code; the response always represents "the current itinerary for this trip," computed fresh). This deliberately departs from Phase 1's convention of `201` on `POST /api/trips` (which creates a genuinely new, independent resource) — here the endpoint's semantics are closer to "(re)compute and return," which `200` represents more accurately.

```jsonc
{
  "data": {
    "trip_id": "trip-uuid",
    "trip_summary": "string",
    "days": [
      {
        "day_number": 1,
        "date": "2026-10-01",
        "theme": "string | null",
        "activities": [
          {
            "id": "activity-uuid",
            "order_index": 0,
            "time_of_day": "morning",
            "title": "string",
            "description": "string",
            "category": "sightseeing"
          }
        ]
      }
    ]
  }
}
```

Note: `id` fields appear in the *response* (DB-generated on insert) even though they never appear in the raw model output (§3.2) — the response shape is the *persisted* representation, not a passthrough of the model's JSON.

### 6.6 Error responses

Follows Phase 1's exact error envelope (`{"error":{"code","message","details?"}}`) with these **new** codes, added to (not replacing) the table in `docs/API_CONTRACT.md`:

| Code | Status | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Reused from Phase 1 — no valid session |
| `INVALID_TRIP_ID` | 400 | Reused from Phase 1 — malformed UUID |
| `TRIP_NOT_FOUND` | 404 | Reused from Phase 1 — no trip, or not owned by this user |
| `TRIP_DURATION_UNSUPPORTED` | 400 | **New, finalized (§6.4a).** `computed_day_count` exceeds the V1 maximum of 14 days. Returned before any LLM call is made. |
| `ITINERARY_CONFIG_ERROR` | 503 | **New, finalized (§2.7).** One or more of `WANDERAI_ITINERARY_LLM_API_KEY` / `_MODEL` / `_PROVIDER` is missing or invalid — mirrors Phase 1's `SUPABASE_CONFIG_ERROR` pattern exactly. |
| `ITINERARY_GENERATION_FAILED` | 502 | Provider-level failure (timeout, 5xx, rate limit) after the finalized retry policy (§1.3/§1.4a) is exhausted — distinct from bad output, per §5.13 |
| `ITINERARY_INVALID_OUTPUT` | 502 | Model responded, but output failed structural or semantic validation even after the one repair attempt (§1.4b, §4) |
| `ITINERARY_SAVE_FAILED` | 500 | Output validated successfully but the database write itself failed |

`ITINERARY_ALREADY_EXISTS` / `409` does **not** appear in this table — regeneration is finalized as overwrite (§6.7), so there is no "already exists" condition to reject.

`502` is used (not `500`) for the two AI-specific failure codes to distinguish "our own server broke" from "the upstream generation step broke," consistent with treating the LLM as an external dependency — this convention is proposed here, not inherited from Phase 1 (Phase 1 never talks to an external API), so ChatGPT should treat it as a Phase 3 recommendation rather than an existing pattern to match. `503` is reused for `ITINERARY_CONFIG_ERROR` specifically because it mirrors the exact meaning Phase 1 already gives `503` (`SUPABASE_CONFIG_ERROR`: "the service isn't configured, not that the request was bad") — keeping the same status code for the same *kind* of error avoids inventing a second convention for one concept.

### 6.7 Regeneration / idempotency — **FINALIZED: overwrite**

Calling `POST /api/trips/:id/generate-itinerary` a second time for the same trip **overwrites** the existing itinerary:
- No `409` rejection, no version history, no separate regenerate endpoint — the same endpoint always means "(re)compute and persist the itinerary for this trip now."
- Implementation approach for Phase 4: within a single database transaction, delete all existing `itinerary_days` rows for the trip (cascades to `itinerary_items` per §7's `on delete cascade`), then insert the newly generated days/items. Wrapping both steps in one transaction avoids a window where the trip briefly has no itinerary if the insert fails after the delete succeeds.
- This is the simplest V1 behavior consistent with WANDERAI_MASTER.md §2's in-scope "Ability to edit an itinerary" — there is one current itinerary per trip, not a history of past ones, matching how Phase 5's editing UI is expected to work against a single current state.
- If the product later wants version history or a non-destructive regenerate, that is a V2 feature to be scoped separately — not introduced here.

### 6.8 Synchronous vs. asynchronous — FINALIZED: synchronous

Generation is **synchronous**: the HTTP request blocks until the itinerary is generated, validated, and persisted, then returns `200` with the full result (per §6.5, the success response section) — no job-queue/polling pattern in V1, because:
- WANDERAI_MASTER.md's stated priority is minimizing integration complexity for ChatGPT/Replit (§3, §6).
- V1 has no background-job infrastructure defined anywhere in Phase 1.
- The finalized retry/timeout policy (§1.3) bounds worst-case latency to roughly 92 seconds, which is high but tolerable for a single V1 request given the alternative (building job-queue infrastructure) is explicitly out of proportion for this phase.

Phase 4 must ensure the deployment's own request-timeout ceiling (reverse proxy, serverless function limit, etc.) is configured above ~120 seconds for this specific route — this is an infrastructure/deployment note for Phase 4, not a product decision.

---

## 7. DATABASE REQUIREMENTS FOR PHASE 4

**No migration is created here. This is a specification for ChatGPT to implement in Phase 4.** Table/column names follow WANDERAI_MASTER.md §4's conceptual model as closely as possible, adjusted only where this spec's schema (§3) requires more precision.

**Note on the finalized 14-day maximum (§5.5):** no additional DB-level check constraint (e.g. `check (day_number <= 14)`) is required. The limit is already enforced earlier in the pipeline (Zod schema §3.1, and the request-time rejection in §6.4a) before any row is ever written, so by the time an insert reaches the database, `day_number` cannot exceed 14. Adding a redundant DB constraint is optional hardening, not a requirement of this spec.

**Note on finalized overwrite regeneration (§6.7):** Phase 4's implementation deletes and re-inserts `itinerary_days` (cascading to `itinerary_items`) within one transaction on every generation call, including the first one for a given trip. No schema difference exists between "first generation" and "regeneration" — both are the same operation.

### 7.1 `itinerary_days`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `trip_id` | `uuid` | not null, references `public.trips(id) on delete cascade` |
| `day_number` | `integer` | not null, `check (day_number >= 1)` |
| `date` | `date` | not null |
| `theme` | `text` | nullable, `check (theme is null or char_length(trim(theme)) between 1 and 150)` |
| `created_at` | `timestamptz` | not null, default `now()` |

Constraints:
- `unique (trip_id, day_number)` — enforces §4.6's contiguity/no-duplicate rule at the DB layer, not just in application code.

### 7.2 `itinerary_items`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `itinerary_day_id` | `uuid` | not null, references `public.itinerary_days(id) on delete cascade` |
| `order_index` | `integer` | not null, `check (order_index >= 0)` |
| `time_of_day` | `text` | not null, `check (time_of_day in ('morning','afternoon','evening','night'))` |
| `title` | `text` | not null, `check (char_length(trim(title)) between 1 and 150)` |
| `description` | `text` | not null, `check (char_length(trim(description)) between 1 and 500)` |
| `category` | `text` | not null, `check (category in ('sightseeing','food','nature_outdoors','culture_history','relaxation','shopping','nightlife','adventure','transit_logistics'))` |
| `created_at` | `timestamptz` | not null, default `now()` |

Constraints:
- `unique (itinerary_day_id, order_index)` — enforces §4.10's per-day ordering uniqueness at the DB layer.

### 7.3 Relationships

```
trips (1) ---- (many) itinerary_days (1) ---- (many) itinerary_items
```

Both new tables cascade-delete from their parent, mirroring how `trips` already cascades from `profiles` in Phase 1 — deleting a trip must not leave orphaned itinerary rows.

### 7.4 Indexes

- `itinerary_days(trip_id)` — supports fetching all days for a trip.
- `itinerary_items(itinerary_day_id, order_index)` — supports fetching a day's activities in order; the unique constraint above already provides this as a side effect, but implementers should confirm the constraint is backed by an index (Postgres does this automatically for `unique`).

### 7.5 RLS

No policy references `itinerary_days`/`itinerary_items.user_id` directly, because **neither table has a `user_id` column** — ownership is derived through the `trip_id`/`itinerary_day_id` chain back to `trips.user_id`, exactly as WANDERAI_MASTER.md's conceptual model implies (`itinerary_days` has `trip_id`, not its own owner column). Both tables need `enable row level security`, and each policy must be a join-based check, e.g. (illustrative, not final SQL — ChatGPT finalizes exact syntax in Phase 4):

```sql
-- itinerary_days: select
using (
  exists (
    select 1 from public.trips
    where trips.id = itinerary_days.trip_id
      and trips.user_id = auth.uid()
  )
)
```

The same join pattern applies to `itinerary_items` via `itinerary_day_id → itinerary_days.trip_id → trips.user_id`. All four operations (select/insert/update/delete) need this check, following the same "both `using` and `with check` for insert/update" pattern Phase 1 already established for `trips`.

---

## 8. FINALIZED DECISIONS LOG (finalization pass, revision v2)

Of the six items previously listed as open, **five are now finalized** below. **One cannot be finalized by this spec** — it is explicitly reserved for the product owner by WANDERAI_MASTER.md itself, and finalizing it here would silently override the authoritative document rather than resolve an ambiguity within Phase 3's own discretion. See the conflict note at the end of this section.

1. **LLM provider/model — NOT finalized; genuinely unavoidable, see conflict note below.**
2. **Maximum supported trip duration — FINALIZED: 14 days inclusive.** Consistent everywhere in this revision: Zod schema (`days.max(14)`, §3.1), request-time rejection (`TRIP_DURATION_UNSUPPORTED`, §6.4a), and edge cases §5.3/§5.5. Does not change Phase 1's own trip-creation validation (a trip can still be created with any duration; only itinerary generation is capped).
3. **Regeneration/idempotency policy — FINALIZED: overwrite.** Same endpoint, same behavior every time; no `409`, no version history. Detailed in §6.7, with the transaction-based delete-then-insert approach specified for Phase 4.
4. **Retry/backoff/timeout policy — FINALIZED.** 30-second per-attempt timeout; 1 retry (2 attempts total) on provider failure with a fixed 2-second delay; separately, 1 repair attempt on invalid-but-received output. Worst case ≈92 seconds, 3 total LLM calls. Detailed in §1.3/§1.4a/§1.4b.
5. **Destination pre-filtering — FINALIZED: no pre-filtering in V1.** No external geocoding/places API is introduced. Validation of destination quality happens entirely after the fact, via the existing output-validation pipeline (§4). Detailed in §2.5.
6. **Budget handling — FINALIZED: framing-only, no numeric price field.** `budget_tier` continues to shape activity *category* selection only (§2.3); the schema (§3) has no price/cost field, and none is introduced. This was already the spec's default position and is now confirmed as closed rather than open, consistent with WANDERAI_MASTER.md §2's "live pricing... out of scope for v1."

### Conflict note: LLM provider/model cannot be finalized here

WANDERAI_MASTER.md §8 lists "Which LLM/API will power itinerary generation (cost/quality tradeoff)?" under a section explicitly titled **"OPEN QUESTIONS (FOR PRODUCT OWNER, NOT TO BE DECIDED UNILATERALLY BY ANY AI)."** That heading is unambiguous and directly on point — it is not a generic gap I'm inferring should stay open by caution, it is a named exception the authoritative document itself carves out. Finalizing a specific vendor/model choice in this pass would mean silently overriding WANDERAI_MASTER.md's explicit instruction, which this finalization task itself says not to do ("If you find any contradiction between Phase 3 and the authoritative WANDERAI_MASTER.md... DO NOT silently change the authoritative documents"). **WANDERAI_MASTER.md takes precedence here.**

What *is* finalized instead, to minimize how much this blocks Phase 4 (§2.7):
- The exact environment variable names Phase 4 must read (`WANDERAI_ITINERARY_LLM_API_KEY`, `WANDERAI_ITINERARY_LLM_MODEL`, `WANDERAI_ITINERARY_LLM_PROVIDER`), none client-exposed.
- The config-error behavior (`503 ITINERARY_CONFIG_ERROR`, mirroring Phase 1's Supabase config-error pattern exactly).
- Confirmation that the prompt structure (§2.1/§2.2) is written to be provider-agnostic, so ChatGPT's Phase 4 integration code is the only part that needs to change once the product owner names a provider — no prompt or schema rework required.

This means Phase 4 can be built and code-complete against a placeholder/mock provider response today, with the real provider wired in as a final, isolated step once the product owner decides — it does not block starting or mostly finishing Phase 4.

---

## HANDOFF TO CHATGPT — PHASE 4

**1. Files ChatGPT should create:**
- `src/lib/ai/itinerary-schema.ts` — the Zod schema from §3.1, verbatim.
- `src/lib/ai/itinerary-prompt.ts` — prompt builder implementing §2.1/§2.2 templates.
- `src/lib/ai/itinerary-validate.ts` — semantic validation from §4 (the checks Zod alone can't express: 4.6, 4.7, 4.9 unknown-key strictness, 4.10).
- `src/app/api/trips/[id]/generate-itinerary/route.ts` — the endpoint per §6.
- New migration file (e.g. `supabase/migrations/0002_phase4_itinerary.sql`) implementing §7's tables, constraints, indexes, and RLS policies.

**2. Files ChatGPT must NOT touch:**
- Anything under Phase 1: `src/app/api/auth/*`, `src/app/api/trips/route.ts`, `src/app/api/trips/[id]/route.ts`, `src/lib/auth.ts`, `src/lib/supabase/*`, `src/lib/validation.ts`, `supabase/migrations/0001_phase1_foundation.sql`.
- Anything belonging to the Phase 2 frontend (not finalized, out of scope for Phase 4 per this task's own instructions).

**3. API contract:** §6 in full, including the new error codes in §6.6.

**4. JSON schema:** §3.1's Zod schema, verbatim — this is the model's expected output shape and also the shape ChatGPT validates against before persisting.

**5. Validation rules:** §4 in full — structural via Zod, semantic via the itemized checks in the §4 table; §1.4b's single-repair-attempt rule; §4.12's no-partial-persistence rule.

**6. Database changes required:** §7 in full — two new tables (`itinerary_days`, `itinerary_items`), both RLS-enabled with join-based ownership checks back to `trips.user_id`, cascading deletes, and the two uniqueness constraints (`trip_id, day_number` and `itinerary_day_id, order_index`).

**7. AI integration requirements:** system + user prompt templates from §2.1/§2.2 verbatim; provider config read from the three finalized env vars in §2.7; finalized retry policy — 30s per-attempt timeout, 1 provider-failure retry with 2s fixed delay (§1.4a), 1 separate output-repair attempt on invalid-but-received output (§1.4b), no retries beyond these ceilings.

**8. Security requirements:** identical ownership pattern to Phase 1 — never trust a client-supplied trip ID's ownership without both the API-layer `user_id` filter and RLS; never expose any AI provider API key to the client (`WANDERAI_ITINERARY_LLM_API_KEY` must never carry a `NEXT_PUBLIC_` prefix or appear in any response, same posture as Phase 1's Supabase anon-key-only rule); the model must never be told another user's data (§1.2 already guarantees this by only passing the seven named trip fields).

**9. Things ChatGPT MUST NOT do:**
- Must not pick the LLM provider/model itself — that is the one remaining open decision (§8), explicitly reserved for the product owner by WANDERAI_MASTER.md §8. ChatGPT should build against the finalized env-var config surface (§2.7) and a placeholder/mock provider response if needed to stay unblocked, wiring in the real provider once named.
- Must not add a price/cost field to the itinerary schema — finalized closed in §8, item 6.
- Must not change the finalized 14-day duration cap, the overwrite regeneration policy, or the retry/timeout numbers without flagging the change back to the product owner, since Gemini's Phase 5 and the response contract both depend on these being stable.
- Must not change the `category` or `time_of_day` enums without flagging it, since Gemini's Phase 5 rendering will depend on these exact values.
- Must not begin Phase 5 (itinerary UI) or touch Phase 2 frontend code.

---

**PHASE 3 STATUS: FINALIZED — READY FOR PHASE 4**

No files were created, modified, or deleted in the Phase 1 project or any Phase 2 frontend code. No API routes, migrations, or implementation code were written. This document is the sole Phase 3 deliverable. Five of six previously open decisions are now finalized (§8); the sixth (LLM provider/model) is confirmed as genuinely unavoidable and is called out to the product owner rather than silently resolved, per WANDERAI_MASTER.md §8's explicit reservation.
