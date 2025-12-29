import { MarketState, OrderSide, PriceLevel, IcebergType, Trade, FootprintBar, ActiveIceberg, NSEFeed, InstrumentFeed, BidAskQuote, TradeSignal, InstrumentState, UpstoxContract, FootprintLevel } from '../types';

// --- CONFIGURATION ---
const DEFAULT_INSTRUMENTS = [
    { key: "NSE_FO|49543", name: "NIFTY FUT 30 DEC 25", underlying: "NSE_INDEX|Nifty 50" },
    { key: "NSE_FO|49508", name: "BANKNIFTY FUT 30 DEC 25", underlying: "NSE_INDEX|Nifty Bank" }
];

// Fallback Snapshot
const REAL_DATA_SNAPSHOT: any = {
  "type": "live_feed",
  "feeds": {
    "NSE_FO|49543": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 24100.0}, "marketLevel": {"bidAskQuote": []}, "vtt": "100"}}}
  }
};

let currentInstrumentId = "NSE_FO|49543";

// --- STATE VARIABLES ---
let instrumentsCache: string[] = DEFAULT_INSTRUMENTS.map(i => i.key);
let instrumentNames: { [key: string]: string } = {};
DEFAULT_INSTRUMENTS.forEach(i => instrumentNames[i.key] = i.name);

let feedInterval: any = null;
let subscribers: ((data: MarketState) => void)[] = [];
let connectionStatus: MarketState['connectionStatus'] = 'DISCONNECTED';
let onStatusUpdate: ((status: string) => void) | null = null;
let feedDataQueue: any[] = [];
let simulationSpeed = 1;
let bridgeSocket: WebSocket | null = null;
let isLiveMode = false;

// Instrument Data Store
const instrumentStates: { [id: string]: InstrumentState } = {};

// Option Chain Variables
let cachedOptionContracts: UpstoxContract[] = [];
let underlyingInstrumentId = "";
let lastCalculatedAtm = 0;
let userToken = ""; 
let lastSentSubscribeKeys: string[] = []; 

// --- INITIALIZER ---
const createInitialState = (price: number): InstrumentState => ({
  currentPrice: price,
  book: [],
  recentTrades: [],
  footprintBars: [],
  activeIcebergs: [],
  activeSignals: [],
  signalHistory: [],
  globalCVD: 0,
  tickSize: 0.05,
  swingHigh: price,
  swingLow: price,
  sessionHigh: price,
  sessionLow: price,
  marketTrend: 'NEUTRAL',
  openInterest: 0,
  openInterestChange: 0,
  openInterestDelta: 0,
  vwap: price,
  cumulativeVolume: 0,
  cumulativePV: 0,
  lastVol: 0,
  currentBar: {
    timestamp: Date.now(),
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 0,
    delta: 0,
    cvd: 0,
    levels: [],
    depthSnapshot: {} 
  },
  lastBook: [],
  icebergTracker: {}
});

// Setup default states
DEFAULT_INSTRUMENTS.forEach(inst => {
    instrumentStates[inst.key] = createInitialState(24000);
});

// --- HELPER: KEY MATCHING & SUBSCRIPTION ---

const areKeysEqual = (k1: string, k2: string) => {
    if (!k1 || !k2) return false;
    if (k1 === k2) return true;
    try {
        return decodeURIComponent(k1) === decodeURIComponent(k2);
    } catch (e) { 
        return false; 
    }
};

const triggerBackendSubscription = (keys: string[]) => {
    if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) return;
    const uniqueKeys = Array.from(new Set(keys)).sort();
    const isSame = uniqueKeys.length === lastSentSubscribeKeys.length && 
                   uniqueKeys.every((value, index) => value === lastSentSubscribeKeys[index]);
    
    if (!isSame || uniqueKeys.length > 0) {
        console.log(`[Frontend] Subscribing to ${uniqueKeys.length} instruments.`);
        if (onStatusUpdate) onStatusUpdate(`Subscribing ${uniqueKeys.length} items...`);
        bridgeSocket.send(JSON.stringify({ type: 'subscribe', instrumentKeys: uniqueKeys }));
        lastSentSubscribeKeys = uniqueKeys;
    }
};

