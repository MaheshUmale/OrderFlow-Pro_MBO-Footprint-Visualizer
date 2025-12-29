import { MarketState, OrderSide, PriceLevel, IcebergType, Trade, FootprintBar, ActiveIceberg, NSEFeed, InstrumentFeed, BidAskQuote, TradeSignal, InstrumentState, UpstoxContract } from '../types';

// --- DATA SNAPSHOT ---
const REAL_DATA_SNAPSHOT: any = {
  "type": "live_feed",
  "feeds": {
    "NSE_FO|49543": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 24100.0}, "marketLevel": {"bidAskQuote": []}, "vtt": "100"}}}
  }
};

// --- CONFIG ---
const DEFAULT_INSTRUMENTS = [
    { key: "NSE_FO|49543", name: "NIFTY FUT 30 DEC 25", underlying: "NSE_INDEX|Nifty 50" },
    { key: "NSE_FO|49508", name: "BANKNIFTY FUT 30 DEC 25", underlying: "NSE_INDEX|Nifty Bank" }
];

let currentInstrumentId = "NSE_FO|49543";

// State Management
let instrumentsCache: string[] = DEFAULT_INSTRUMENTS.map(i => i.key);
let instrumentNames: { [key: string]: string } = {};
DEFAULT_INSTRUMENTS.forEach(i => instrumentNames[i.key] = i.name);

let feedInterval: any = null;
let subscribers: ((data: MarketState) => void)[] = [];
let connectionStatus: MarketState['connectionStatus'] = 'DISCONNECTED';
let onStatusUpdate: ((status: string) => void) | null = null;
let feedDataQueue: any[] = [];
let simulationSpeed = 1;

// WebSocket State
let bridgeSocket: WebSocket | null = null;
let isLiveMode = false;

// Instrument States
const instrumentStates: { [id: string]: InstrumentState } = {};

// Option Chain State
let cachedOptionContracts: UpstoxContract[] = [];
let underlyingInstrumentId = "";
let futureInstrumentId = ""; 
let lastCalculatedAtm = 0;
let userToken = ""; 
let lastSentSubscribeKeys: string[] = []; 

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
  swingHigh: price * 1.002,
  swingLow: price * 0.998,
  marketTrend: 'NEUTRAL',
  openInterest: 0,
  openInterestChange: 0,
  openInterestDelta: 0,
  vwap: price,
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
    levels: []
  },
  lastBook: []
});

// Init Default States
DEFAULT_INSTRUMENTS.forEach(inst => {
    instrumentStates[inst.key] = createInitialState(24000);
});

// --- HELPER FUNCTIONS ---

const convertQuoteToBook = (quotes: BidAskQuote[], currentPrice: number): PriceLevel[] => {
    const levelMap = new Map<number, PriceLevel>();
    quotes.forEach((q, idx) => {
        if (q.bidP > 0) {
            const bidP = parseFloat(q.bidP.toString());
            if (!levelMap.has(bidP)) levelMap.set(bidP, { price: bidP, bids: [], asks: [], totalBidSize: 0, totalAskSize: 0, impliedIceberg: false });
            const l = levelMap.get(bidP)!;
            l.totalBidSize += parseInt(q.bidQ);
            if (l.bids.length < 3) l.bids.push({ id: `b-${idx}`, price: bidP, size: parseInt(q.bidQ), priority: idx, icebergType: IcebergType.NONE, displayedSize: parseInt(q.bidQ), totalSizeEstimated: parseInt(q.bidQ) });
        }
        if (q.askP > 0) {
            const askP = parseFloat(q.askP.toString());
            if (!levelMap.has(askP)) levelMap.set(askP, { price: askP, bids: [], asks: [], totalBidSize: 0, totalAskSize: 0, impliedIceberg: false });
            const l = levelMap.get(askP)!;
            l.totalAskSize += parseInt(q.askQ);
            if (l.asks.length < 3) l.asks.push({ id: `a-${idx}`, price: askP, size: parseInt(q.askQ), priority: idx, icebergType: IcebergType.NONE, displayedSize: parseInt(q.askQ), totalSizeEstimated: parseInt(q.askQ) });
        }
    });
    return Array.from(levelMap.values()).sort((a,b) => b.price - a.price);
};

