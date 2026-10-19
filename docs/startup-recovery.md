# Startup recovery investigation — 2026-10-19

Reported symptom: opening Codex occasionally produces no theme.

## Findings before changing code

1. The running renderer had a mounted theme panel, but `nativeFailed=true`. The retained host error was `Codex main window was not found.` The original main process was still running. A mounted panel therefore did not establish that the native glass was working.
2. In `theme-host.mjs`, a failed initial native request called `backdropWatch.off()`. Later focus/surface checks only sent `CHECK` to that disabled watcher, which had no valid watched window. No code replayed the failed initial application.
3. The login watcher's recorded PID no longer existed. Its scheduled task was `Ready` with last result `0xC000013A`, while old JSON still said `armed`/`connected`. The task had a logon trigger and limited restart-on-failure settings, but no periodic recovery trigger. The available records do **not** identify what originally interrupted that process.

## Reproduction and changes

The original request handlers were executed with a controlled native-window lifecycle: the renderer requests its background before the window exists, the first request fails, then the window becomes ready and emits a check. The old implementation made only `background` and fallback `restore` calls; it never retried `background`.

The corrected host retries that specific temporary window failure up to five times, using bounded delays. A later focus/surface check can replay a failed request even after that budget is exhausted. New user choices cancel pending recovery, so restoring the original appearance cannot be undone by an old retry. Permanent native failures remain errors rather than a tight retry loop.

The login task now also has an indefinite one-minute trigger. `IgnoreNew` and the existing named mutex retain one worker; the extra trigger can recover exits that do not qualify for Task Scheduler's failure-restart budget. A separate, limited-user fixture task verified a normal early exit followed by an automatic scheduled run. The fixture did not touch the real Codex process or package callback.

The watcher writes a fresh heartbeat. The theme probe now records native readiness, pending state, and failures separately from panel mount. The watcher periodically re-verifies accepted instances and does not label a mounted-but-failed native background as connected.

## Verification

| Check | Evidence and boundary |
| --- | --- |
| Native recovery regression tests | Six controlled lifecycle cases: delayed window, focus recovery, restore cancellation, bounded budget, permanent error, and stopping during retry. These exercise the actual host handlers with controlled dependencies. |
| Health regression tests | Mounted-but-failed or pending themes are not native acceptance; an explicit success is required. |
| Node suite | 31 tests passed, including the existing aquarium, Cosmos, appearance, and Windows policy checks. |
| Chromium panel interactions | Both compatibility and native-request policies pass; the native bridge is stubbed. This is not Windows DWM acceptance. |
| Real scheduled task | A current-user fixture ran again after a successful early exit, using the actual one-minute recovery trigger. |
| Official packaged activation | A fresh isolated app received patched startup arguments, exposed loopback CDP and a ready renderer, and was cleaned up while the existing main process was preserved. This check did not establish full theme acceptance in that isolated instance. |
| Existing live Windows 11 app | Same main PID/creation identity preserved; updated helper loaded without closing Codex. Renderer reported `nativeReady=true`, `nativeFailed=false`, `nativePending=false`; Windows reported Acrylic backdrop value `3`. |
| Saved settings | Capture settings were restored after the README screenshots; local wallpaper storage was not replaced. |

The live installation received the host recovery and watcher changes. The GitHub Releases installer was not replaced.

## Remaining acceptance

- A complete sign-out/sign-in and normal fully closed → usual-icon launch after this fix.
- A clean install/launch/uninstall cycle on another Windows 10/11 machine.
- The original cause of the watcher's interruption. Periodic recovery addresses remaining offline, but does not prove why that interruption occurred.

If a new failure occurs, correlate fresh `watcher-health.json`, `attach-status.json`, `host-error.log`, callback records and startup timestamps. A missing CDP argument, slow page readiness, dead watcher and failed native window request are different failure states. Preserve that evidence before restarting anything.