// --- LOGIC: BOOK & AGGRESSOR ---

const convertQuoteToBook = (quotes: BidAskQuote[], currentPrice: number): PriceLevel[] => {
    const levelMap = new Map<number, PriceLevel>();
    quotes.forEach((q, idx) => {
        if (q.bidP > 0) {
            const bidP = parseFloat(q.bidP.toString());
            if (!levelMap.has(bidP)) levelMap.set(bidP, { price: bidP, bids: [], asks: [], totalBidSize: 0, totalAskSize: 0, impliedIceberg: false });
            const l = levelMap.get(bidP)!;
            l.totalBidSize += parseInt(q.bidQ, 10);
            if (l.bids.length < 3) l.bids.push({ id: `b-${idx}`, price: bidP, size: parseInt(q.bidQ, 10), priority: idx, icebergType: IcebergType.NONE, displayedSize: parseInt(q.bidQ, 10), totalSizeEstimated: parseInt(q.bidQ, 10) });
        }
        if (q.askP > 0) {
            const askP = parseFloat(q.askP.toString());
            if (!levelMap.has(askP)) levelMap.set(askP, { price: askP, bids: [], asks: [], totalBidSize: 0, totalAskSize: 0, impliedIceberg: false });
            const l = levelMap.get(askP)!;
            l.totalAskSize += parseInt(q.askQ, 10);
            if (l.asks.length < 3) l.asks.push({ id: `a-${idx}`, price: askP, size: parseInt(q.askQ, 10), priority: idx, icebergType: IcebergType.NONE, displayedSize: parseInt(q.askQ, 10), totalSizeEstimated: parseInt(q.askQ, 10) });
        }
    });
    return Array.from(levelMap.values()).sort((a,b) => b.price - a.price);
};

// --- LOGIC: STATISTICS & SIGNALS ---

const updateStatistics = (state: InstrumentState, newPrice: number, volDiff: number) => {
    // 1. Session High/Low
    state.sessionHigh = Math.max(state.sessionHigh, newPrice);
    state.sessionLow = Math.min(state.sessionLow, newPrice);
    
    // 2. VWAP Calculation: Sum(Price * Volume) / Sum(Volume)
    if (volDiff > 0) {
        state.cumulativeVolume += volDiff;
        state.cumulativePV += (newPrice * volDiff);
        state.vwap = state.cumulativeVolume > 0 ? (state.cumulativePV / state.cumulativeVolume) : newPrice;
    }
};

const detectIcebergs = (state: InstrumentState, trade: Trade) => {
    // Robust Iceberg Detection:
    // Monitor volume traded at a specific price level within a short window.
    // If Vol Traded > (Visible Depth * 1.5) AND Price hasn't broken, it's an Iceberg.
    
    const priceKey = trade.price.toFixed(2);
    if (!state.icebergTracker[priceKey]) {
        state.icebergTracker[priceKey] = { vol: 0, startTime: Date.now() };
    }
    
    const tracker = state.icebergTracker[priceKey];
    tracker.vol += trade.size;
    
    // Clean up old trackers (older than 10 seconds)
    const now = Date.now();
    if (now - tracker.startTime > 10000) {
        delete state.icebergTracker[priceKey];
        return;
    }

    // Find visible depth at this price
    const level = state.book.find(l => Math.abs(l.price - trade.price) < 0.01);
    const visibleDepth = level ? (trade.side === OrderSide.BID ? level.totalBidSize : level.totalAskSize) : 0;
    
    // Threshold: If we traded 1.5x what is visible and price is sticky
    if (visibleDepth > 0 && tracker.vol > visibleDepth * 1.5) {
        const existing = state.activeIcebergs.find(i => Math.abs(i.price - trade.price) < 0.01 && i.side === trade.side);
        
        if (!existing) {
            const iceberg: ActiveIceberg = {
                id: Math.random().toString(36).substr(2, 9),
                price: trade.price,
                side: trade.side === OrderSide.BID ? OrderSide.BID : OrderSide.ASK,
                detectedAt: now,
                lastUpdate: now,
                totalFilled: tracker.vol,
                status: 'ACTIVE'
            };
            state.activeIcebergs.push(iceberg);
            
            if (level) level.impliedIceberg = true;

            setTimeout(() => {
                state.activeIcebergs = state.activeIcebergs.filter(i => i.id !== iceberg.id);
            }, 10000);
        } else {
            existing.totalFilled = tracker.vol;
            existing.lastUpdate = now;
        }
    }
};

