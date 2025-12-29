/**
 * UPSTOX BRIDGE SERVER + QUESTDB INGESTION
 * ----------------------------------------
 * 1. Connects to Upstox V3 WebSocket (Protobuf).
 * 2. Relays decoded JSON to Frontend.
 * 3. Automatically initializes QuestDB Schema.
 * 4. Persists live Ticks and Depth to QuestDB.
 * 5. Resolves Instrument Keys (Futures) using NSE Master List.
 * 
 * PREREQUISITES:
 * npm install ws protobufjs upstox-js-sdk axios
 */

import { WebSocket, WebSocketServer } from 'ws';
import protobuf from 'protobufjs';
import path from 'path';
import https from 'https';
import axios from 'axios';
import { fileURLToPath } from 'url';
import fs from 'fs';
import zlib from 'zlib'; // For decompressing Master List

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = 4000;
const QUESTDB_URL = 'http://localhost:9000/exec'; // Default QuestDB REST Endpoint

// State
let upstoxSocket = null;
let frontendSocket = null;
let protobufRoot = null;
let currentInstruments = new Set();
let masterInstruments = []; // Cache for NSE Instruments
let userToken = process.env.UPSTOX_ACCESS_TOKEN || null;

// Load Protobuf Definition
const PROTO_FILENAME = 'market_data_feed.proto';
const POSSIBLE_PATHS = [
    path.join(__dirname, '../', PROTO_FILENAME),
    path.join(__dirname, PROTO_FILENAME),
    path.join(process.cwd(), PROTO_FILENAME)
];

let PROTO_PATH = POSSIBLE_PATHS.find(p => fs.existsSync(p));

if (!PROTO_PATH) {
    console.error(`CRITICAL: Could not find '${PROTO_FILENAME}'. Please download it to the project root.`);
    process.exit(1);
}

// Check if file is actually HTML (Common download error)
const fileContent = fs.readFileSync(PROTO_PATH, 'utf-8').trim();
if (fileContent.startsWith('<') || fileContent.includes('<!DOCTYPE html>')) {
    console.error(`CRITICAL: The file '${PROTO_FILENAME}' appears to be HTML/XML, not a Protobuf definition.`);
    console.error("Please download the 'Raw' content from GitHub, not the web page.");
    process.exit(1);
}

let FeedResponse;
let FeedResponseSchema; // For manual decoding if needed

// Helper: Recursively find a Message type by name in the Protobuf Root
function findTypeByName(root, name) {
    if (root.name === name) return root;
    if (root.nested) {
        for (const key of Object.keys(root.nested)) {
            const found = findTypeByName(root.nested[key], name);
            if (found) return found;
        }
    }
    return null;
}

try {
    const root = protobuf.loadSync(PROTO_PATH);
    FeedResponse = findTypeByName(root, "FeedResponse");
    
    if (!FeedResponse) {
        throw new Error("Could not find 'FeedResponse' message type");
    }
} catch (e) {
    console.error("CRITICAL: Failed to load/parse Protobuf definition.", e);
    process.exit(1);
}

// =============================================================================
// INSTRUMENT MASTER LOGIC
// =============================================================================

const INDEX_TO_SYMBOL = {
    'Nifty 50': 'NIFTY',
    'Nifty Bank': 'BANKNIFTY',
    'Nifty Fin Service': 'FINNIFTY',
    'NIFTY': 'NIFTY',
    'BANKNIFTY': 'BANKNIFTY'
};

async function loadInstrumentMaster() {
    console.log("⬇️  Downloading NSE Instrument Master List (this may take a moment)...");
    try {
        const response = await axios.get('https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz', {
            responseType: 'arraybuffer'
        });
        const buffer = zlib.gunzipSync(response.data);
        const json = JSON.parse(buffer.toString('utf-8'));
        
        // Filter only FUT to save memory
        masterInstruments = json.filter(i => i.segment === 'NSE_FO' && i.instrument_type === 'FUT');
        console.log(`✅ Loaded ${masterInstruments.length} NSE Futures contracts.`);
    } catch (e) {
        console.error("❌ Failed to load Instrument Master:", e.message);
    }
}

// Call on startup
loadInstrumentMaster();

