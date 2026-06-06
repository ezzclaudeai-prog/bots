# AOIRUSRA Data Spy — v2.0

Chrome MV3 extension that captures Pocket Option's live data **in the user's own
browser session** for personal trading-bot research.

## Protocol (reverse-engineered from real captures)

- **Transport:** socket.io v4 / Engine.IO 4 over WebSocket. Trading data rides on
  `wss://demo-api-eu.po.market` (and `*-api-*.po.market`).
- **No encryption, no msgpack, no protobuf.** "Binary" frames are socket.io
  **BINARY_EVENT attachments whose bytes are plain UTF-8 JSON**:
  - A text header frame `451-["updateStream",{"_placeholder":true,"num":0}]`
  - …followed by a binary attachment whose bytes are e.g. `[["AUDCAD_otc",1780699719.905,0.99326]]`
- v1's msgpack decoder mis-read every frame (first byte `[`=0x5b=91 → fixint 91).
  v2 decodes **JSON-first**, with a genuine msgpack pass only as a real fallback,
  and reassembles `451` headers with their attachments **per-socket**.

### Key event schemas

| Event | Payload | Meaning |
|---|---|---|
| `updateStream` | `[[sym, serverTs, price]]` | price **tick** (single mid price) |
| `chafor` | `[[sym, secs]]` | seconds left in candle |
| `successopenOrder` | deal object | trade opened (`command` 0=CALL,1=PUT) |
| `successcloseOrder` | `{profit, deals:[…]}` | trade(s) settled |
| `failopenOrder` | `{error, amount, …}` | order rejected |
| `successupdateBalance` | `{isDemo, balance}` | balance update |
| `updateHistoryNewFast` | `{asset, period, history:[[ts,px]]}` | backfill |

> **There is no order book / bid-ask depth in the feed.** PO sends one mid price
> per tick, so true Bid/Ask Spread and Order Book Imbalance (OBI) are not
> derivable. Those fields are emitted as `null` (schema-stable) and a depth-aware
> path is wired in case a depth-bearing event ever appears.

## Output: structured NDJSON stream (`📊 .ndjson`)

One JSON object per line, ready for Python/R / ZeroMQ / Redis ingestion:

```json
{"ts":1780699719905,"type":"TICK","asset":"AUDCAD_otc","data":{"price":0.99326,"serverTs":1780699719.905,"priceDelta":-0.00007,"direction":-1,"runLength":2,"interTickMs":455,"expectedNextTickMs":470,"velocity":-0.00015,"realizedVol":3.1e-5,"tickRate":2.1,"latencyMs":83,"bid":null,"ask":null,"spread":null,"obi":null}}
```

Record types: `TICK`, `TRADE_OPEN`, `TRADE_CLOSE`, `ORDER_PENDING`,
`ORDER_REJECTED`, `BALANCE`, `CANDLE_TIMING`, `HISTORY`, `LATENCY`.

## Architecture

- `spy_injected.js` (MAIN world): transparent WebSocket/Worker/fetch/XHR hooks,
  JSON-first decoder + 451 reassembly, per-asset microstructure engine, raw
  TypedArray ring buffer, **batched** CustomEvent emit.
- `spy_content.js` (ISOLATED): two pipelines — verbose human log + sliding-window
  NDJSON bot feed; reconnect-safe append-only persistence; HUD + exports.
- `background.js`: separate capped storage for `spyLog` and `spyStream`; downloads.

### Notes on infeasible requests
- **SharedArrayBuffer** can't cross the MAIN↔ISOLATED world boundary and needs
  cross-origin-isolation headers PO doesn't set → batched CustomEvent is the
  real main-thread win.
- **"Microsecond" latency** isn't available in-browser; timing uses ms wall-clock
  (`latencyMs` = local recv − server tick time, an estimate with clock skew).