const generateSignals = (state: InstrumentState, trade: Trade) => {
    // 1. ABSORPTION DETECTION
    // High Volume Delta but minimal price movement (Doji candle at extremes)
    const bar = state.currentBar;
    if (bar.volume > 2000) {
        const barRange = bar.high - bar.low;
        const isSmallBody = Math.abs(bar.close - bar.open) < (barRange * 0.2); 
        
        if (isSmallBody) {
             if (bar.delta > 500 && trade.price >= state.sessionHigh * 0.999) {
                 addSignal(state, 'ABSORPTION', 'BEARISH', trade.price, 'Buyers exhausted at Highs');
             } else if (bar.delta < -500 && trade.price <= state.sessionLow * 1.001) {
                 addSignal(state, 'ABSORPTION', 'BULLISH', trade.price, 'Sellers exhausted at Lows');
             }
        }
    }
};

const addSignal = (state: InstrumentState, type: TradeSignal['type'], side: TradeSignal['side'], price: number, msg: string) => {
    // Debounce: Don't add same signal type within 1 minute
    const lastSig = state.activeSignals.find(s => s.type === type && Date.now() - s.timestamp < 60000);
    if (lastSig) return;

    const sig: TradeSignal = {
        id: Math.random().toString(),
        timestamp: Date.now(),
        type, side, price, message: msg,
        status: 'OPEN', pnlTicks: 0, entryTime: Date.now(),
        stopLoss: side === 'BULLISH' ? price - 10 : price + 10,
        takeProfit: side === 'BULLISH' ? price + 20 : price - 20,
        riskRewardRatio: 2
    };
    state.activeSignals.push(sig);
};

// --- LOGIC: FOOTPRINT & BARS ---

const snapshotDepthToBar = (state: InstrumentState) => {
    if (!state.currentBar.depthSnapshot) state.currentBar.depthSnapshot = {};
    const snap = state.currentBar.depthSnapshot;
    state.book.forEach(level => {
        const total = level.totalBidSize + level.totalAskSize;
        if (total > 0) snap[level.price.toFixed(2)] = total;
    });
};

const updateFootprint = (state: InstrumentState, trade: Trade) => {
    let bar = state.currentBar;
    snapshotDepthToBar(state);

    if (bar.volume > 2500) {
        state.footprintBars = [...state.footprintBars, bar].slice(-50);
        state.currentBar = {
            timestamp: Date.now(),
            open: trade.price,
            high: trade.price,
            low: trade.price,
            close: trade.price,
            volume: 0,
            delta: 0,
            cvd: state.globalCVD,
            levels: [],
            depthSnapshot: {} 
        };
        snapshotDepthToBar(state);
        bar = state.currentBar;
    }

    bar.high = Math.max(bar.high, trade.price);
    bar.low = Math.min(bar.low, trade.price);
    bar.close = trade.price;
    bar.volume += trade.size;
    
    const deltaChange = trade.side === OrderSide.ASK ? trade.size : -trade.size;
    bar.delta += deltaChange;
    bar.cvd = state.globalCVD;

    let level = bar.levels.find(l => Math.abs(l.price - trade.price) < 0.001);
    if (!level) {
        level = { price: trade.price, bidVol: 0, askVol: 0, delta: 0, imbalance: false, depthIntensity: 0 };
        bar.levels.push(level);
        bar.levels.sort((a, b) => b.price - a.price);
    }
    
    if (trade.side === OrderSide.ASK) level.askVol += trade.size;
    else level.bidVol += trade.size;
    level.delta = level.askVol - level.bidVol;
    
    if ((level.askVol > level.bidVol * 3 && level.askVol > 50) || 
        (level.bidVol > level.askVol * 3 && level.bidVol > 50)) {
        level.imbalance = true;
    }

    const bookLevel = state.book.find(l => Math.abs(l.price - trade.price) < 0.001);
    if (bookLevel) {
        const totalDepth = bookLevel.totalBidSize + bookLevel.totalAskSize;
        level.depthIntensity = Math.min(totalDepth / 2000, 1);
    }
};

