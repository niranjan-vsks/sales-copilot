# MOBILE APP PRD BIBLE — Sales Copilot Mobile

> **Document class:** Agentic-execution PRD. Written to be handed verbatim to Claude Code, Emergent, Cursor, or any autonomous coding agent.
> **Product:** Sales Copilot Mobile — the native companion app to the Sales Copilot web application in this repository.
> **Target stack (mandatory):** React Native + Expo (latest stable SDK), TypeScript, expo-router.
> **Scope class:** Sales-rep core (Dashboard, AI Agent chat, Activities, Log Activity, Calendar event creation, Profile). Admin surfaces are web-only and OUT OF SCOPE.
> **Native enhancements in scope:** Push notifications, offline activity queue, voice-to-log, biometric unlock.
> **Source of truth:** The existing backend in `backend/` of this repo. The mobile app is a NEW CLIENT of the EXISTING API. Do not fork or re-implement backend logic.

---

## 0. How an agent must use this document

1. Read Sections 1–4 fully before writing any code. They define the system you are integrating with.
2. Every API shape marked **[VERIFIED]** was extracted from `backend/server.py` / `backend/auth_signup.py` and is accurate as of this writing. Shapes marked **[VERIFY IN REPO]** must be confirmed by reading the referenced file before use.
3. Build in the phase order of Section 15. Do not skip Phase 0 (foundations).
4. Never invent an endpoint. If a screen needs data that no listed endpoint provides, use the fallback specified for that screen, or flag it as a blocker.
5. Every screen has explicit acceptance criteria (Section 14). A screen is not done until all its criteria pass on a real device or simulator.
6. The companion documents in `docs/` (especially `ARCHITECTURE_BIBLE.md`, `ENTERPRISE_SECURITY_BIBLE.md`, `CLAUDE_CODE_EXECUTION_BIBLE.md`) are binding context. Where this PRD and the repo disagree, the repo wins — then update this PRD.

---

## 1. Product context

### 1.1 What Sales Copilot is

Sales Copilot is an AI-powered sales productivity tool for field sales reps whose CRM is Microsoft Dynamics 365 (D365). The web app (React 19 SPA in `frontend/`) talks to a FastAPI backend (`backend/server.py`) backed by MongoDB. Core loop:

1. A rep logs sales activities (phone calls, appointments, emails, tasks) against D365 accounts — via structured form, AI chat in natural language, or bulk sheet upload.
2. The backend routes the log through an n8n workflow (`log-d365-activity`) or direct D365 Web API call.
3. An AI chat agent (server-side LLM, `backend/ai_chat.py`) answers questions, parses intents ("log a call with Acme about pricing"), and drives workflows conversationally.
4. Notifications about workflow results go out via Telegram and email today; the mobile app adds push.

### 1.2 Why mobile

Reps are in the field. The highest-value mobile jobs-to-be-done, in priority order:

| # | Job | Mobile mechanism |
|---|-----|------------------|
| 1 | Log an activity within 30 seconds of leaving a meeting | Voice-to-log + quick-log form |
| 2 | Ask the AI agent anything about their pipeline/tasks | Chat screen |
| 3 | See what happened / what's pending | Dashboard + Activities + push notifications |
| 4 | Never lose a log to bad connectivity | Offline outbox queue |
| 5 | Get in instantly but securely | Biometric unlock |

### 1.3 Explicitly out of scope (v1)

- Admin: Connections page, Team management, Monitoring, File Management / Excel bulk upload UI.
- Signup of NEW organizations. (Individual rep signup with email OTP IS in scope — see 7.3.)
- Microsoft OAuth **sign-in** flow on mobile (the web `GET /api/auth/microsoft` flow sets an httpOnly cookie via redirects; deep-link handling of that flow is deferred to v1.1). Email+password is the v1 auth method. Reps whose D365 connection was established on web still get full D365 functionality on mobile because tokens are stored server-side per `user_id`.
- Editing/deleting activities in D365 (web parity: web is also log-and-view only).
- Tablet-optimized layouts (app must run on tablets, but phone layout scaled is acceptable in v1).

---

## 2. System architecture (mobile client view)

```
┌─────────────────────────────┐
│  Sales Copilot Mobile (Expo)│
│  - expo-router screens      │
│  - TanStack Query cache     │
│  - SQLite offline outbox    │
│  - SecureStore (token)      │
└──────────────┬──────────────┘
               │ HTTPS, Authorization: Bearer <session_token>
               ▼
┌─────────────────────────────┐      ┌──────────────┐
│  FastAPI backend  /api/*    │◄────►│  MongoDB     │
│  backend/server.py          │      └──────────────┘
│  - session auth             │      ┌──────────────┐
│  - AES-GCM payload crypto   │◄────►│  n8n         │
│  - AI chat (LLM)            │      └──────────────┘
│  - D365 Web API client      │◄────►┌──────────────┐
└─────────────────────────────┘      │ Dynamics 365 │
                                     └──────────────┘
```

Key facts the agent must internalize:

