# Authenticated trade updates

The REST API remains responsible for writes. WebSocket messages identify the trade to refetch;
they never replace an open drawer's draft. Amendments use last save wins.

## Connect from the frontend

1. While logged in, POST `/api/ws/ticket` with
   `Authorization: Bearer <accessToken>`. No request body is required.
   Response: `{ "ticket": "<opaque value>", "expiresAt": "<UTC ISO timestamp>" }`.
   Tickets expire after 30 seconds and can be consumed only once. Endpoint returns
   401 for invalid authentication and 429 after 30 requests per IP per minute.
2. Open `/api/ws?ticket=<encoded ticket>` with the native browser WebSocket.
   Use `wss:` for HTTPS and `ws:` locally. Never put the access token in this URL.
3. Wait for `{ "type": "connection.ready", "connectionId": "<opaque connection ID>" }` before reporting `connected`.
   The first connection reuses an in-flight initial list load. If the initial load
   already finished, or this is a reconnect, refresh the full list to recover gaps.
4. On a `trade.changed` message, RTK Query fetches `getTradeById(event.tradeId)`
   and patches only that row in the trade-list cache. Created trades are prepended
   in the cache but held outside the table until Show new trades is clicked; existing
   rows remain live. Drawer drafts remain separate. Use the manual Refresh button
   to reload the full list and recover missed changes.
5. Close the socket on logout, session replacement, or subscription cleanup.
   The browser adapter retries network failures after 3 seconds and obtains a new
   ticket for every attempt. Unauthorized sessions use existing session handling.

```ts
const response = await fetch("/api/ws/ticket", {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}` },
});
if (!response.ok) throw new Error(`Ticket request failed: ${response.status}`);
const { ticket } = await response.json();
const url = new URL("/api/ws", window.location.origin);
url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
url.searchParams.set("ticket", ticket);
const socket = new WebSocket(url);
```

If using a separate API origin, construct the URL from that API's base URL instead.
Browser WebSocket errors do not expose the HTTP upgrade rejection status; obtain
fresh tickets through HTTP to distinguish expired authentication from connectivity.
Frontend types are in `frontend/src/types/ws.ts`. The existing injected
`TradeUpdatesClient` can map ready to `onStatus("connected")`, changes to
`onChange(event)`, and closure to `onStatus("disconnected")`. The browser adapter is implemented in `frontend/src/lib/trade-updates-client.ts`
and is enabled by default in the application store.

## Event contract

JSON text frames:

```json
{ "type": "connection.ready", "connectionId": "<opaque connection ID>" }
{ "type": "trade.changed", "tradeId": "TD-00042", "action": "created" }
```

Actions: `created`, `amended`, `cancelled`. All three services publish after their
persistence transaction commits. `PATCH /api/trades/:id` amends a trade using the
same validated fields as creation; `PATCH /api/trades/cancel/:id` cancels it.
Both require authentication and an active trade; any authenticated user may amend/cancel.
Missing trades return 404 and cancelled trades return 409. Any authenticated recorder may amend/cancel active trades.

Show new trades (N), beside Refresh, counts all pending arrivals regardless of
filters. Clicking it reveals cached rows without a request, resets sorting and all
filters, returns to page 1, and preserves page size. This also applies to local
creation. Repeated creation events do not queue an already known trade again.
Revealed active rows fade green and keep a dot until a successful full-list refresh.
Amended rows fade blue; cancelled rows retain a gray background. A successful refresh
includes pending rows and clears their indicators, while a failed refresh retains them.
The Active only toggle filters the table alongside its existing date and field filters.
Events go to every currently authenticated client, including the writer. There is
no replay, delivery guarantee, or ordering guarantee across asynchronous session
checks. Refetch retrieves authoritative state. Only editing-presence application messages are accepted; malformed/unsupported messages close with 1008. Browser ping/pong handling is automatic.

## Authentication and lifecycle

The upgrade accepts only `/api/ws`, an exact allowed Origin, and a valid,
unexpired single-use ticket whose backing database session still exists. Other
paths return 404; rejected origins return 403; invalid tickets/sessions return 401;
lookup failures return 503. Session tokens and WebSocket messages are never logged.
Sessions are checked before each trade notification and every 30 seconds. Expired
or revoked sessions close with 4401; lookup failures close with 1011. Idle revoked
connections can remain open up to 30 seconds but receive no subsequent trade events.
Ping every 30 seconds detects dead peers. Slow clients with more than 64 KiB queued
are disconnected. Incoming payloads are capped at 1 KiB; compression is disabled.
Shutdown closes sockets with 1001, then terminates remaining sockets after 1 second.

## EC2 deployment

See [the deployment guide](deployment.md) for the Compose build, migration, and
EC2 startup commands. Run one API process behind Nginx. Set `WS_ALLOWED_ORIGINS=https://your-domain.example`
in `.env.ec2` (comma-separated exact origins, no trailing slash). Production startup
fails without this setting. Local defaults include Vite on port 5173 and Nginx on
8080. If Vite chooses another port, update the allowlist.

Nginx omits the upgrade endpoint from access logs to protect short-lived tickets.
Configure any upstream load balancer/access tracing to redact its query string too.
Nginx forwards HTTP/1.1 Upgrade and Connection headers and uses a 75-second idle
read timeout, longer than the server heartbeat. Vite's `/api` proxy also supports
WebSocket upgrades. Terminate TLS at Nginx or an AWS load balancer; the supplied
Nginx configuration alone does not provision HTTPS. Set any load balancer idle
timeout above 30 seconds (75 seconds recommended). Expose only the proxy ports in
the EC2 security group; keep API port 3000 and PostgreSQL private. If using
`TRUST_PROXY=1`, ensure precisely one trusted HTTP reverse proxy reaches Express.

Tickets and event delivery are process-local. Multiple API workers/instances need
shared tickets and pub/sub (or sticky ticket routing plus shared pub/sub). A restart
invalidates pending tickets and disconnects clients; reconnect and refetch recover.
This is intentionally a single-process assessment implementation.

The proxy settings follow the [Nginx WebSocket documentation](https://nginx.org/en/docs/http/websocket.html),
and server upgrade/heartbeat handling uses [ws](https://github.com/websockets/ws).

## Editing presence and drawer behavior

Clients send `{ "type": "trade.editing", "tradeId": "TD-00042" }` on opening an
amendment drawer, or `tradeId: null` on closing/successful save. Each connection has
one current edited trade. Editor identity comes from the authenticated database
session. Presence is informational: any authenticated user can save or cancel an
active trade; the original `recordedById` never changes.

Server messages:

```json
{ "type": "editing.snapshot", "trades": [{ "tradeId": "TD-00042", "editors": [{ "connectionId": "opaque", "userId": 8, "name": "Recorder" }] }] }
{ "type": "trade.editing", "tradeId": "TD-00042", "editors": [] }
```

Snapshots replace local presence on every connection; incremental messages replace
one trade's editor list. An empty list clears its dot. The ready message contains
the local connection ID, allowing the drawer to distinguish other tabs of the same
account from itself. Presence is cleared on disconnect/session rejection and
resent for the open drawer on reconnect. Dead connections may remain visible
until heartbeat cleanup. There are no locks, persistence, or presence-driven trade
refetches. Presence is local to the single API process, like trade events.

Drawer drafts are initialized once from the opening trade. Latest cached values
are compared independently to show an overwrite warning; cancellation disables
saving. Last save wins among successful amendments; backend row locks reject
amendments after cancellation. Reconnect refetches the full list, while normal
trade events fetch one row. A change overlapping a list read schedules a follow-up
refresh instead of allowing the stale list to overwrite it.
