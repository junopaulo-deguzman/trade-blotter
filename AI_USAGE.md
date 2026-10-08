# AI Usage Report and Prompt Log

## How I used AI

I used ChatGPT for trading-domain questions, Codex and GitHub Copilot 
for development assistance. AI helped draft the initial scaffolding, API workflows, 
UI components, tests, and documentation.I reviewed the outputs and made the 
project decisions and amendments described
below. **All amendments in this document are my changes.**

This is a representative log, not an exhaustive transcript. Prompt wording is
abbreviated where needed; outcomes summarize the relevant responses.

## Decisions and review

- I accepted AI-assisted scaffolding for React/TypeScript, Express, PostgreSQL,
  routing, and automated tests, then adapted it to the application's workflows.
- I chose Redux Toolkit and RTK Query for shared state and typed API caching.
- I chose authenticated native WebSockets with short-lived connection tickets.
  Trade changes are broadcast after database commit; REST remains responsible for writes.
- I changed the update approach from full-list refetching on every event to
  fetching the affected trade. Full refresh is retained for reconnect recovery.
- I rejected an exclusive editing-lock workflow and single-session restriction.
  I chose last save wins, informational editing presence, and draft-preserving warnings.
- I removed recorder-only amendment/cancellation restrictions. Any authenticated
  user may change active trades; the original recorder remains metadata.
- I retained the existing session authentication rather than switching to JWT.
- I kept the final UI focused on the blotter, login, and logout, removing the
  unfinished Markets and Traders routes from the delivered navigation.

## Tools used

### ChatGPT

Mainly used for domain-specific knowledge and assistance in understanding trading platform-related content.

### Codex and GitHub Copilot

Used for development assistance, implementation, tests, and documentation.
Codex for scaffolding and Github Copilot for ongoing development assistance but mainly for auto code completion and suggestions.

## Representative prompt log

```text
Set up Docker Compose for local PostgreSQL and backend migrations, plus EC2 deployment with Nginx serving the frontend.
```

Output: Added local and EC2 Compose files, environment examples, and migration commands.

My changes: Updated the npm migration command to load the backend env file, and moved the env file into `backend`.

```text
Set up a TypeScript React frontend with Tailwind and shadcn/ui, without an external state store.
```

Output: Added the Vite frontend scaffold, shadcn/ui, and a custom theme.

My changes: Applied a custom theme for shadcn/ui components and removed sample-mode
runtime behavior; the frontend now uses the backend API.

```text
Add React Router pages for the dashboard, markets, and traders, including detail routes.
```

Output: Added routes, shared navigation, redirects, and error pages.

My changes: Protected the dashboard, added a dedicated `/logout` route, and redirect authenticated users to the dashboard.

```text
Build a sortable, paginated shadcn trade table from the sample JSON and filters.
```

Output: Added the typed dashboard table and local filters.

My changes: Added local sorting for the trade table. Also added local filtering, including side, date, and other value-driven filters. 

```text
Set up backend unit and integration tests, and use snake_case for database columns while keeping the API camelCase.
```

Output: Added Vitest and Supertest coverage, snake_case database mappings, and trade-list pagination tests.

My changes: Load integration-test database settings from the ignored `backend/.env.test` file, with a tracked example.

```text
Add a nonmodal trade drawer with symbol autocomplete, dropdowns, and a readable summary.
```

Output: Added the right-side drawer, typed trade form, options loading, and trade creation.

```text
Use Redux Toolkit and RTK Query for trade data, connect the backend endpoints, and add login/logout that persists across tabs and browser restarts.
```

Output: Replaced TanStack Query, added persistent authentication and cross-tab logout.

My changes: Moved logout behavior to the dedicated `/logout` route and removed the logged-in panel from the login page. Prepared an injectable real-time subscription boundary with tests

```text
Complete the backend trade workflows with validation, pagination, authentication, and tests.
```

Output: Added trade creation, public reads, reference lookups, bearer authentication, and endpoint tests.

```text
Simplify business errors and add TypeScript linting and formatting.
```

Output: Added one error class per feature, kept HTTP responses in routes, and configured Biome.