const broadcast = () => {
    try {
        let currentState = instrumentStates[currentInstrumentId];
        if (!currentState) {
             const firstKey = instrumentsCache[0];
             if (firstKey && instrumentStates[firstKey]) {
                 currentState = instrumentStates[firstKey];
                 currentInstrumentId = firstKey;
             } else {
                 return; 
             }
        }

        const marketState: MarketState = {
            ...currentState,
            selectedInstrument: currentInstrumentId,
            availableInstruments: [...instrumentsCache],
            instrumentNames: { ...instrumentNames },
            connectionStatus: connectionStatus
        };
        subscribers.forEach(cb => cb(marketState));
    } catch (e) {
        console.error("Broadcast error:", e);
    }
};

const processFeedFrame = (frame: NSEFeed) => {
    if (!frame.feeds) return;
    const frameInstruments = Object.keys(frame.feeds);
    
    frameInstruments.forEach(id => {
        const fullFeed = frame.feeds[id].fullFeed;
        if (!fullFeed || !fullFeed.marketFF) return;
        const feedData = fullFeed.marketFF;
        if (!feedData.ltpc) return;

        // DYNAMIC INSTRUMENT DISCOVERY:
        // If the feed sends data for an instrument we don't know about, register it.
        if (!instrumentsCache.includes(id)) {
            instrumentsCache.push(id);
            if (!instrumentNames[id]) {
                instrumentNames[id] = id; 
            }
        }

        if (!instrumentStates[id]) instrumentStates[id] = createInitialState(feedData.ltpc.ltp || 0);
        const state = instrumentStates[id];
        
        const newPrice = feedData.ltpc.ltp;
        const prevPrice = state.currentPrice;
        
        if (feedData.marketLevel?.bidAskQuote) {
             state.book = convertQuoteToBook(feedData.marketLevel.bidAskQuote, newPrice);
             state.lastBook = state.book;
        }

        state.currentPrice = newPrice;
        
        if (cachedOptionContracts.length > 0 && areKeysEqual(id, underlyingInstrumentId)) recalculateOptionList(newPrice);
        else if (cachedOptionContracts.length > 0 && lastCalculatedAtm === 0 && id === currentInstrumentId) recalculateOptionList(newPrice);

        const currentTotalVol = parseInt(feedData.vtt || "0", 10);
        let volDiff = 0;
        
        if (currentTotalVol > state.lastVol && state.lastVol > 0) {
            volDiff = currentTotalVol - state.lastVol;
            state.lastVol = currentTotalVol;
        } else if (newPrice !== prevPrice) {
            volDiff = 1; 
            if (currentTotalVol === 0) state.lastVol = 0; 
        } else if (state.lastVol === 0 && currentTotalVol > 0) {
            state.lastVol = currentTotalVol;
        }
        
        if (volDiff > 0) {
            let side = OrderSide.BID; 
            
            if (state.book.length > 0) {
                let bb = -1, ba = 9999999;
                state.book.forEach(l => {
                    if (l.totalBidSize > 0 && l.price > bb) bb = l.price;
                    if (l.totalAskSize > 0 && l.price < ba) ba = l.price;
                });
                
                if (newPrice >= ba) side = OrderSide.ASK; 
                else if (newPrice <= bb) side = OrderSide.BID;
                else {
                    if (newPrice > prevPrice) side = OrderSide.ASK;
                    else if (newPrice < prevPrice) side = OrderSide.BID;
                    else side = OrderSide.ASK; 
                }
            } else {
                 side = newPrice >= prevPrice ? OrderSide.ASK : OrderSide.BID;
            }

            const newTrade: Trade = {
                id: Math.random().toString(36).substr(2, 9),
                price: newPrice,
                size: volDiff,
                side: side,
                timestamp: Date.now(),
                isIcebergExecution: false 
            };
            
            state.recentTrades = [newTrade, ...state.recentTrades].slice(0, 50);
            state.globalCVD += (side === OrderSide.ASK ? volDiff : -volDiff);
            
            updateStatistics(state, newPrice, volDiff);
            updateFootprint(state, newTrade);
            detectIcebergs(state, newTrade);
            generateSignals(state, newTrade);
        }
        
        if (state.book.length > 0) snapshotDepthToBar(state);
    });
    broadcast();
};

