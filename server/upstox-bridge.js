/**
 * UPSTOX BRIDGE SERVER (ROBUST MODE)
 * ----------------------------------
 * 1. Starts WebSocket Server on Port 4000 immediately.
 * 2. load Protobuf safely (reports error if missing, doesn't crash).
 * 3. Connects to Upstox V3 only when a client requests it.
 */

import { WebSocket, WebSocketServer } from 'ws';
import protobuf from 'protobufjs';
import path from 'path';
import https from 'https';
import axios from 'axios';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Environment Fixes
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 4000;
const QUESTDB_URL = 'http://localhost:9000/exec'; 

// --- STATE ---
let upstoxSocket = null;
let frontendSocket = null;
let currentInstruments = new Set();
let userToken = process.env.UPSTOX_ACCESS_TOKEN || null;

// --- STATUS FLAGS ---
let serverStatusError = null;
let FeedResponse = null;

// --- CRASH PREVENTION ---
process.on('uncaughtException', (err) => {
    console.error('⚠️ SERVER ERROR (Kept Alive):', err.message);
});

// --- 1. PROTOBUF LOADER (SAFE) ---
const PROTO_FILENAME = 'market_data_feed.proto';
const POSSIBLE_PATHS = [
    path.join(process.cwd(), PROTO_FILENAME),
    path.join(__dirname, PROTO_FILENAME),
    path.join(__dirname, '../', PROTO_FILENAME)
];

function initProtobuf() {
    let protoPath = POSSIBLE_PATHS.find(p => fs.existsSync(p));

    if (!protoPath) {
        console.warn(`⚠️ WARNING: '${PROTO_FILENAME}' not found in root. Server running in Limited Mode.`);
        serverStatusError = `File '${PROTO_FILENAME}' missing. Please download it to project root.`;
        return;
    }

    try {
        const fileContent = fs.readFileSync(protoPath, 'utf-8').trim();
        if (fileContent.trim().startsWith('<')) {
            serverStatusError = `Invalid '${PROTO_FILENAME}'. It appears to be HTML. Download the RAW file.`;
            return;
        }

        const root = protobuf.loadSync(protoPath);
        
        const findType = (r, name) => {
            if (r.name === name) return r;
            if (r.nested) {
                for (const key of Object.keys(r.nested)) {
                    const found = findType(r.nested[key], name);
                    if (found) return found;
                }
            }
            return null;
        }

        FeedResponse = findType(root, "FeedResponse");
        if (!FeedResponse) {
            serverStatusError = "Proto file loaded, but 'FeedResponse' message type not found.";
        } else {
            console.log("✅ Protobuf Definition Loaded Successfully");
        }

    } catch (e) {
        console.error("Protobuf Parse Error:", e.message);
        serverStatusError = `Protobuf Parse Error: ${e.message}`;
    }
}

initProtobuf();

// --- 2. QUESTDB LOGIC (FIRE & FORGET) ---
async function saveToQuestDB(feedObject) {
    if (!feedObject.feeds) return;
    const queries = [];
    
    try {
        Object.keys(feedObject.feeds).forEach(key => {
            const feed = feedObject.feeds[key];
            if (feed.fullFeed?.marketFF?.ltpc) {
                const ff = feed.fullFeed.marketFF;
                const price = ff.ltpc.ltp;
                const volume = ff.vtt ? parseFloat(ff.vtt) : 0;
                const oi = ff.oi ? parseFloat(ff.oi) : 0;
                queries.push(`INSERT INTO market_ticks VALUES ('${key}', ${price}, ${volume}, ${oi}, systimestamp())`);
            }
        });

        if (queries.length > 0) {
            Promise.all(queries.map(q => 
                axios.get(QUESTDB_URL, { params: { query: q }, timeout: 1000 }).catch(() => {})
            )).catch(() => {});
        }
    } catch (e) {
        // DB Errors ignored
    }
}

// --- 3. WEBSOCKET SERVER (STARTS IMMEDIATELY) ---
let wss;

try {
    wss = new WebSocketServer({ port: PORT });
    console.log(`🚀 Bridge Server listening on ws://localhost:${PORT}`);

    wss.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.error(`❌ ERROR: Port ${PORT} is already in use! The server might already be running.`);
            console.error(`If so, you can ignore this. If not, kill the process using port ${PORT}.`);
        } else {
            console.error('❌ WebSocket Server Error:', e.message);
        }
    });

    wss.on('connection', (ws) => {
        console.log(">> Frontend Connected");
        frontendSocket = ws;

        if (serverStatusError) {
            ws.send(JSON.stringify({ type: 'error', message: `Server Warning: ${serverStatusError}` }));
        } else {
            ws.send(JSON.stringify({ type: 'connection_status', status: 'CONNECTED' }));
        }

        ws.on('message', async (message) => {
            try {
                const msg = JSON.parse(message);
                
                if (msg.type === 'init') {
                    if (msg.token) userToken = msg.token;
                    if (msg.instrumentKeys) msg.instrumentKeys.forEach(k => currentInstruments.add(k));
                    
                    if (userToken) connectToUpstox();
                    else ws.send(JSON.stringify({ type: 'error', message: 'Token Missing' }));
                } 
                else if (msg.type === 'subscribe') {
                    if (msg.instrumentKeys) {
                        const newKeys = [];
                        msg.instrumentKeys.forEach(k => {
                            if (!currentInstruments.has(k)) {
                                currentInstruments.add(k);
                                newKeys.push(k);
                            }
                        });
                        if (newKeys.length > 0) subscribeUpstox(newKeys);
                    }
                }
                else if (msg.type === 'get_option_chain' || msg.type === 'get_quotes') {
                    handleApiRequest(msg, ws);
                }
            } catch (e) {
                console.error("Msg Error:", e.message);
            }
        });

        ws.on('close', () => {
            console.log("<< Frontend Disconnected");
            frontendSocket = null;
        });
    });
} catch (e) {
    console.error("❌ Failed to start server:", e.message);
}

