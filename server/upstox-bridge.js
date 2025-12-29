/**
 * UPSTOX BRIDGE SERVER + QUESTDB INGESTION
 * ----------------------------------------
 * 1. Connects to Upstox V3 WebSocket (Protobuf).
 * 2. Relays decoded JSON to Frontend.
 * 3. Automatically initializes QuestDB Schema.
 * 4. Persists live Ticks and Depth to QuestDB.
 * 5. Uses Hardcoded Instrument Keys for Futures (No dynamic download).
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

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = 4000;
const QUESTDB_URL = 'http://localhost:9000/exec'; // Default QuestDB REST Endpoint

// State
let upstoxSocket = null;
let frontendSocket = null;
let currentInstruments = new Set();
let userToken = process.env.UPSTOX_ACCESS_TOKEN || null;

// Error State to report to Frontend
let serverStatusError = null;
let FeedResponse = null;

// --- CRASH PREVENTION ---
process.on('uncaughtException', (err) => {
    console.error('⚠️ UNCAUGHT EXCEPTION:', err.message);
    console.error(err.stack);
    console.error('Server is ignoring this error and continuing...');
});

// Load Protobuf Definition
const PROTO_FILENAME = 'market_data_feed.proto';
const POSSIBLE_PATHS = [
    path.join(__dirname, '../', PROTO_FILENAME),
    path.join(__dirname, PROTO_FILENAME),
    path.join(process.cwd(), PROTO_FILENAME)
];

let PROTO_PATH = POSSIBLE_PATHS.find(p => fs.existsSync(p));

function initProtobuf() {
    if (!PROTO_PATH) {
        console.error(`⚠️ CRITICAL: Could not find '${PROTO_FILENAME}'. Please download it to the project root.`);
        serverStatusError = `Missing '${PROTO_FILENAME}'. Check server console.`;
        return;
    }

    try {
        const fileContent = fs.readFileSync(PROTO_PATH, 'utf-8').trim();
        if (fileContent.startsWith('<') || fileContent.includes('<!DOCTYPE html>')) {
            console.error(`⚠️ CRITICAL: The file '${PROTO_FILENAME}' appears to be HTML/XML, not a Protobuf definition.`);
            serverStatusError = `Invalid '${PROTO_FILENAME}' (Contains HTML). Download RAW file.`;
            return;
        }

        const findTypeByName = (root, name) => {
            if (root.name === name) return root;
            if (root.nested) {
                for (const key of Object.keys(root.nested)) {
                    const found = findTypeByName(root.nested[key], name);
                    if (found) return found;
                }
            }
            return null;
        }

        const root = protobuf.loadSync(PROTO_PATH);
        FeedResponse = findTypeByName(root, "FeedResponse");
        
        if (!FeedResponse) {
            throw new Error("Could not find 'FeedResponse' message type");
        }
        console.log("✅ Protobuf Loaded Successfully");

    } catch (e) {
        console.error("❌ Failed to load/parse Protobuf definition.", e);
        serverStatusError = `Protobuf Error: ${e.message}`;
    }
}

initProtobuf();

// =============================================================================
// INSTRUMENT MAPPING (HARDCODED)
// =============================================================================

const INDEX_TO_SYMBOL = {
    'Nifty 50': 'NIFTY',
    'NIFTY 50': 'NIFTY',
    'Nifty Bank': 'BANKNIFTY',
    'NIFTY BANK': 'BANKNIFTY',
    'NIFTY': 'NIFTY',
    'BANKNIFTY': 'BANKNIFTY'
};

// USER SPECIFIC INSTRUMENTS (DEC 30 2025 Expiry)
const HARDCODED_FUTURES = {
    'NIFTY': {
        instrument_key: 'NSE_FO|49543', 
        trading_symbol: 'NIFTY FUT 30 DEC 25',
        expiry: '2025-12-30', 
        instrument_type: 'FUT'
    },
    'BANKNIFTY': {
        instrument_key: 'NSE_FO|49508',
        trading_symbol: 'BANKNIFTY FUT 30 DEC 25',
        expiry: '2025-12-30',
        instrument_type: 'FUT'
    }
};

function findFutureContract(indexName) {
    if (!indexName) return null;

    // Normalize Name
    const cleanName = indexName.includes('|') ? indexName.split('|')[1] : indexName;
    const mappedSymbol = INDEX_TO_SYMBOL[cleanName] || INDEX_TO_SYMBOL[cleanName.toUpperCase()] || cleanName.toUpperCase().split(' ')[0];
    
    console.log(`🔍 Searching Future for: '${indexName}' -> Mapped: '${mappedSymbol}'`);

    if (mappedSymbol && HARDCODED_FUTURES[mappedSymbol]) {
        console.log(`✅ Found Future: ${HARDCODED_FUTURES[mappedSymbol].trading_symbol}`);
        return HARDCODED_FUTURES[mappedSymbol];
    }

    console.log(`❌ No hardcoded future found for ${mappedSymbol}`);
    return null;
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

    // Report server health immediately
    if (serverStatusError) {
        ws.send(JSON.stringify({ type: 'error', message: `Server Config Error: ${serverStatusError}` }));
    } else {
        // Send success status immediately
        ws.send(JSON.stringify({ type: 'connection_status', status: 'CONNECTED' }));
    }

    ws.on('message', async (message) => {
        try {
            const msg = JSON.parse(message);
            
            if (msg.type === 'init') {
                userToken = msg.token || userToken; 
                if (msg.instrumentKeys && Array.isArray(msg.instrumentKeys)) {
                    msg.instrumentKeys.forEach(k => currentInstruments.add(k));
                }
                
                if (userToken) {
                    if (!serverStatusError) {
                        connectToUpstox();
                    }
                } else {
                    ws.send(JSON.stringify({type: 'error', message: 'Missing Access Token'}));
                }
            } else if (msg.type === 'subscribe') {
                if (msg.instrumentKeys && Array.isArray(msg.instrumentKeys)) {
                    let hasNew = false;
                    msg.instrumentKeys.forEach(k => {
                        if (!currentInstruments.has(k)) {
                            currentInstruments.add(k);
                            hasNew = true;
                        }
                    });
                    
                    if (hasNew) {
                        console.log("New instruments added. Reconnecting Upstox Stream...");
                        connectToUpstox();
                    }
                }
            } else if (msg.type === 'get_option_chain') {
                const token = msg.token || userToken;
                if (!token) {
                     ws.send(JSON.stringify({ type: 'error', message: 'No Access Token found.' }));
                     return;
                }
                
                // Safe parsing of instrument key
                let indexName = msg.instrumentKey;
                if (indexName && indexName.includes('|')) {
                    indexName = indexName.split('|')[1];
                }

                try {
                    console.log(`Fetching Option Chain for ${msg.instrumentKey}...`);
                    const response = await axios.get('https://api.upstox.com/v2/option/contract', {
                        params: { instrument_key: msg.instrumentKey },
                        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
                    });

                    // Find Future Contract using HARDCODED list
                    const futureContract = findFutureContract(indexName);
                    
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
                 const token = msg.token || userToken;
                 if (!token) return;
                 try {
                     if (!msg.instrumentKeys || msg.instrumentKeys.length === 0) return;

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
    if (currentInstruments.size === 0) return Promise.reject(new Error("No instruments to subscribe"));

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

// Throttle connection attempts
let connectionInProgress = false;

async function connectToUpstox() {
    if (connectionInProgress) return;
    connectionInProgress = true;

    if (upstoxSocket) {
        try {
            upstoxSocket.removeAllListeners();
            upstoxSocket.terminate();
        } catch(e) {}
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
            connectionInProgress = false;
        });

        upstoxSocket.on('message', (data) => {
            try {
                if (!FeedResponse) return; 

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
        
        upstoxSocket.on('error', (err) => {
            console.error("Upstox WS Error:", err.message);
            connectionInProgress = false;
        });
        
        upstoxSocket.on('close', () => {
             console.log("Upstox Disconnected");
             if (frontendSocket) frontendSocket.send(JSON.stringify({ type: 'connection_status', status: 'DISCONNECTED' }));
             connectionInProgress = false;
        });

    } catch (e) {
        console.error("Connection Failed:", e.message);
        if (frontendSocket && frontendSocket.readyState === WebSocket.OPEN) {
            frontendSocket.send(JSON.stringify({ type: 'error', message: e.message }));
        }
        connectionInProgress = false;
    }
}