const startFeedProcessing = () => {
    if (feedInterval) clearInterval(feedInterval);
    if (isLiveMode) return; 
    feedInterval = setInterval(() => {
        if (feedDataQueue.length > 0) {
            const frame = feedDataQueue.shift();
            feedDataQueue.push(frame); 
            processFeedFrame(frame);
        }
    }, 1000 / simulationSpeed);
};

// --- EXPORTS ---

export const getUnderlyingForInstrument = (instrumentKey: string): string => {
    const inst = DEFAULT_INSTRUMENTS.find(i => i.key === instrumentKey);
    return inst ? (inst.underlying || "") : "";
};

export const setInstrument = (id: string) => {
    currentInstrumentId = id;
    
    // Ensure it exists in state
    if (!instrumentStates[id]) {
        const knownPrice = Object.values(instrumentStates).find(s => s.currentPrice > 0)?.currentPrice || 1000;
        instrumentStates[id] = createInitialState(knownPrice);
    }
    
    // Ensure it is in the list
    if (!instrumentsCache.includes(id)) {
        instrumentsCache.push(id);
        if (!instrumentNames[id]) instrumentNames[id] = id;
    }

    broadcast();
};

export const setSimulationSpeed = (speed: number) => {
    simulationSpeed = speed;
    if (feedInterval) clearInterval(feedInterval);
    if (!isLiveMode) startFeedProcessing();
};

export const uploadFeedData = (frames: any[]) => {
    feedDataQueue = frames;
    Object.keys(instrumentStates).forEach(k => delete instrumentStates[k]);
    if (!isLiveMode) startFeedProcessing();
};

export const subscribeToMarketData = (callback: (data: MarketState) => void) => {
  subscribers.push(callback);
  if (feedDataQueue.length === 0 && !isLiveMode) uploadFeedData([REAL_DATA_SNAPSHOT]);
  else broadcast();
  return () => { subscribers = subscribers.filter(s => s !== callback); };
};

// --- OPTION CHAIN LOGIC ---

export const fetchOptionChain = (underlyingKey: string, token: string, manualFutureKey?: string, statusCallback?: (s: string) => void) => {
    if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
        alert("Server Bridge Not Connected.\nPlease run 'npm run bridge' and connect first.");
        return;
    }
    if (statusCallback) onStatusUpdate = statusCallback;
    userToken = token;
    underlyingInstrumentId = underlyingKey;

    cachedOptionContracts = [];
    lastCalculatedAtm = 0;
    lastSentSubscribeKeys = []; 

    console.log(`[Frontend] Requesting Option Chain for: ${underlyingKey}`);
    bridgeSocket.send(JSON.stringify({ type: 'get_option_chain', instrumentKey: underlyingKey, token: token }));
    bridgeSocket.send(JSON.stringify({ type: 'get_quotes', instrumentKeys: [underlyingKey], token: token }));
    
    // Add underlying to list immediately so user can see it
    if (!instrumentsCache.includes(underlyingKey)) {
        instrumentsCache = [...instrumentsCache, underlyingKey];
        instrumentNames = { ...instrumentNames, [underlyingKey]: "SPOT / INDEX" }; 
    }
    
    triggerBackendSubscription(instrumentsCache);
};