// --- 4. UPSTOX API HANDLER ---
async function handleApiRequest(msg, ws) {
    const token = msg.token || userToken;
    if (!token) return;

    try {
        const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
        
        if (msg.type === 'get_option_chain') {
            console.log(`API: Fetching Chain for ${msg.instrumentKey}`);
            const res = await axios.get('https://api.upstox.com/v2/option/contract', {
                params: { instrument_key: msg.instrumentKey }, headers
            });
            ws.send(JSON.stringify({
                type: 'option_chain_response',
                data: res.data.data,
                underlyingKey: msg.instrumentKey
            }));
        } 
        else if (msg.type === 'get_quotes') {
            const keys = msg.instrumentKeys.join(',');
            const res = await axios.get('https://api.upstox.com/v2/market-quote/ltp', {
                params: { instrument_key: keys }, headers
            });
            ws.send(JSON.stringify({ type: 'quote_response', data: res.data.data }));
        }
    } catch (e) {
        console.error("API Error:", e.message);
        ws.send(JSON.stringify({ type: 'error', message: `Upstox API: ${e.message}` }));
    }
}

// --- 5. UPSTOX WEBSOCKET CLIENT ---
let isConnecting = false;

function subscribeUpstox(keys) {
    if (!upstoxSocket || upstoxSocket.readyState !== WebSocket.OPEN) {
        connectToUpstox(); 
        return;
    }
    const payload = {
        guid: "orderflow-" + Date.now(),
        method: "sub",
        data: { mode: "full", instrumentKeys: keys }
    };
    upstoxSocket.send(Buffer.from(JSON.stringify(payload)));
}

async function connectToUpstox() {
    if (isConnecting || (upstoxSocket && upstoxSocket.readyState === WebSocket.OPEN)) return;
    if (!userToken) return;

    isConnecting = true;
    try {
        console.log("Authorizing Upstox Stream...");
        const authRes = await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'api.upstox.com',
                path: '/v3/feed/market-data-feed/authorize',
                method: 'GET',
                headers: { 'Authorization': 'Bearer ' + userToken, 'Accept': 'application/json' }
            }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    if (res.statusCode === 200) resolve(JSON.parse(data));
                    else reject(new Error(`Auth Status ${res.statusCode}`));
                });
            });
            req.on('error', reject);
            req.end();
        });

        if (!authRes?.data?.authorizedRedirectUri) throw new Error("No Redirect URI in Auth Response");

        console.log("Connecting to Upstox Socket...");
        upstoxSocket = new WebSocket(authRes.data.authorizedRedirectUri);
        upstoxSocket.binaryType = 'arraybuffer';

        upstoxSocket.on('open', () => {
            console.log("✅ Upstox Stream Connected");
            isConnecting = false;
            if (frontendSocket) frontendSocket.send(JSON.stringify({ type: 'connection_status', status: 'CONNECTED' }));
            
            if (currentInstruments.size > 0) {
                subscribeUpstox(Array.from(currentInstruments));
            }
        });

        upstoxSocket.on('message', (data) => {
            if (!FeedResponse) return; 
            try {
                const msg = FeedResponse.decode(Buffer.from(data));
                const obj = FeedResponse.toObject(msg, { longs: String, enums: String, bytes: String });
                
                if (frontendSocket?.readyState === WebSocket.OPEN) {
                    frontendSocket.send(JSON.stringify(obj));
                }
                saveToQuestDB(obj);
            } catch (e) { 
                console.error("Protobuf Decode Error"); 
            }
        });

        upstoxSocket.on('close', () => {
            console.log("⚠️ Upstox Stream Closed");
            isConnecting = false;
            upstoxSocket = null;
            if (frontendSocket) frontendSocket.send(JSON.stringify({ type: 'connection_status', status: 'DISCONNECTED' }));
        });

        upstoxSocket.on('error', (e) => {
            console.error("Upstox Socket Error:", e.message);
            isConnecting = false;
        });

    } catch (e) {
        console.error("Upstox Connection Failed:", e.message);
        isConnecting = false;
        if (frontendSocket) frontendSocket.send(JSON.stringify({ type: 'error', message: e.message }));
    }
}