function findFutureContract(indexName) {
    // 1. Resolve generic symbol (e.g. "Nifty 50" -> "NIFTY")
    // Try to match from the map, or check if the indexName itself contains the key
    let symbol = INDEX_TO_SYMBOL[indexName];
    if (!symbol) {
        // Fallback: try to split "NSE_INDEX|Nifty 50" -> "Nifty 50"
        const cleanName = indexName.includes('|') ? indexName.split('|')[1] : indexName;
        symbol = INDEX_TO_SYMBOL[cleanName] || cleanName.toUpperCase().split(' ')[0];
    }
    
    if (!symbol) return null;

    console.log(`Searching Future for Symbol: ${symbol}`);

    // 2. Filter Master List
    const futures = masterInstruments.filter(i => 
        (i.name === symbol || i.trading_symbol.startsWith(symbol)) && 
        i.instrument_type === 'FUT'
    );

    if (futures.length === 0) return null;

    // 3. Sort by Expiry to find the nearest current month
    // Format is YYYY-MM-DD
    const today = new Date().toISOString().split('T')[0];
    
    const validFutures = futures
        .filter(f => f.expiry >= today)
        .sort((a, b) => a.expiry.localeCompare(b.expiry));

    return validFutures.length > 0 ? validFutures[0] : null;
}

// =============================================================================
// QUESTDB LOGIC
// =============================================================================

async function initQuestDB() {
    const createTicks = `
        CREATE TABLE IF NOT EXISTS market_ticks (
            instrument_key SYMBOL,
            price DOUBLE,
            volume DOUBLE,
            oi DOUBLE,
            timestamp TIMESTAMP
        ) TIMESTAMP(timestamp) PARTITION BY DAY WAL;
    `;
    const createDepth = `
        CREATE TABLE IF NOT EXISTS market_depth (
            instrument_key SYMBOL,
            bid_price DOUBLE,
            bid_qty DOUBLE,
            ask_price DOUBLE,
            ask_qty DOUBLE,
            timestamp TIMESTAMP
        ) TIMESTAMP(timestamp) PARTITION BY DAY WAL;
    `;

    try {
        await axios.get(QUESTDB_URL, { params: { query: createTicks } });
        await axios.get(QUESTDB_URL, { params: { query: createDepth } });
        console.log("✅ QuestDB Tables Ready");
    } catch (err) {
        console.log("⚠️ QuestDB not detected on port 9000. Running in Memory Mode.");
    }
}

async function saveToQuestDB(feedObject) {
    if (!feedObject.feeds) return;
    const queries = [];
    Object.keys(feedObject.feeds).forEach(key => {
        const feed = feedObject.feeds[key];
        if (feed.fullFeed && feed.fullFeed.marketFF) {
            const ff = feed.fullFeed.marketFF;
            if (ff.ltpc) {
                const price = ff.ltpc.ltp;
                const volume = ff.vtt ? parseFloat(ff.vtt) : 0;
                const oi = ff.oi ? parseFloat(ff.oi) : 0;
                queries.push(`INSERT INTO market_ticks VALUES ('${key}', ${price}, ${volume}, ${oi}, systimestamp())`);
            }
        }
    });

    if (queries.length > 0) {
        try {
            for (const q of queries) {
                 axios.get(QUESTDB_URL, { params: { query: q } }).catch(() => {});
            }
        } catch (e) {}
    }
}

// =============================================================================
// SERVER SETUP
// =============================================================================

const wss = new WebSocketServer({ port: PORT });
console.log(`Bridge Server running on ws://localhost:${PORT}`);

initQuestDB();