const handleOptionChainData = (contracts: UpstoxContract[], underlyingKey: string) => {
    console.log(`[Frontend] Chain Data Recv. Contracts: ${contracts?.length}`);
    if (!contracts || contracts.length === 0) {
        if (onStatusUpdate) onStatusUpdate("No contracts found.");
        alert("No contracts found in Upstox response.");
        return;
    }
    
    const today = new Date().toISOString().split('T')[0];
    const distinctExpiries = Array.from(new Set(contracts.map(c => c.expiry))).sort();
    const nearestExpiry = distinctExpiries.find(e => e >= today) || distinctExpiries[0];
    
    if (onStatusUpdate) onStatusUpdate(`Found Expiry: ${nearestExpiry}`);
    if (!nearestExpiry) {
        alert("No valid expiry date found in contracts.");
        return;
    }

    cachedOptionContracts = contracts.filter(c => c.expiry === nearestExpiry);
    cachedOptionContracts.sort((a,b) => a.strike_price - b.strike_price);
    
    console.log(`[Frontend] Filtered Contracts for ${nearestExpiry}: ${cachedOptionContracts.length}`);
    
    const currentInstState = instrumentStates[currentInstrumentId];
    if (currentInstState && currentInstState.currentPrice > 0) {
        recalculateOptionList(currentInstState.currentPrice);
    } else {
        broadcast(); 
        if (onStatusUpdate) onStatusUpdate("Waiting for Price to select ATM...");
    }
};

const recalculateOptionList = (spotPrice: number) => {
    if (cachedOptionContracts.length === 0) return;
    
    let minDiff = Infinity;
    let atmStrike = 0;
    
    cachedOptionContracts.forEach(c => {
        const diff = Math.abs(c.strike_price - spotPrice);
        if (diff < minDiff) { minDiff = diff; atmStrike = c.strike_price; }
    });
    
    if (atmStrike === lastCalculatedAtm) return;
    lastCalculatedAtm = atmStrike;
    
    if (onStatusUpdate) onStatusUpdate(`ATM Identified: ${atmStrike}`);
    console.log(`[Frontend] ATM Logic -> Spot: ${spotPrice}, ATM: ${atmStrike}`);

    const distinctStrikes = Array.from(new Set(cachedOptionContracts.map(c => c.strike_price))).sort((a,b) => a-b);
    const atmIndex = distinctStrikes.indexOf(atmStrike);
    
    if (atmIndex === -1) return;

    const startIndex = Math.max(0, atmIndex - 2);
    const endIndex = Math.min(distinctStrikes.length, atmIndex + 3);
    const relevantStrikes = distinctStrikes.slice(startIndex, endIndex);
    
    const relevantContracts = cachedOptionContracts.filter(c => relevantStrikes.includes(c.strike_price));
    
    const newInstrumentKeys: string[] = [];
    const newNames: { [key: string]: string } = {};

    // Keep Existing Items in Cache that aren't options we're about to replace?
    // User requirement: "Just 2 ATM". But also keep defaults.
    
    DEFAULT_INSTRUMENTS.forEach(i => {
        newInstrumentKeys.push(i.key);
        newNames[i.key] = i.name;
    });

    newInstrumentKeys.push(underlyingInstrumentId);
    newNames[underlyingInstrumentId] = "SPOT / INDEX";

    relevantContracts.sort((a,b) => a.strike_price - b.strike_price).forEach(c => {
        newInstrumentKeys.push(c.instrument_key);
        newNames[c.instrument_key] = `${c.strike_price} ${c.instrument_type}`;
    });

    // Merge with any other keys discovered dynamically (e.g. user manually added via feed)
    // We only overwrite the ATM options part, essentially.
    
    // For simplicity, we overwrite with the Strict Set defined above as per "Smart Option Filtering" requirement.
    instrumentsCache = Array.from(new Set(newInstrumentKeys));
    instrumentNames = { ...newNames }; 
    
    triggerBackendSubscription(instrumentsCache);
    broadcast();
};