- **All routes are prefixed `/api`** and served from one FastAPI app. Base URL comes from env (`EXPO_PUBLIC_API_URL`), e.g. `https://<backend-host>`.
- **Auth is server-side sessions**, not JWT. A 64-hex-char `session_token` maps to a row in the `user_sessions` Mongo collection. **[VERIFIED]** `get_current_user` (backend/server.py:184) accepts the token from EITHER the `session_token` cookie OR an `Authorization: Bearer <token>` header. Mobile uses the Bearer header exclusively.
- **Response envelope:** most endpoints return `{"success": bool, "data": ..., "error": str|null}`. **[VERIFY IN REPO]** per endpoint — a few return raw objects. The API layer (Section 6.2) must unwrap defensively.
- **Sensitive request fields are AES-GCM encrypted client-side** before POSTing (Section 8). The backend decrypts with `PAYLOAD_ENCRYPTION_KEY` (`backend/payload_crypto.py`). Login passwords MUST be encrypted this way (`_decrypt_payload(body.password)` at backend/server.py:412 — **[VERIFIED]**).
- Rate limits exist (e.g. login is `10/minute` **[VERIFIED]**). Handle HTTP 429 gracefully.

---

## 3. Required backend modifications (small, do these first)

The mobile app requires four additive backend changes. They are backward-compatible with the web client. Implement them in `backend/server.py` (or a new `backend/mobile_api.py` router) as **Phase 0** work.

### M-1: Login must return the session token in the body for mobile clients — **BLOCKER**

**[VERIFIED]** `POST /api/auth/login` currently returns `{"success": true, "data": {"name": ...}, "error": null}` and delivers the token ONLY as an httpOnly cookie (backend/server.py:447-449). Mobile cannot reliably use httpOnly cookies.

Change: when the request carries header `X-Client: mobile`, include the token in the response:

```json
{ "success": true, "data": { "name": "Asha", "session_token": "<64 hex chars>", "expires_at": "<ISO8601>" }, "error": null }
```

Do NOT set the cookie for mobile requests. Keep web behavior byte-identical when the header is absent. Apply the same change to the signup email-verification completion in `backend/auth_signup.py` if it establishes a session.

### M-2: Push token registration endpoints

```
POST   /api/notifications/push/register    body: { "expo_push_token": "ExponentPushToken[...]", "platform": "ios"|"android", "device_name": str }
DELETE /api/notifications/push/register    body: { "expo_push_token": str }
```

Store in a new `push_tokens` collection: `{ user_id, expo_push_token, platform, device_name, created_at, last_seen_at }`, unique index on `expo_push_token`, secondary index on `user_id`. Both endpoints require auth and MUST scope by `user.user_id`.

### M-3: Push dispatch on workflow completion

Wherever the backend records a workflow execution result (search `backend/server.py` for the `/internal/log-execution` handler and the Telegram notification path — **[VERIFY IN REPO]**), add a fire-and-forget push via Expo's push HTTP API (`https://exp.host/--/api/v2/push/send`) to all of the user's registered tokens:

- Title: `Activity logged` / `Activity failed`
- Body: `"<activity_type> with <account_name> — <status>"`
- Data payload: `{ "type": "workflow_result", "execution_id": str, "status": "success"|"error" }`

Failures to send push must never fail the parent request (wrap in try/except, log warning). Prune tokens that Expo reports as `DeviceNotRegistered`.

### M-4: Idempotency for offline replays

`POST /api/workflows/execute` and `POST /api/chat` must accept an optional `Idempotency-Key` header (a client-generated UUIDv4). Persist seen keys in an `idempotency_keys` collection with a 48h TTL index `{ key, user_id, response_snapshot, created_at }`. On a replayed key for the same user, return the stored response with HTTP 200 instead of re-executing. This is what makes the offline outbox (Section 11.2) safe.

---

## 4. API contract (the endpoints mobile uses)

Every path below is relative to `{EXPO_PUBLIC_API_URL}/api`. All authenticated calls send `Authorization: Bearer <session_token>` and `X-Client: mobile`.

### 4.1 Auth

| Method | Path | Used by | Notes |
|---|---|---|---|
| POST | `/auth/login` | Login screen | Body `{ email, password }`; `password` AES-GCM-encrypted (Section 8). Rate-limited 10/min. Returns M-1 shape. **[VERIFIED]** |
| POST | `/auth/signup` | Signup screen | **[VERIFY IN REPO]** `backend/auth_signup.py:157`. Triggers OTP email. |
| POST | `/auth/verify-email` | OTP screen | **[VERIFY IN REPO]** `backend/auth_signup.py:248`. |
| POST | `/auth/resend-otp` | OTP screen | **[VERIFY IN REPO]** `backend/auth_signup.py:96`. |
| GET | `/auth/me` | Session bootstrap | Returns current user `{ user_id, email, name, role, ... }`. 401 → logged out. |
| PATCH | `/auth/me` | Profile screen | Update display name etc. **[VERIFY IN REPO]** for accepted fields. |
| POST | `/auth/change-password` | Profile screen | Encrypt password fields like login. **[VERIFY IN REPO]** |
| POST | `/auth/logout` | Profile screen | Also delete the local token + biometric state regardless of response. |

### 4.2 Core data

