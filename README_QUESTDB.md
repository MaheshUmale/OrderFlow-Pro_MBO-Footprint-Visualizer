# QuestDB Setup for OrderFlow Pro

To enable historical data storage and "Bookmap" style replay, this application integrates with QuestDB.

## 1. Run QuestDB (Docker)

The easiest way to run QuestDB is via Docker. Run the following command in your terminal:

```bash
docker run -p 9000:9000 -p 9009:9009 -p 8812:8812 questdb/questdb
```

*   **Port 9000**: REST API and Web Console (Used by our Node.js Bridge).
*   **Port 9009**: InfluxDB Line Protocol (Optional for high-speed ingestion).
*   **Port 8812**: Postgres Wire Protocol.

## 2. Verify Installation

1.  Open your browser to [http://localhost:9000](http://localhost:9000).
2.  You should see the QuestDB Web Console.

## 3. Automatic Schema Creation

When you run `node server/upstox-bridge.js` for the first time:
1.  It attempts to connect to `http://localhost:9000`.
2.  It automatically runs `CREATE TABLE IF NOT EXISTS` for:
    *   `market_ticks`
    *   `market_depth`
    *   `trade_signals`
3.  As live data flows in from Upstox, it will populate these tables.

## 4. Querying Data

You can query your data directly in the Web Console:

```sql
-- Check last 100 ticks
SELECT * FROM market_ticks ORDER BY timestamp DESC LIMIT 100;

-- Check Depth History for a specific instrument
SELECT * FROM market_depth WHERE instrument_key = 'NSE_FO|NIFTY_FUT' LIMIT 100;
```