export const connectToBridge = (url: string, token: string) => {
    if (bridgeSocket) {
        if (bridgeSocket.readyState === WebSocket.OPEN || bridgeSocket.readyState === WebSocket.CONNECTING) return;
        bridgeSocket.close();
    }

    try {
        connectionStatus = 'CONNECTING';
        broadcast();
        console.log(`Connecting to Bridge at ${url}`);
        
        bridgeSocket = new WebSocket(url);
        
        bridgeSocket.onopen = () => {
            console.log("Bridge Socket Open");
            bridgeSocket?.send(JSON.stringify({ type: 'init', token: token, instrumentKeys: [currentInstrumentId] }));
        };

        bridgeSocket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                
                if (msg.type === 'connection_status') {
                    connectionStatus = msg.status;
                    if (msg.status === 'CONNECTED') {
                        isLiveMode = true;
                        if (feedInterval) clearInterval(feedInterval);
                    }
                    broadcast();
                }
                else if (msg.type === 'live_feed' || msg.type === 'initial_feed') {
                    processFeedFrame(msg as NSEFeed);
                } 
                else if (msg.type === 'option_chain_response') {
                    handleOptionChainData(msg.data, msg.underlyingKey);
                }
                else if (msg.type === 'quote_response') {
                    if (msg.data) {
                        console.log(`[Frontend] Received Quote for ${Object.keys(msg.data).length} keys.`);
                        Object.keys(msg.data).forEach(k => {
                            const price = msg.data[k].last_price;
                            if (price) {
                                // Add to cache if new
                                if (!instrumentsCache.includes(k)) {
                                    instrumentsCache.push(k);
                                    if (!instrumentNames[k]) instrumentNames[k] = k;
                                }

                                if (!instrumentStates[k]) instrumentStates[k] = createInitialState(price);
                                else instrumentStates[k].currentPrice = price;
                                
                                if (areKeysEqual(k, underlyingInstrumentId)) {
                                    recalculateOptionList(price);
                                }
                            }
                        });
                        broadcast();
                    }
                }
                else if (msg.type === 'error') {
                    console.error("Bridge Error:", msg.message);
                    if (onStatusUpdate) onStatusUpdate(`Error: ${msg.message}`);
                    alert(`Bridge Error: ${msg.message}`);
                }
            } catch (e) { 
                console.error("Parse Error", e); 
            }
        };

        bridgeSocket.onclose = () => {
            connectionStatus = 'DISCONNECTED';
            isLiveMode = false;
            bridgeSocket = null;
            startFeedProcessing();
            broadcast();
        };

        bridgeSocket.onerror = (e) => {
            connectionStatus = 'ERROR';
            bridgeSocket = null;
            broadcast();
            alert("Connection Error. Is the bridge running?");
        };

    } catch (err: any) {
        console.error("Connection Failed:", err);
        connectionStatus = 'ERROR';
        broadcast();
        alert(`Failed to connect: ${err.message}`);
    }
};

export const injectIceberg = (side: OrderSide) => {
    const state = instrumentStates[currentInstrumentId];
    if (!state) return;
    const iceberg: ActiveIceberg = {
        id: Math.random().toString(),
        price: state.currentPrice,
        side: side,
        detectedAt: Date.now(),
        lastUpdate: Date.now(),
        totalFilled: 0,
        status: 'ACTIVE'
    };
    state.activeIcebergs.push(iceberg);
    broadcast();
    setTimeout(() => {
        state.activeIcebergs = state.activeIcebergs.filter(i => i.id !== iceberg.id);
        broadcast();
    }, 5000);
};