| Method | Path | Used by | Notes |
|---|---|---|---|
| POST | `/chat` | AI Agent screen | Body `{ "message": str }`, max 4000 chars **[VERIFIED]** (ChatRequest, server.py:110). Response includes assistant reply and possibly structured action results — **[VERIFY IN REPO]** exact shape from the handler's return. |
| GET | `/chat/history` | AI Agent screen | Paginated history — **[VERIFY IN REPO]** query params. |
| GET | `/d365/activities?entity_set=phonecalls&top=50` | Activities screen | `entity_set` ∈ `phonecalls`, `appointments`, `emails`, `tasks`; `top` 1–200 **[VERIFIED]** (server.py:948). Falls back server-side to local `workflow_executions` merge when D365 is unreachable **[VERIFIED]** — mobile treats both shapes uniformly (Section 10.4). |
| GET | `/accounts/search?q=...` | Account picker | Typeahead over the user's account list. **[VERIFY IN REPO]** for param name and shape. |
| GET | `/workflows/list` | Log Activity screen | Available workflows for the user. |
| POST | `/workflows/execute` | Log Activity screen | The structured activity-log path. **[VERIFY IN REPO]** body shape (workflow_id + params). Send `Idempotency-Key`. |
| GET | `/workflows/executions` | Dashboard, Activities | Recent execution log (status: success/pending/error). |
| POST | `/calendar/create-event` | Chat + Log flow | Creates an Outlook calendar event via MS Graph. **[VERIFY IN REPO]** body. |
| GET | `/config/activity-types` | Log Activity screen | Canonical list of activity types. |
| GET | `/user/preferences` / PATCH same | Profile screen | Notification prefs etc. |
| GET | `/notifications/telegram/status` | Profile screen | Read-only display of Telegram link state. |

### 4.3 Contract rules for the API layer

1. Unwrap `{ success, data, error }` envelopes; surface `error` (or `detail` on FastAPI HTTPException) as the user-facing message.
2. 401 → purge token, reset navigation to `/login`. Never loop (mirror the `_redirecting` guard in `frontend/src/lib/api.js` — **[VERIFIED]** pattern).
3. 429 → toast "Too many attempts, wait a minute" and back off.
4. Network failure on a **mutating** call from a queue-eligible flow → enqueue in the outbox (Section 11.2). Network failure on a **read** → show cached data + stale banner.
5. Timeout: 30s for `/chat` (LLM latency), 15s for everything else.

---

## 5. Design system (pixel-level)

The mobile app inherits the web app's dark, high-contrast, orange-accent identity. All values below are extracted from `frontend/src/index.css` **[VERIFIED]** and converted to hex.

### 5.1 Color tokens (exactly these, no others)

| Token | Value | Source (HSL) | Usage |
|---|---|---|---|
| `background` | `#0A0A0A` | 0 0% 4% | Screen background, html root |
| `card` | `#141414` | 0 0% 8% | Cards, sheets, chat bubbles (assistant), tab bar |
| `secondary` / `muted` / `border` / `input` | `#1F1F1F` | 0 0% 12% | Input fills, dividers, secondary buttons |
| `foreground` | `#F2F2F2` | 0 0% 95% | Primary text |
| `mutedForeground` | `#999999` | 0 0% 60% | Secondary text, placeholders, timestamps |
| `primary` / `accent` / `ring` | `#FF4400` | 16 100% 50% | CTAs, active tab, FAB, links, focus rings, user chat bubbles |
| `primaryForeground` | `#FFFFFF` | 0 0% 100% | Text on primary |
| `destructive` | `#EF4444` | 0 84% 60% | Errors, failed status |
| `success` (mobile addition) | `#22C55E` | — | Success status chips (web uses ad-hoc greens) |
| `warning` (mobile addition) | `#EAB308` | — | Pending status chips |

Total palette: 1 brand color (`#FF4400`), 4 neutrals, 3 status accents. No gradients anywhere. No purple.

### 5.2 Typography

- **Headings / display / numbers:** Space Grotesk (weights 500, 600, 700) — load via `@expo-google-fonts/space-grotesk`.
- **Body / UI:** Fira Sans (weights 400, 500, 600) — load via `@expo-google-fonts/fira-sans`.
- Scale (all values dp; line-height in parentheses):
  - `display` 28 (34) SpaceGrotesk-700 — screen titles like "Dashboard"
  - `title` 20 (26) SpaceGrotesk-600 — card titles, section headers
  - `stat` 32 (36) SpaceGrotesk-700 — dashboard stat numbers
  - `body` 15 (22) FiraSans-400 — default text
  - `bodyMedium` 15 (22) FiraSans-500 — emphasized body, button labels
  - `caption` 13 (18) FiraSans-400 — timestamps, helper text
  - `micro` 11 (14) FiraSans-500, letter-spacing 0.5, uppercase — status chips, section eyebrows
- Minimum rendered font size anywhere: 11dp. Respect OS font scaling up to 1.3x (test with it).

### 5.3 Spacing, radius, elevation

- Spacing scale: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48. Screen horizontal padding: **16**. Card internal padding: **16**. Gap between stacked cards: **12**.
- Radius: cards & sheets **10** (matches web `--radius: 0.625rem`), buttons **10**, inputs **10**, chips **999** (pill), FAB **28** (56dp circle).
- Elevation: flat design. Cards are `#141414` on `#0A0A0A` with a 1px `#1F1F1F` border — no shadows except the FAB (iOS shadow opacity 0.3 radius 8 / Android elevation 6).

### 5.4 Core components (build once in `components/ui/`, reuse everywhere)

