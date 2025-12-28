-- QuestDB Schema Definition
-- Run these in your QuestDB Web Console (http://localhost:9000) if not initialized automatically.

-- 1. Market Ticks (High Frequency)
CREATE TABLE IF NOT EXISTS market_ticks (
    instrument_key SYMBOL,
    price DOUBLE,
    volume DOUBLE,
    oi DOUBLE,
    timestamp TIMESTAMP
) TIMESTAMP(timestamp) PARTITION BY DAY WAL;

-- 2. Market Depth (Top of Book Snapshots)
CREATE TABLE IF NOT EXISTS market_depth (
    instrument_key SYMBOL,
    bid_price DOUBLE,
    bid_qty DOUBLE,
    ask_price DOUBLE,
    ask_qty DOUBLE,
    timestamp TIMESTAMP
) TIMESTAMP(timestamp) PARTITION BY DAY WAL;

-- 3. Trade Signals (AI Generated)
CREATE TABLE IF NOT EXISTS trade_signals (
    instrument_key SYMBOL,
    signal_type SYMBOL,
    side SYMBOL,
    price DOUBLE,
    message STRING,
    timestamp TIMESTAMP
) TIMESTAMP(timestamp) PARTITION BY MONTH WAL;
