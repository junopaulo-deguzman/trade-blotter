# Two-user reviewer walkthrough

Start the application using the [Docker quick start](../README.md#run-locally-with-docker).
This walkthrough uses two separate accounts and browser sessions. It changes demo
trades; no deployment or database reset is needed.

## Create the second account

From the repository root, with the Docker stack running:

```sh
docker compose exec api sh /usr/local/bin/backend-entrypoint node scripts/create-user.ts --username reviewer-two --name "Reviewer Two"
```

Enter a password of 12–1,024 characters at the hidden interactive prompt. The
password is not a command argument or printed in logs. Keep this terminal
interactive; do not add `-T`. This command creates the account once. If it already
exists and you need a new password, run the same command with `--reset-password`;
that revokes its existing sessions.

For host development, the equivalent command is:

```sh
npm --prefix backend run user:create -- --username reviewer-two --name "Reviewer Two"
```

## Open two independent sessions

- **User A:** Open `http://localhost:8080` in a normal browser window and log in as
  `seed-recorder` with the password configured during startup.
- **User B:** Open the same URL in a private/incognito window or another browser
  and log in as `reviewer-two` with the password entered above.
- For host development, use the Vite URL (normally `http://localhost:5173`) in
  both windows instead.

Two ordinary tabs in one browser profile share `localStorage`; logging in or out
synchronizes those tabs. They can test multiple connections for the same account,
but use separate browser storage to test distinct users. Multiple private windows
in one browser may also share a private session, so normal plus private is easiest.

Wait for **Live updates** in both dashboards. Leave dates and symbol selection
cleared, and choose the same ACTIVE trade by ID in both windows. Use separate
trades for the following tests if convenient.

## Test checklist

| Action | Expected result |
| --- | --- |
| A opens an amendment drawer. | B sees an orange dot beside that trade ID; its tooltip identifies A. |
| B also opens that trade. | Both drawers identify the other editor. Save remains available: presence is informational. |
| A changes quantity locally without saving. B changes quantity to a different valid number and saves. | A retains the typed draft and sees the changed-trade warning. The table, position cards, and charts reflect B's confirmed value. |
| A now saves the retained draft. | A's value becomes the current value in both windows: last save wins. B can amend A's trade even though B is not its original recorder. |
| A closes the drawer after reopening it. | B's editing tooltip/drawer no longer lists A. Successful saves also clear that connection's editing presence; failed saves retain it. |
| A opens a different ACTIVE trade and types a draft. B cancels it from the table actions. | A retains the draft, sees the cancellation notice, and cannot save. Both dashboards exclude the cancelled trade from position and chart calculations. |
| B creates a trade. | A sees **Show new trades (N)**. Position cards and charts already include it; selecting Show new trades reveals the row and resets filters. |
| Close A's browser window while it has an amendment open. | B loses A's editing indicator after disconnect cleanup. Abrupt network failures can take until heartbeat cleanup. |

For chart changes, use a trade's symbol card and a date range containing its UTC
execution date. Dates filter both charts and the table, while position cards
always include all dates. The activity chart includes ACTIVE buys and sells;
opening holdings do not count as daily activity.

## Check missed-update recovery

1. In A's browser developer tools, set the Network connection to **Offline** and
   wait for the live-update indicator to show reconnection. This should disconnect
   A's WebSocket as well as HTTP requests; browser behavior can vary.
2. While A is disconnected, amend a trade in B.
3. Restore A to **Online** and wait for **Live updates**.
4. Confirm A shows B's latest value without manually pressing Refresh. Reconnect
   fetches the full blotter to recover committed changes missed while offline.

If Offline did not close the WebSocket, that run has not tested a missed event.
The connection status makes this distinction visible. Reconnect recovery restores
current state; events are not a durable audit log.

## Assumptions

Any authenticated user can amend/cancel ACTIVE trades. The original recorder
metadata remains unchanged. Editing indicators never reserve or lock a trade.
Server transactions reject amendments to cancelled trades, even if a client has
not yet received the cancellation event. Run one API process for this demo:
tickets, editing presence, and event broadcasting are process-local.

Startup never resets an enabled account's password. Changing
`SEED_RECORDER_PASSWORD` after initial provisioning does not change its login;
use the documented password-reset CLI when necessary. No shared default password
or public registration endpoint is provided.
