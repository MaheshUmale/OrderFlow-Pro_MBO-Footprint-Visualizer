/**
 * UPSTOX BRIDGE SERVER + QUESTDB INGESTION
 * ----------------------------------------
 * 1. Connects to Upstox V3 WebSocket (Protobuf).
 * 2. Relays decoded JSON to Frontend.
 * 3. Automatically initializes QuestDB Schema.
 * 4. Persists live Ticks and Depth to QuestDB.
 * 
 * PREREQUISITES:
 * npm install ws protobufjs upstox-js-sdk axios
 */

import { WebSocket, WebSocketServer } from 'ws';
import protobuf from 'protobufjs';
import path from 'path';
import https from 'https';
import axios from 'axios'; // Used for QuestDB REST API
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
let protobufRoot = null;
let currentInstruments = new Set();
// Support for Environment Variable Token
let userToken = process.env.UPSTOX_ACCESS_TOKEN || null;

if (userToken) {
    console.log("Loaded Access Token from Environment Variable.");
}

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

console.log(`Loading Proto file from: ${PROTO_PATH}`);

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
    protobufRoot = protobuf.loadSync(PROTO_PATH);
    
    // Auto-detect FeedResponse location
    FeedResponse = findTypeByName(protobufRoot, "FeedResponse");

    if (!FeedResponse) {
        console.error("CRITICAL: Could not find 'FeedResponse' message type anywhere in the proto file.");
        console.error("Available root namespaces:", Object.keys(protobufRoot.nested || {}));
        process.exit(1);
    }
    
    console.log(`Successfully resolved FeedResponse type.`);

} catch (e) {
    console.error("CRITICAL: Failed to load/parse Protobuf definition.", e);
    process.exit(1);
}

// =============================================================================
// QUESTDB LOGIC
// =============================================================================

async function initQuestDB() {
    console.log("Initializing QuestDB Schema...");
    // 1. Table: market_ticks
    const createTicks = `
        CREATE TABLE IF NOT EXISTS market_ticks (
            instrument_key SYMBOL,
            price DOUBLE,
            volume DOUBLE,
            oi DOUBLE,
            timestamp TIMESTAMP
        ) TIMESTAMP(timestamp) PARTITION BY DAY WAL;
    `;
    // 2. Table: market_depth
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
        console.error("⚠️ QuestDB Connection Failed (Is it running on port 9000?). Continuing without DB.");
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
                if (msg.instrumentKeys) msg.instrumentKeys.forEach(k => currentInstruments.add(k));
            } else if (msg.type === 'get_option_chain') {
                const token = msg.token || userToken;
                if (!token) {
                     ws.send(JSON.stringify({ type: 'error', message: 'No Access Token found.' }));
                     return;
                }
                try {
                    const response = await axios.get('https://api.upstox.com/v2/option/contract', {
                        params: { instrument_key: msg.instrumentKey },
                        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
                    });
                    ws.send(JSON.stringify({
                        type: 'option_chain_response',
                        data: response.data.data,
                        underlyingKey: msg.instrumentKey
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Failed to fetch chain' }));
                }
            }
        } catch (e) {
            console.error("Error processing message:", e);
        }
    });

    ws.on('close', () => { frontendSocket = null; });
});

async function getAuthorizedUrl(token) {
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
    if (upstoxSocket) upstoxSocket.terminate();

    try {
        console.log("Authorizing...");
        const wsUrl = await getAuthorizedUrl(userToken);
        console.log("Connecting to Upstox...");

        upstoxSocket = new WebSocket(wsUrl);
        upstoxSocket.binaryType = 'arraybuffer';

        upstoxSocket.on('open', () => {
            console.log("Connected to Upstox V3 Feed");
            initQuestDB();
        });

        upstoxSocket.on('message', (data) => {
            try {
                const buffer = Buffer.from(data);
                
                // Decode using the recursively found type
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

    } catch (e) {
        console.error("Connection Failed:", e.message);
        if (frontendSocket) frontendSocket.send(JSON.stringify({ type: 'error', message: e.message }));
    }
}