| Component | Spec |
|---|---|
| `Button` | Height 48, radius 10, `bodyMedium` label. Variants: `primary` (#FF4400 bg, white text), `secondary` (#1F1F1F bg, #F2F2F2 text), `ghost` (transparent, #FF4400 text), `destructive` (#EF4444 bg, white text). Disabled: 40% opacity. Pressed: 85% opacity. Loading: replace label with 20dp spinner, keep width. |
| `Input` | Height 48, radius 10, bg #1F1F1F, 1px border #1F1F1F → #FF4400 when focused, text #F2F2F2, placeholder #999999, padding-h 14. Error state: border #EF4444 + 13dp caption below in #EF4444. |
| `Card` | bg #141414, radius 10, border 1px #1F1F1F, padding 16. |
| `StatusChip` | Pill, `micro` type, padding 4×10. success: #22C55E text on #22C55E/15% bg. pending: #EAB308 on 15% bg. error/failed: #EF4444 on 15% bg. |
| `Avatar` | Circle, bg #1F1F1F, initials in SpaceGrotesk-600 #FF4400. Sizes 32/40/64. |
| `EmptyState` | Centered: 48dp lucide icon in #999999, `title` line, `body` #999999 line, optional primary Button. Vertical padding 48. |
| `Skeleton` | #1F1F1F blocks, subtle opacity pulse (0.5→1.0, 1s), radius 8. Every list screen has a skeleton variant matching its final layout. |
| `Toast` | Bottom-anchored above tab bar, bg #141414, border 1px #1F1F1F, radius 10, icon + `body` text, auto-dismiss 3.5s. Variants: success/error/info. Use `react-native-toast-message` or equivalent. |
| `BottomSheet` | `@gorhom/bottom-sheet`. bg #141414, top radius 16, drag handle 36×4 #1F1F1F. |

Icons: **lucide-react-native**, stroke width 2, sizes 20 (inline) / 24 (nav, headers). Same icon family as web (`lucide-react`) — keep icon choices consistent with the web sidebar: `LayoutDashboard`, `MessageSquare`, `ActivitySquare` **[VERIFIED]** from `frontend/src/layouts/SidebarLayout.js`.

### 5.5 Motion

- Screen transitions: expo-router defaults (native stack slide).
- List items: no entrance animation (performance).
- Chat: new message fades+slides up 8dp over 150ms.
- FAB: scales 0.92 on press.
- Pull-to-refresh: native RefreshControl, tint #FF4400.
- Respect `Reduce Motion`: disable the chat entrance animation when enabled.

---

## 6. App architecture & conventions

### 6.1 Project structure (expo-router)

```
app/
  _layout.tsx              // Root: fonts, QueryClientProvider, AuthProvider, theme, toasts
  (auth)/
    login.tsx
    signup.tsx
    verify-otp.tsx
  (app)/
    _layout.tsx            // Tab navigator + auth guard + biometric gate
    dashboard/index.tsx
    chat/index.tsx
    log/index.tsx          // Log Activity (modal-style center tab)
    activities/index.tsx
    profile/index.tsx
    profile/change-password.tsx
    profile/notifications.tsx
components/
  ui/                      // Section 5.4 primitives
  dashboard/  chat/  activities/  log/
lib/
  api.ts                   // fetch wrapper (Section 6.2)
  crypto.ts                // AES-GCM (Section 8)
  auth.ts                  // token store, session state
  outbox.ts                // offline queue (Section 11.2)
  push.ts                  // notification registration/handlers
  voice.ts                 // speech recognition helper
constants/
  theme.ts                 // tokens from Section 5
  config.ts                // env access
```

### 6.2 Data layer

- **TanStack Query** for all server state. Query keys: `['me']`, `['dashboard']`, `['activities', entitySet]`, `['chatHistory']`, `['executions']`, `['accountSearch', q]`, `['preferences']`.
- Stale times: dashboard/executions 30s, activities 60s, chat history 0 (always refetch on focus), preferences 5min.
- `lib/api.ts` is the ONLY module that calls `fetch`. It injects the Bearer token, `X-Client: mobile`, handles envelope unwrapping, 401 purge, 429 backoff, and timeouts per Section 4.3.
- Client-only state (composer text, sheet visibility): local `useState`/`useReducer`. Session state: a tiny Zustand store in `lib/auth.ts`. **No Redux.**

### 6.3 Environment

```
EXPO_PUBLIC_API_URL=https://<backend-host>
EXPO_PUBLIC_PAYLOAD_ENCRYPTION_KEY=<base64 256-bit key, same as backend PAYLOAD_ENCRYPTION_KEY>
```

No other secrets ship in the binary. The payload key is obfuscation-in-transit hardening, not a trust boundary (same posture as web — see `ENTERPRISE_SECURITY_BIBLE.md`).

---

## 7. Screen specifications

Layout notation: all dp, portrait, safe-area aware. "TabBar" = the bottom tab navigator.

### 7.0 Global chrome

- **Tab bar:** height 56 + bottom safe inset, bg #141414, top border 1px #1F1F1F. Five slots: Dashboard (`LayoutDashboard`), AI Agent (`MessageSquare`), **Log** (center, raised 56dp #FF4400 circle FAB with white `Plus` icon, offset -16 above bar), Activities (`ActivitySquare`), Profile (`Avatar` 24). Active tint #FF4400, inactive #999999, `micro` labels under icons (except center FAB, no label).
- **Screen header:** not a native header. Each screen renders its own: 16 padding, `display` title, optional right-side action icon(s) 24dp.
- **Status bar:** light-content on #0A0A0A.

### 7.1 Login (`(auth)/login.tsx`)

Vertical layout, centered column, padding-h 24:

1. Top spacer (flex 1, min 48).
2. App wordmark: "Sales Copilot" SpaceGrotesk-700 26dp #F2F2F2, with "Copilot" in #FF4400. Below: `caption` #999999 "AI-powered D365 activity logging".
3. 32 gap.
4. `Input` email — label above in `caption` #999999 "Email", keyboardType email-address, autoCapitalize none, autoComplete email, textContentType username.
5. 16 gap. `Input` password — secureTextEntry with eye toggle (lucide `Eye`/`EyeOff` 20dp #999999 right-inset 14), textContentType password.
6. 24 gap. `Button primary` "Sign in", full width. Disabled until both fields non-empty and email matches basic regex.
7. 16 gap. `ghost` link centered "New here? Create an account" → `/signup`.
8. Bottom spacer (flex 1).

Behavior:
- Submit → `encryptField(password)` (Section 8) → `POST /auth/login` with `X-Client: mobile`.
- Success → store `session_token` + `expires_at` in SecureStore, prime `['me']`, offer biometric enrollment (Section 11.4 sheet), then `router.replace('/dashboard')`.
- 401 → inline error under password: "Invalid email or password." Do not reveal which.
- 429 → toast per Section 4.3.
- Keyboard: `KeyboardAvoidingView`; return-key "next" on email focuses password; "go" on password submits. Respect the CJK IME guard (`isComposing` / keyCode 229) on any Enter-submit handling.

### 7.2 Signup (`(auth)/signup.tsx`)

Same chrome as login. Fields (each `Input`, 16 gaps): Full name, Work email, Password, Confirm password. Password rules mirror `backend/auth_signup.py` — **[VERIFY IN REPO]** and render live checklist (`caption` lines with `Check`/`X` 14dp icons) for: min length, one number, one uppercase (adjust to actual backend rules). Primary button "Create account" → `POST /auth/signup` (encrypt password fields) → on success `router.push('/verify-otp?email=...')`.

### 7.3 Verify OTP (`(auth)/verify-otp.tsx`)

1. Title `display` "Check your email". `body` #999999: "We sent a 6-digit code to {email}".
2. 32 gap. Six 48×56 OTP boxes (radius 10, bg #1F1F1F, `stat`-size digit centered, active box border #FF4400), auto-advance, paste-fill support.
3. 24 gap. `Button primary` "Verify" (enabled at 6 digits) → `POST /auth/verify-email`.
4. 16 gap. Centered `caption`: "Didn't get it? **Resend code**" (#FF4400) → `POST /auth/resend-otp`, then disabled with countdown "Resend in {n}s" for 60s.
5. Success → if the endpoint establishes a session (M-1 applies), store token and go to dashboard; otherwise route to login with a success toast "Email verified — sign in".

### 7.4 Biometric gate (modal over `(app)/_layout.tsx`)

When the app cold-starts or returns from >5 min background AND biometrics are enrolled (Section 11.4): full-screen #0A0A0A overlay, centered lucide `Fingerprint`/`ScanFace` 48dp #FF4400, `title` "Unlock Sales Copilot", auto-triggers `LocalAuthentication.authenticateAsync()`. Failure → `Button secondary` "Try again" + `ghost` "Use password instead" (logs out to login screen). Never render app content behind the gate.

### 7.5 Dashboard (`(app)/dashboard/index.tsx`)

Mirror the web dashboard's information hierarchy (see `frontend/src/pages/DashboardPage.js` for exact data usage — **[VERIFY IN REPO]** which endpoints it calls; expected: `/workflows/executions`, `/auth/me`, config). ScrollView with pull-to-refresh:

1. **Header row:** `display` "Hi, {firstName}" + `caption` #999999 date line ("Tuesday, Jul 7"). Right: `Bell` 24 icon → notifications permission/prefs shortcut, with a 8dp #FF4400 dot when there are unseen failed executions.
2. **Stat cards row:** horizontal 2-column grid (gap 12). Each `Card` 12 padding: `micro` #999999 label, `stat` number, `caption` delta line. Cards: "Activities this week" (count of executions with `workflow_id: log-d365-activity` in last 7 days), "Pending" (#EAB308 number if >0), "Failed" (#EF4444 number if >0), "Chats" (messages sent this week). Compute client-side from `/workflows/executions` + `/chat/history` — do not invent a stats endpoint. If `docs/` or the repo reveals a dedicated dashboard endpoint, prefer it. **[VERIFY IN REPO]**
3. **Quick actions:** horizontal row of 2 `Card`s: "Log activity" (`Plus` in #FF4400 24dp) → Log tab; "Ask AI" (`MessageSquare`) → Chat tab. Height 72, icon left, `bodyMedium` label.
4. **Recent activity section:** `title` "Recent activity" + `ghost` "See all" → Activities tab. List of up to 5 `ExecutionRow`s: 44dp lucide icon circle (activity-type icon on #1F1F1F), `bodyMedium` first line "{activity_type} — {account_name}", `caption` #999999 second line relative time, right-aligned `StatusChip`. Empty → `EmptyState` "No activity yet / Log your first activity" with button to Log tab.
5. Skeleton: 4 stat blocks + 5 row blocks while loading.

### 7.6 AI Agent chat (`(app)/chat/index.tsx`)

The signature screen. Match web `ChatPage` semantics (**[VERIFY IN REPO]** `frontend/src/pages/ChatPage.js` for response rendering rules), adapted to mobile:

- **Message list:** inverted FlatList, padding-h 16. Assistant bubble: bg #141414, border 1px #1F1F1F, radius 16 (bottom-left 4), max-width 85%, left-aligned, `body` text; renders markdown (bold, lists, inline code) via `react-native-markdown-display` with theme-matched styles. User bubble: bg #FF4400, white text, radius 16 (bottom-right 4), max-width 85%, right-aligned. `caption` #999999 timestamp under each group. Day separators: centered `micro` chip.
- **Action results:** when a chat response includes a structured workflow/action result (**[VERIFY IN REPO]** shape from `POST /chat` handler return in server.py:768+), render inside the assistant bubble as an embedded mini-card: bg #1F1F1F, radius 8, padding 10, `StatusChip` + `caption` summary lines (account, type, status).
- **Typing state:** while awaiting the POST, show an assistant bubble with three 6dp #999999 dots pulsing.
- **Composer:** bottom bar above tab bar, bg #141414, top border #1F1F1F, padding 8×16. Row: `Mic` 24dp button (Section 11.3), multiline `Input`-styled TextInput (max-height 120, placeholder "Ask or log anything…", maxLength 4000), send button 40dp #FF4400 circle with `ArrowUp` white icon (disabled/50% when empty).
- **History:** on mount load `GET /chat/history` (paginate older on scroll-to-top if supported). Persist scroll position across tab switches.
- **Offline:** composer disabled with a `caption` banner "You're offline — chat needs a connection. Activity logs still work from the Log tab." (Chat is NOT outbox-eligible; conversational context would go stale.)
- Suggested prompts (only when history is empty): 3 tappable chips above composer — "Log a call with…", "What's pending this week?", "Create a meeting for tomorrow 10am".

### 7.7 Log Activity (`(app)/log/index.tsx`, presented as modal from center FAB)

Full-screen modal, `X` close top-left, `display` title "Log activity". This is the structured twin of the chat intent, posting to `POST /workflows/execute` with the `log-d365-activity` workflow (**[VERIFY IN REPO]** exact params object from web's usage in `DashboardPage.js`/`ChatPage.js` and the backend handler). Form, 16 gaps:

1. **Activity type:** horizontal segmented chips from `GET /config/activity-types` (fallback: Phone call, Appointment, Email, Task). Selected chip: #FF4400 bg white text; unselected: #1F1F1F bg #F2F2F2.
2. **Account:** `Input` with typeahead → on ≥2 chars call `GET /accounts/search` (debounced 300ms), results in an attached dropdown Card (max 5 rows: `bodyMedium` name + `caption` detail). Mirrors web `AccountSearchInput.js` behavior — **[VERIFY IN REPO]**. Selected account renders as a dismissible chip.
3. **Subject:** `Input`, placeholder "e.g. Pricing follow-up call".
4. **Notes:** multiline `Input` height 120, with a `Mic` button inset (voice dictation fills this field — Section 11.3).
5. **Date/time:** two side-by-side selector rows (Card style, `Calendar`/`Clock` icons) opening native pickers (`@react-native-community/datetimepicker`). Default: now.
6. **[If type = Appointment] "Also create Outlook event"** toggle → additionally `POST /calendar/create-event`.
7. Sticky footer: `Button primary` full-width "Log to Dynamics 365". Loading state while posting.

Behavior:
- Success → close modal, success toast "Activity logged", invalidate `['executions']`, `['activities']`, `['dashboard']`.
- Offline or network failure → enqueue in outbox (Section 11.2), close modal, info toast "Saved offline — will sync when you're back online".
- Validation: type + account + subject required; inline errors per Section 5.4 Input spec.

### 7.8 Activities (`(app)/activities/index.tsx`)

1. Header `display` "Activities". Below: horizontal filter chips — All, Calls, Appointments, Emails, Tasks → maps to `entity_set` param (`phonecalls`, `appointments`, `emails`, `tasks`) **[VERIFIED]** values.
2. FlatList of `ActivityRow` Cards (gap 12): leading 40dp icon circle per type (`Phone`, `CalendarDays`, `Mail`, `CheckSquare`), `bodyMedium` subject line (1 line ellipsis), `caption` #999999 "{account} · {relative time}", trailing `StatusChip` when the item came from the local-executions fallback (D365-sourced items have no status chip; they're facts).
3. Data: `GET /d365/activities?entity_set={filter}&top=50`. "All" = fire the four requests in parallel and merge, sorted by date desc. Handle BOTH response shapes (native D365 entities vs. the local fallback merge **[VERIFIED]** exists) behind one normalizer in `lib/activities.ts`: `{ id, type, subject, accountName, date, status? }`. **[VERIFY IN REPO]** the exact field names of each shape from `backend/d365_client.py` `list_activities` and the fallback block (server.py:965+).
4. Row tap → `BottomSheet` detail: all normalized fields, full notes text, `caption` source line ("From Dynamics 365" / "Logged via Sales Copilot").
5. Pull-to-refresh, skeleton list, `EmptyState` per filter ("No calls yet…" etc.). Outbox items pending sync appear at the top with a #EAB308 "Queued" chip (Section 11.2).

### 7.9 Profile (`(app)/profile/index.tsx`)

Sectioned list (Cards with internal 1px #1F1F1F row dividers):

1. **Identity card:** `Avatar` 64 + `title` name + `caption` email + `micro` role chip ("REP"/"ADMIN").
2. **Account section rows** (56dp rows: 20dp icon, `body` label, `ChevronRight`): Edit name (`PATCH /auth/me` via inline sheet), Change password (screen: current + new + confirm, encrypted, `POST /auth/change-password`).
3. **Security section:** "Unlock with Face ID / fingerprint" toggle (Section 11.4). "App lock timeout" row (Immediately / 1 min / 5 min).
4. **Notifications section:** "Push notifications" toggle (registers/unregisters via M-2; if OS permission denied, deep-link to Settings). "Telegram" read-only status row from `GET /notifications/telegram/status` ("Connected" / "Set up on web").
5. **Data section:** "Pending offline logs ({n})" row → outbox screen/sheet listing queued items with retry/delete. Only visible when n > 0.
6. **About:** version + build, link to privacy policy.
7. `Button destructive` (outline style: transparent bg, #EF4444 border+text) "Sign out" → `POST /auth/logout`, purge SecureStore token + biometric flag + query cache + outbox (with confirm dialog if outbox non-empty: "You have {n} unsynced logs. Signing out will delete them.").

---

## 8. Payload encryption (must match backend byte-for-byte)

**[VERIFIED]** from `frontend/src/lib/crypto.js` and `backend/payload_crypto.py`:

- Algorithm: AES-256-GCM. Key: base64-decoded `EXPO_PUBLIC_PAYLOAD_ENCRYPTION_KEY` (32 bytes raw).
- Wire format: `base64( iv[12 bytes] || ciphertext || gcm_tag )` — the WebCrypto ciphertext already appends the 16-byte tag; replicate exactly.
- If the key env var is absent, send plaintext (backend falls back symmetrically). Log a build-time warning.
- Fields to encrypt: `password` on login, all password fields on signup/change-password. **[VERIFY IN REPO]** whether any other fields go through `encryptField` on web (search `frontend/src` for `encryptField(` and mirror the full list).
- Implementation: use `react-native-quick-crypto` (preferred, real AES-GCM) or `expo-crypto` + a vetted GCM implementation. Do NOT hand-roll GCM. Unit-test round-trip against a fixture encrypted by the Python side.

---

## 9. Push notifications (native enhancement 1)

- `expo-notifications` + EAS project push credentials (APNs key, FCM v1).
- Registration flow: after first successful login (and on every cold start when permission is granted), obtain the Expo push token and `POST /notifications/push/register` (M-2). Deregister on sign-out.
- Permission UX: never ask at launch. Ask contextually — after the user's FIRST successful activity log, show a pre-permission sheet: `title` "Know the moment it lands in D365", `body` explanation, `Button primary` "Enable notifications" → OS prompt; `ghost` "Not now".
- Handling: foreground → render as in-app Toast; background tap → deep link: `workflow_result` → Activities tab (open the matching item's detail sheet if present).
- Badge count: number of failed executions since last app open; clear on Dashboard focus.

## 10. (Reserved)

Numbering reserved to keep section references stable across revisions. Native features continue below.

## 11. Native enhancements 2–4

### 11.2 Offline outbox (activity logs only)

- Storage: `expo-sqlite` table `outbox(id TEXT PK, endpoint TEXT, body_json TEXT, idempotency_key TEXT, created_at INTEGER, attempts INTEGER, last_error TEXT)`.
- Eligible operations ONLY: `POST /workflows/execute` (activity log) and `POST /calendar/create-event` when triggered from the Log form. Chat is never queued.
- Enqueue on: no connectivity (`@react-native-community/netinfo`) or network-level failure (not 4xx — a 400/422 is a permanent validation error and must surface immediately, never queue).
- Drain: on connectivity regained + on app foreground. FIFO, one at a time, `Idempotency-Key` header (M-4) with the stored key. Success → delete row + toast "Synced {n} offline logs" (batched). Retry with exponential backoff (1/4/16 min), max 10 attempts, then mark failed and surface in Profile → Pending offline logs with manual retry/delete.
- UI surfacing: queued items render at top of Activities with `Queued` chip (7.8); count badge in Profile row (7.9.5).

### 11.3 Voice-to-log

- Library: `expo-speech-recognition` (on-device/OS speech APIs; no audio leaves the device except via the OS provider).
- Entry points: `Mic` button in chat composer (7.6) and in the Log form Notes field (7.7).
- Chat flow: press-and-hold mic → listening state (button turns #FF4400, subtle 1.5s opacity pulse ring, live partial transcript renders in the composer in #999999) → release → final transcript fills composer for review. **The user always reviews before send** — never auto-submit. The existing server-side AI intent parser (`backend/ai_chat.py`) does the heavy lifting; voice is purely input.
- Log-form flow: tap mic on Notes → same listening UI → transcript appends to Notes.
- Permission: request microphone (and iOS speech recognition) permission at first mic tap with a contextual sheet. Denied → tooltip "Enable microphone in Settings".
- Locale: device locale; expose no language picker in v1.

### 11.4 Biometric unlock

- `expo-local-authentication` + `expo-secure-store`.
- Enrollment: offered via bottom sheet right after first successful login on a capable device ("Unlock with Face ID next time?"). Toggleable in Profile → Security.
- Model: the session token ALREADY lives in SecureStore (encrypted at rest by the OS). The biometric toggle stores a `biometric_enabled` flag; when true, the app gate (7.4) requires `authenticateAsync` before rendering any authenticated screen after cold start or configured background timeout.
- Fallback: "Use password instead" → clears token, routes to login.
- Session expiry: if `/auth/me` returns 401 after successful biometric unlock, the server session died — route to login with toast "Session expired, sign in again".

---

## 12. Security requirements (binding)

1. Session token ONLY in `expo-secure-store`. Never AsyncStorage, never logged, never in Sentry breadcrumbs.
2. All traffic HTTPS. No cleartext exception in ATS / networkSecurityConfig.
3. Password fields: `secureTextEntry`, no autocorrect, excluded from Android `FLAG_SECURE`-violating screenshots on the auth screens (`expo-screen-capture` optional hardening).
4. Payload encryption per Section 8 wherever web does it.
5. Every list/query renders only the authenticated user's data — the backend scopes by `user_id` (see `CLAUDE_CODE_EXECUTION_BIBLE.md` golden rule); the client must never cache one user's data into another user's session (purge TanStack cache on logout/login).
6. Certificate pinning: out of scope v1; do not implement half-measures.
7. Jailbreak/root detection: out of scope v1.

## 13. Accessibility & quality bars

- Every touch target ≥ 44×44dp. All interactive elements have `accessibilityLabel` and correct `accessibilityRole`.
- Color contrast: all specified pairs pass WCAG AA (verify #999999 on #0A0A0A = 7.4:1 ✓; #FF4400 on #0A0A0A for text ≥ 18dp only — body-size text in brand orange must use #FF6A33 if ever needed on background; buttons use white-on-orange which passes).
- VoiceOver/TalkBack: chat messages announce as "{sender}, {message}, {time}"; status chips announce their meaning.
- Performance budgets: cold start to interactive login < 2.5s on a mid-range Android; chat send → optimistic user bubble < 100ms; screen navigation < 300ms; FlatLists use `keyExtractor`, `getItemLayout` where fixed-height, and never inline-define renderItem closures with heavy captures.

## 14. Acceptance criteria (per screen, must all pass)

**Login:** valid creds land on Dashboard with token in SecureStore; invalid creds show inline error without field clearing; 10 rapid attempts surface the rate-limit toast; password is AES-GCM encrypted on the wire (verify via backend log or proxy); biometric enrollment sheet appears once on capable devices.

**Signup/OTP:** full happy path creates an account and verifies via emailed OTP; resend disabled for 60s; wrong OTP shows error and clears boxes; back-navigation from OTP preserves entered signup data.

**Dashboard:** renders stats computed from real `/workflows/executions` data; pull-to-refresh refetches; failed executions produce the bell badge; both quick actions navigate correctly; skeleton shows on first load; empty state renders for a fresh account.

**Chat:** message round-trips to the real backend and renders markdown; history loads on mount and survives tab switches; typing indicator shows during LLM latency; 4000-char limit enforced; structured action results render as mini-cards; offline banner appears in airplane mode; suggested prompts appear only for empty history; voice press-and-hold produces an editable transcript.

**Log Activity:** account typeahead returns live results ≥2 chars; required-field validation blocks submit; successful log appears in Activities and Dashboard within one refetch; airplane-mode submit lands in the outbox, and restoring connectivity syncs it exactly once (verify idempotency by forcing a retry); Appointment + calendar toggle creates an Outlook event.

**Activities:** each filter chip hits the correct `entity_set`; both D365-native and fallback shapes render through the normalizer; detail sheet shows full notes; queued outbox items appear with Queued chip.

**Profile:** name edit persists via PATCH; change-password works then old password fails; biometric toggle gates next cold start; push toggle registers/deregisters (verify `push_tokens` collection); sign-out purges token, cache, and prompts on non-empty outbox.

**Push:** completing a workflow (success and forced failure) delivers a push to a real device; tapping it deep-links to Activities; foreground result shows as toast instead.

**Cross-cutting:** app never renders another user's cached data after account switch; all screens usable at 1.3x font scale; VoiceOver can complete login → log activity → sign out.

## 15. Execution plan (build in this order)

- **Phase 0 — Backend + skeleton:** Implement M-1…M-4 with tests. Scaffold Expo app (expo-router, TS strict, fonts, theme, tab shell with placeholder screens, `lib/api.ts`, `lib/crypto.ts` with Python round-trip fixture test).
- **Phase 1 — Auth:** Login, Signup, OTP, session bootstrap, biometric gate + enrollment, sign-out. Exit: auth acceptance criteria pass.
- **Phase 2 — Read surfaces:** Activities (normalizer first), Dashboard. Exit: their criteria pass against the real backend.
- **Phase 3 — Write surfaces:** Log Activity form (typeahead, pickers, calendar toggle), then Chat (history, send, markdown, action cards). Exit: criteria pass.
- **Phase 4 — Native layer:** Offline outbox + drain + idempotency verification; push registration + M-3 dispatch + deep links; voice input on both entry points.
- **Phase 5 — Hardening:** accessibility pass, font-scale pass, performance budgets, empty/error/skeleton audit on every screen, Maestro E2E flows (login, log-activity-offline-sync, chat round-trip), EAS build profiles (dev / preview / production) and store metadata.

## 16. Open items the agent MUST resolve from the repo before coding

1. Exact response shape of `POST /chat` (assistant text + any action/result fields) — read the full handler at `backend/server.py:768+` and `backend/ai_chat.py`.
2. Exact `POST /workflows/execute` body for `log-d365-activity` — read the handler and grep `frontend/src` for `workflows/execute` usage.
3. Field names of both `/d365/activities` response shapes — `backend/d365_client.py::list_activities` and the fallback merge at `backend/server.py:965+`.
4. `GET /accounts/search` param name + response shape — handler + `frontend/src/components/AccountSearchInput.js`.
5. Signup/OTP request/response bodies and password policy — `backend/auth_signup.py`.
6. Full list of web fields passed through `encryptField(` — grep `frontend/src`.
7. Whether `GET /chat/history` supports pagination params.
8. `PATCH /auth/me` accepted fields and `POST /auth/change-password` body.
9. The exact insertion point for M-3 push dispatch (the `/internal/log-execution` handler and/or Telegram notify path).

---

*End of Mobile App PRD Bible. Companion documents: `ARCHITECTURE_BIBLE.md`, `ENTERPRISE_SECURITY_BIBLE.md`, `AI_AND_AGENT_ARCHITECTURE_BIBLE.md`, `CLAUDE_CODE_EXECUTION_BIBLE.md`.*
