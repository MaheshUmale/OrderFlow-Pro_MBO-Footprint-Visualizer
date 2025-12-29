/**
 * UPSTOX BRIDGE SERVER
 * --------------------
 * Proxies Upstox V3 WebSocket (Protobuf) to Frontend (JSON).
 * Handles authentication, subscription, and error recovery.
 */

import { WebSocket, WebSocketServer } from 'ws';
import protobuf from 'protobufjs';
import path from 'path';
import https from 'https';
import axios from 'axios';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 4000;
const QUESTDB_URL = 'http://localhost:9000/exec'; 

// Global State
let upstoxSocket = null;
let frontendSocket = null;
let currentInstruments = new Set();
let userToken = process.env.UPSTOX_ACCESS_TOKEN || null;

// Status Flags
let serverStatusError = null;
let FeedResponse = null;

// --- CRASH PREVENTION ---
process.on('uncaughtException', (err) => {
    console.error('⚠️ UNCAUGHT EXCEPTION:', err.message);
    // Keep server alive
});

// --- PROTOBUF LOADING ---
const PROTO_FILENAME = 'market_data_feed.proto';
// Check current dir, server dir, and project root
const POSSIBLE_PATHS = [
    path.join(process.cwd(), PROTO_FILENAME),
    path.join(__dirname, PROTO_FILENAME),
    path.join(__dirname, '../', PROTO_FILENAME)
];

let PROTO_PATH = POSSIBLE_PATHS.find(p => fs.existsSync(p));

function initProtobuf() {
    if (!PROTO_PATH) {
        console.error(`⚠️ CRITICAL: '${PROTO_FILENAME}' not found.`);
        serverStatusError = `File '${PROTO_FILENAME}' missing. Place it in project root.`;
        return;
    }

    try {
        const fileContent = fs.readFileSync(PROTO_PATH, 'utf-8').trim();
        if (fileContent.startsWith('<') || fileContent.includes('<!DOCTYPE html>')) {
            serverStatusError = `Invalid '${PROTO_FILENAME}'. It contains HTML. Download raw file.`;
            return;
        }

        const root = protobuf.loadSync(PROTO_PATH);
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
        if (!FeedResponse) throw new Error("Message 'FeedResponse' not found in proto.");
        
        console.log("✅ Protobuf Initialized");
    } catch (e) {
        console.error("❌ Protobuf Error:", e.message);
        serverStatusError = `Protobuf Error: ${e.message}`;
    }
}

initProtobuf();

// --- DATABASE ---
async function saveToQuestDB(feedObject) {
    if (!feedObject.feeds) return;
    const queries = [];
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
        Promise.all(queries.map(q => axios.get(QUESTDB_URL, { params: { query: q } }).catch(() => {}))).catch(()=>{});
    }
}

// --- WEBSOCKET SERVER ---
const wss = new WebSocketServer({ port: PORT });
console.log(`🚀 Bridge Server running on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
    console.log("Client connected");
    frontendSocket = ws;

    // Send initial status
    if (serverStatusError) {
        ws.send(JSON.stringify({ type: 'error', message: serverStatusError }));
    } else {
        ws.send(JSON.stringify({ type: 'connection_status', status: 'CONNECTED' }));
    }

    ws.on('message', async (raw) => {
        try {
            const msg = JSON.parse(raw);

            switch (msg.type) {
                case 'init':
                    if (msg.token) userToken = msg.token;
                    if (msg.instrumentKeys) msg.instrumentKeys.forEach(k => currentInstruments.add(k));
                    if (userToken) connectToUpstox();
                    break;
                
                case 'subscribe':
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
                    break;

                case 'get_option_chain':
                case 'get_quotes':
                    handleApiRequest(msg, ws);
                    break;
            }
        } catch (e) {
            console.error("Message handling error:", e);
        }
    });

    ws.on('close', () => { frontendSocket = null; });
});

// --- UPSTOX API HANDLER ---
async function handleApiRequest(msg, ws) {
    const token = msg.token || userToken;
    if (!token) return;

    try {
        if (msg.type === 'get_option_chain') {
            console.log(`Fetching chain for ${msg.instrumentKey}`);
            const res = await axios.get('https://api.upstox.com/v2/option/contract', {
                params: { instrument_key: msg.instrumentKey },
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
            });
            ws.send(JSON.stringify({
                type: 'option_chain_response',
                data: res.data.data,
                underlyingKey: msg.instrumentKey
            }));
        } else if (msg.type === 'get_quotes') {
            const keys = msg.instrumentKeys.join(',');
            const res = await axios.get('https://api.upstox.com/v2/market-quote/ltp', {
                params: { instrument_key: keys },
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
            });
            ws.send(JSON.stringify({
                type: 'quote_response',
                data: res.data.data
            }));
        }
    } catch (e) {
        console.error("API Error:", e.message);
        ws.send(JSON.stringify({ type: 'error', message: `API Error: ${e.message}` }));
    }
}

// --- UPSTOX WEBSOCKET CLIENT ---
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

let isConnecting = false;
async function connectToUpstox() {
    if (isConnecting || (upstoxSocket && upstoxSocket.readyState === WebSocket.OPEN)) return;
    if (!userToken) return;

    isConnecting = true;
    try {
        // Get Auth URL
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

        if (!authRes?.data?.authorizedRedirectUri) throw new Error("Invalid Auth Response");

        console.log("Connecting to Upstox...");
        upstoxSocket = new WebSocket(authRes.data.authorizedRedirectUri);
        upstoxSocket.binaryType = 'arraybuffer';

        upstoxSocket.on('open', () => {
            console.log("✅ Upstox Connected");
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
            } catch (e) { console.error("Decode Error", e.message); }
        });

        upstoxSocket.on('close', () => {
            console.log("⚠️ Upstox Closed");
            isConnecting = false;
            upstoxSocket = null;
            if (frontendSocket) frontendSocket.send(JSON.stringify({ type: 'connection_status', status: 'DISCONNECTED' }));
        });

        upstoxSocket.on('error', (e) => {
            console.error("Upstox Error:", e.message);
            isConnecting = false;
        });

    } catch (e) {
        console.error("Connection Failed:", e.message);
        isConnecting = false;
        if (frontendSocket) frontendSocket.send(JSON.stringify({ type: 'error', message: e.message }));
    }
}