wss.on('connection', (ws) => {
    console.log("Frontend connected to Bridge");
    frontendSocket = ws;

    ws.on('message', async (message) => {
        try {
            const msg = JSON.parse(message);
            
            if (msg.type === 'init') {
                userToken = msg.token || userToken; 
                if (msg.instrumentKeys) msg.instrumentKeys.forEach(k => currentInstruments.add(k));
                
                if (userToken) {
                    connectToUpstox();
                } else {
                    ws.send(JSON.stringify({type: 'error', message: 'Missing Access Token'}));
                }
            } else if (msg.type === 'subscribe') {
                if (msg.instrumentKeys) {
                    msg.instrumentKeys.forEach(k => currentInstruments.add(k));
                    if (upstoxSocket && upstoxSocket.readyState === WebSocket.OPEN) {
                         // V3 requires reconnect to update subs usually, but we'll try sending logic if supported
                         // Simpler to just reconnect for this bridge
                         connectToUpstox();
                    }
                }
            } else if (msg.type === 'get_option_chain') {
                const token = msg.token || userToken;
                if (!token) {
                     ws.send(JSON.stringify({ type: 'error', message: 'No Access Token found.' }));
                     return;
                }
                try {
                    console.log(`Fetching Option Chain for ${msg.instrumentKey}...`);
                    const response = await axios.get('https://api.upstox.com/v2/option/contract', {
                        params: { instrument_key: msg.instrumentKey },
                        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
                    });

                    // 1. Find Future Contract
                    const indexName = msg.instrumentKey.split('|')[1]; // e.g. "Nifty 50"
                    const futureContract = findFutureContract(indexName);
                    
                    if (futureContract) {
                        console.log(`Found Future: ${futureContract.trading_symbol} (${futureContract.instrument_key})`);
                    } else {
                        console.log("Could not resolve Future contract automatically.");
                    }

                    ws.send(JSON.stringify({
                        type: 'option_chain_response',
                        data: response.data.data,
                        underlyingKey: msg.instrumentKey,
                        futureContract: futureContract 
                    }));

                } catch (err) {
                    console.error("Option Chain API Error:", err.message);
                    ws.send(JSON.stringify({ type: 'error', message: 'Failed to fetch chain. Check Token/Key.' }));
                }
            } else if (msg.type === 'get_quotes') {
                 // Fetch LTP/Quotes via REST API
                 const token = msg.token || userToken;
                 if (!token) return;
                 try {
                     const keys = msg.instrumentKeys.join(',');
                     console.log(`Fetching Quotes for ${keys}...`);
                     const response = await axios.get('https://api.upstox.com/v2/market-quote/ltp', {
                         params: { instrument_key: keys },
                         headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
                     });
                     ws.send(JSON.stringify({
                         type: 'quote_response',
                         data: response.data.data
                     }));
                 } catch (err) {
                     console.error("Quote API Error:", err.message);
                 }
            }
        } catch (e) {
            console.error("Error processing message:", e);
        }
    });

    ws.on('close', () => { frontendSocket = null; });
});

async function getAuthorizedUrl(token) {
    const instrumentList = Array.from(currentInstruments).join(',');
    
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.upstox.com',
            path: '/v3/feed/market-data-feed/authorize',
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        if (json.data && json.data.authorizedRedirectUri) {
                             resolve(json.data.authorizedRedirectUri);
                        } else {
                             reject(new Error("No redirect URI"));
                        }
                    } catch (e) { reject(e); }
                } else {
                    reject(new Error(`API Error ${res.statusCode}`));
                }
            });
        });
        req.on('error', (e) => reject(e));
        req.end();
    });
}

async function connectToUpstox() {
    if (upstoxSocket) {
        upstoxSocket.removeAllListeners();
        upstoxSocket.terminate();
    }

    try {
        console.log("Authorizing...");
        const wsUrl = await getAuthorizedUrl(userToken);
        console.log("Connecting to Upstox V3...");

        upstoxSocket = new WebSocket(wsUrl);
        upstoxSocket.binaryType = 'arraybuffer';

        upstoxSocket.on('open', () => {
            console.log("Connected to Upstox");
            if (frontendSocket) frontendSocket.send(JSON.stringify({ type: 'connection_status', status: 'CONNECTED' }));
        });

        upstoxSocket.on('message', (data) => {
            try {
                const buffer = Buffer.from(data);
                const message = FeedResponse.decode(buffer);
                const object = FeedResponse.toObject(message, {
                    longs: String,
                    enums: String,
                    bytes: String,
                });
                
                if (frontendSocket && frontendSocket.readyState === WebSocket.OPEN) {
                    frontendSocket.send(JSON.stringify(object));
                }
                saveToQuestDB(object);
            } catch (e) { console.error("Decode Error:", e); }
        });
        
        upstoxSocket.on('error', console.error);
        upstoxSocket.on('close', () => {
             console.log("Upstox Disconnected");
             if (frontendSocket) frontendSocket.send(JSON.stringify({ type: 'connection_status', status: 'DISCONNECTED' }));
        });

    } catch (e) {
        console.error("Connection Failed:", e.message);
        if (frontendSocket) frontendSocket.send(JSON.stringify({ type: 'error', message: e.message }));
    }
}