const updateFootprint = (state: InstrumentState, trade: Trade) => {
    let bar = state.currentBar;
    if (bar.volume > 5000) {
        state.footprintBars = [...state.footprintBars, bar].slice(-20);
        state.currentBar = {
            timestamp: Date.now(),
            open: trade.price,
            high: trade.price,
            low: trade.price,
            close: trade.price,
            volume: 0,
            delta: 0,
            cvd: state.globalCVD,
            levels: []
        };
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
    
    if (level.askVol > level.bidVol * 3 || level.bidVol > level.askVol * 3) level.imbalance = true;

    const bookLevel = state.book.find(l => Math.abs(l.price - trade.price) < 0.001);
    if (bookLevel) {
        const totalDepth = bookLevel.totalBidSize + bookLevel.totalAskSize;
        level.depthIntensity = Math.min(totalDepth / 2000, 1);
    }
};

const broadcast = () => {
    try {
        const currentState = instrumentStates[currentInstrumentId];
        if (!currentState) return;

        const marketState: MarketState = {
            ...currentState,
            selectedInstrument: currentInstrumentId,
            availableInstruments: instrumentsCache,
            instrumentNames: instrumentNames,
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
    if (cachedOptionContracts.length === 0) {
        instrumentsCache = Array.from(new Set([...instrumentsCache, ...frameInstruments]));
    }

    frameInstruments.forEach(id => {
        const fullFeed = frame.feeds[id].fullFeed;
        if (!fullFeed || !fullFeed.marketFF) return;
        const feedData = fullFeed.marketFF;
        if (!feedData.ltpc) return;

        if (!instrumentStates[id]) instrumentStates[id] = createInitialState(feedData.ltpc.ltp || 0);
        const state = instrumentStates[id];
        
        const newPrice = feedData.ltpc.ltp;
        const prevPrice = state.currentPrice;
        state.currentPrice = newPrice;

        if (id === underlyingInstrumentId && cachedOptionContracts.length > 0) recalculateOptionList(newPrice);

        if (feedData.marketLevel?.bidAskQuote) {
             state.book = convertQuoteToBook(feedData.marketLevel.bidAskQuote, state.currentPrice);
             state.lastBook = state.book;
        }

        if (feedData.oi) {
            const currentOI = parseInt(feedData.oi, 10);
            if (!isNaN(currentOI)) {
                if (state.openInterest === 0) state.openInterest = currentOI;
                else {
                    state.openInterestDelta = currentOI - state.openInterest;
                    state.openInterestChange += state.openInterestDelta;
                    state.openInterest = currentOI;
                }
            }
        }

        const currentTotalVol = parseInt(feedData.vtt || "0", 10);
        const volDiff = currentTotalVol - state.lastVol;
        
        if (volDiff > 0 && state.lastVol > 0) {
            const side = newPrice >= prevPrice ? OrderSide.ASK : OrderSide.BID; 
            const newTrade: Trade = {
                id: Math.random().toString(36).substr(2, 9),
                price: newPrice,
                size: volDiff,
                side: side,
                timestamp: Date.now(),
                isIcebergExecution: false 
            };
            
            state.recentTrades = [newTrade, ...state.recentTrades].slice(0, 50);
            state.lastVol = currentTotalVol;
            state.globalCVD += (side === OrderSide.ASK ? volDiff : -volDiff);
            updateFootprint(state, newTrade);
        } else if (state.lastVol === 0) {
            state.lastVol = currentTotalVol;
        }
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

// --- EXPORTED FUNCTIONS ---

export const getUnderlyingForInstrument = (instrumentKey: string): string => {
    const inst = DEFAULT_INSTRUMENTS.find(i => i.key === instrumentKey);
    return inst ? (inst.underlying || "") : "";
};

export const setInstrument = (id: string) => {
    currentInstrumentId = id;
    if (!instrumentStates[id]) {
        const knownPrice = Object.values(instrumentStates).find(s => s.currentPrice > 0)?.currentPrice || 1000;
        instrumentStates[id] = createInitialState(knownPrice);
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
    if (!bridgeSocket) {
        alert("Please connect to bridge first!");
        return;
    }
    if (statusCallback) onStatusUpdate = statusCallback;
    userToken = token;
    underlyingInstrumentId = underlyingKey;
    if (manualFutureKey) futureInstrumentId = manualFutureKey;

    bridgeSocket.send(JSON.stringify({ type: 'get_option_chain', instrumentKey: underlyingKey, token: token }));
    bridgeSocket.send(JSON.stringify({ type: 'get_quotes', instrumentKeys: [underlyingKey], token: token }));
};

const handleOptionChainData = (contracts: UpstoxContract[], underlyingKey: string) => {
    if (!contracts || contracts.length === 0) return;
    const today = new Date().toISOString().split('T')[0];
    const expiries = Array.from(new Set(contracts.map(c => c.expiry))).sort();
    const nearestExpiry = expiries.find(e => e >= today) || expiries[0];
    if (!nearestExpiry) return;

    cachedOptionContracts = contracts.filter(c => c.expiry === nearestExpiry);
    const newInstrumentKeys: string[] = [underlyingKey];
    const newNames: { [key: string]: string } = { [underlyingKey]: "SPOT / INDEX" };

    instrumentsCache = newInstrumentKeys;
    instrumentNames = newNames;
    broadcast();
    
    const state = instrumentStates[underlyingKey];
    if (state && state.currentPrice > 0) recalculateOptionList(state.currentPrice);
};

const recalculateOptionList = (spotPrice: number) => {
    if (cachedOptionContracts.length === 0) return;
    
    let minDiff = Infinity;
    let atmStrike = 0;
    cachedOptionContracts.forEach(c => {
        const diff = Math.abs(c.strike_price - spotPrice);
        if (diff < minDiff) { minDiff = diff; atmStrike = c.strike_price; }
    });
    if (atmStrike === 0 || atmStrike === lastCalculatedAtm) return;
    lastCalculatedAtm = atmStrike;

    const distinctStrikes = Array.from(new Set(cachedOptionContracts.map(c => c.strike_price))).sort((a,b) => a-b);
    const atmIndex = distinctStrikes.indexOf(atmStrike);
    if (atmIndex === -1) return;

    const startIndex = Math.max(0, atmIndex - 5);
    const endIndex = Math.min(distinctStrikes.length, atmIndex + 6);
    const relevantStrikes = distinctStrikes.slice(startIndex, endIndex);
    const relevantContracts = cachedOptionContracts.filter(c => relevantStrikes.includes(c.strike_price));
    
    const newInstrumentKeys: string[] = [underlyingInstrumentId];
    const newNames: { [key: string]: string } = { [underlyingInstrumentId]: "SPOT / INDEX" };

    relevantContracts.sort((a,b) => a.strike_price - b.strike_price).forEach(c => {
        newInstrumentKeys.push(c.instrument_key);
        newNames[c.instrument_key] = c.trading_symbol || `${c.instrument_type} ${c.strike_price}`;
    });

    instrumentsCache = newInstrumentKeys;
    instrumentNames = newNames;

    // SMART SUBSCRIBE
    newInstrumentKeys.sort();
    const isSame = newInstrumentKeys.length === lastSentSubscribeKeys.length && 
                   newInstrumentKeys.every((value, index) => value === lastSentSubscribeKeys[index]);

    if (!isSame && bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
        bridgeSocket.send(JSON.stringify({ type: 'subscribe', instrumentKeys: newInstrumentKeys }));
        lastSentSubscribeKeys = newInstrumentKeys;
    }
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
            console.log("Bridge Connected");
            connectionStatus = 'CONNECTED';
            isLiveMode = true;
            if (feedInterval) clearInterval(feedInterval); 
            bridgeSocket?.send(JSON.stringify({ type: 'init', token: token, instrumentKeys: [currentInstrumentId] }));
            broadcast();
        };

        bridgeSocket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'live_feed' || msg.type === 'initial_feed') processFeedFrame(msg as NSEFeed);
                else if (msg.type === 'option_chain_response') handleOptionChainData(msg.data, msg.underlyingKey);
                else if (msg.type === 'quote_response') {
                    if (msg.data) Object.keys(msg.data).forEach(k => {
                        const price = msg.data[k].last_price;
                        if (price) {
                             if (!instrumentStates[k]) instrumentStates[k] = createInitialState(price);
                             else instrumentStates[k].currentPrice = price;
                             if (k === underlyingInstrumentId) recalculateOptionList(price);
                        }
                    });
                } else if (msg.type === 'connection_status') {
                    connectionStatus = msg.status;
                    broadcast();
                } else if (msg.type === 'error') {
                    console.error("Bridge Error:", msg.message);
                    if (onStatusUpdate) onStatusUpdate(`Error: ${msg.message}`);
                }
            } catch (e) { console.error("Parse Error", e); }
        };

        bridgeSocket.onclose = () => {
            connectionStatus = 'DISCONNECTED';
            isLiveMode = false;
            startFeedProcessing();
            broadcast();
        };

        bridgeSocket.onerror = () => {
            console.error("Bridge WebSocket Connection Error.");
            connectionStatus = 'ERROR';
            broadcast();
        };

    } catch (err) {
        connectionStatus = 'ERROR';
        broadcast();
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