```text
Generate randomized trades using existing symbols, traders, and books.
```

Output: Added automatic startup initialization of 1,000 randomized persisted trades when the blotter is empty, with integration tests.

### Authenticated WebSockets

Prompt:

```text
Start the websocket implementation with a deployment to EC2 in mind.
Authentication is required for connection; prepare the frontend contract.
```

Outcome: Added authenticated single-use tickets, an HTTP upgrade handler,
trade-change notifications, heartbeat/session checks, graceful shutdown,
and Nginx/Vite upgrade forwarding.

My changes: Completed the trade-change implementation, calling the appropriate 
notification functions for trade updates and other relevant events.
Renamed the endpoint from `/api/realtime` to `/api/ws`, kept backend
routes only under `/api`, and used one-trade fetching for normal updates.

### Trade amendments, cancellation, and live feedback

Prompt:

```text
Finish live-update feedback without editing locks. Keep last save wins,
add drawer warnings and an orange editing indicator, recover after reconnect,
and enable the demo recorder through a configured startup secret.
```

Outcome: Added shared authenticated trade management, connection-based editing
presence, draft-preserving drawer warnings, cancellation disabling Save,
reconnect recovery, and startup demo-account provisioning with regression tests.

My changes: Chose informational presence rather than exclusive editing locks,
allowed multiple sessions, and made recorder identity metadata rather than a
permission rule. Extended the demo trader pool to 26 traders.

### Automatic startup dataset

Prompt:

```text
Generate randomized persisted data as the server starts, and make it 1000.
```

Outcome: Added transactional startup seeding on an empty blotter, with
concurrent-start protection and tests for persistence, preservation, and rollback.

My changes: Required exactly 1,000 trades, retained existing data on subsequent
starts, and supplied the demo login password through ignored environment configuration.

### Container deployment

Prompt:

```text
Polish the Docker Compose file and ready it for deployment.
```

Outcome: Added production API/frontend Docker builds, a separate migration stage,
health-based startup ordering, an EC2 override with private database/API ports,
and deployment documentation. Verified an isolated container stack through Nginx,
including startup seeding, login, WebSocket presence, and trade notifications.

### Streamlined local Docker run

Prompt:

```text
Do not deploy yet. Streamline the local run with Docker.
```

Outcome: Made the full application the default Compose stack, removed the app
profile requirement, and documented one-time environment setup followed by
`docker compose up -d --build --wait`. Retained host development as an optional
hot-reload path.

```text
Make symbol cards control the chart and blotter, remove the duplicate symbol
filter, and use the latest recorded execution price as a valuation trade-off.
```

Output: Added compact position cards with estimated values, shared symbol
selection, an execution-price chart, live quantity-change feedback, and tests.

My changes: Chose the cards as the single symbol control, retained a blotter
analytics scope instead of expanding into a simulator, and accepted last active
execution prices as valuation proxies without an external market-data feed.
Prices show their execution timestamps; estimates may be stale and recalculate
when the latest execution is amended or cancelled. Deferred P&L until opening
costs and cost-basis accounting are defined.

```text
Move the date filter above the positions, chart and table. Carry earlier holdings
forward and replace the noisy execution line with daily weighted-average prices.
```

Output: Added a shared inclusive UTC date range, period opening/closing holdings,
price references through the end date, and a daily quantity-weighted chart.

My changes: Chose carry-forward holdings rather than discarding earlier trades,
and daily quantity-weighted execution prices rather than a scatter plot. Symbol
selection preserves dates. Historical views derive from current records, without
introducing an audit history or external price feed.

```text
The chart struggles to follow the cursor. Move Refresh to the top-level controls.
```

Output: Cached chart geometry and labels, isolated pointer selection from the
static SVG, selected nearest points across the whole plot, coalesced pointer
movement with animation frames, and moved Refresh beside the global date range.
Added interaction and refresh tests; profiled a temporary 1,000-trade preview.

My changes: Treat Refresh as a dashboard action because it reloads trades and
opening holdings together, preserving dates and symbol selection. Retained
keyboard navigation alongside full-plot pointer interaction.
