# OrderFlow Pro: Feed Configuration & Data Protocol

## 1. Overview
OrderFlow Pro requires a specific JSON structure to function in "Institutional Mode" (Phase Two). This mode enables Market Clustering (Index + Future + Options correlation) and Dynamic OI Tracking.

## 2. Market Cluster Configuration
The backend must provide a `config.json` (or via API `/api/config`) on startup. This maps the relationships between instruments.

### JSON Structure
```json
{
  "clusters": [
    {
      "clusterId": "NIFTY_INTRADAY",
      "name": "NIFTY 50",
      "spotInstrumentId": "NSE_INDEX|NIFTY 50",
      "futureInstrumentId": "NSE_FO|NIFTY_FUT_CUR",
      "spotStrikeStep": 50,
      "optionChain": {
        "24000": { "CE": "NSE_FO|12345", "PE": "NSE_FO|12346" },
        "24050": { "CE": "NSE_FO|12347", "PE": "NSE_FO|12348" },
        "24100": { "CE": "NSE_FO|12349", "PE": "NSE_FO|12350" }
      }
    }
  ]
}
```

## 3. Real-Time Feed Protocol
The feed is expected to be a stream of JSON objects (or WebSocket frames).

### Key Requirements for OI Tracking
1.  **Field Name:** `oi` (Open Interest) inside `marketFF`.
2.  **Format:** String or Number.
3.  **Frequency:** Send with every Tick or at least every 1-minute candle close.
4.  **Data Integrity:** The backend is the source of truth. If the frontend reconnects, it must receive the *current* cumulative OI.

### Example Frame
```json
{
  "type": "live_feed",
  "feeds": {
    "NSE_FO|12345": {
      "fullFeed": {
        "marketFF": {
          "ltpc": { "ltp": 24050.55 },
          "vtt": "1500000",
          "oi": "4500000"  <-- CRITICAL FOR OI ANALYSIS
        }
      }
    }
  }
}
```

## 4. Derived Logic (Frontend vs Backend)
*   **Frontend Responsibilities:**
    *   Calculate `OI Delta` = `Current OI` - `Previous OI`.
    *   Determine Interpretation (e.g., Short Covering).
    *   Visualize changes on the dashboard.
*   **Backend Responsibilities:**
    *   Ensure `oi` field is accurate.
    *   Store history (see Database Schema).
