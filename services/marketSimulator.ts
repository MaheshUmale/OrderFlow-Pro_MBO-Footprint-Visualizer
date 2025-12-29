import { MarketState, OrderSide, PriceLevel, IcebergType, Trade, FootprintBar, Order, ActiveIceberg, NSEFeed, InstrumentFeed, BidAskQuote, TradeSignal, AuctionProfile, InstrumentState, MarketClusterConfig, UpstoxContract } from '../types';

// --- ACTUAL DATA SNAPSHOT FROM USER (Default Fallback) ---
const REAL_DATA_SNAPSHOT: any = {
  "type": "live_feed",
  "feeds": {
    "NSE_EQ|INE118H01025": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 2659.7, "ltt": "1766733809227", "ltq": "1", "cp": 2670.9}, "marketLevel": {"bidAskQuote": [{"bidQ": "15", "bidP": 2659.2, "askQ": "3", "askP": 2659.7}, {"bidQ": "71", "bidP": 2659.1, "askQ": "680", "askP": 2660.0}, {"bidQ": "275", "bidP": 2659.0, "askQ": "29", "askP": 2660.2}, {"bidQ": "48", "bidP": 2658.9, "askQ": "271", "askP": 2660.4}, {"bidQ": "225", "bidP": 2658.8, "askQ": "147", "askP": 2660.6}]}, "vtt": "1742386"}}},
    "NSE_EQ|INE498L01015": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 302.05}, "marketLevel": {"bidAskQuote": [{"bidQ": "78", "bidP": 302.05, "askQ": "2172", "askP": 302.2}, {"bidQ": "1773", "bidP": 302.0, "askQ": "1603", "askP": 302.25}]}, "vtt": "2418902"}}},
    "NSE_FO|65634": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 123.3}, "marketLevel": {"bidAskQuote": [{"bidQ": "1200", "bidP": 123.0, "askQ": "825", "askP": 123.2}, {"bidQ": "525", "bidP": 122.95, "askQ": "1200", "askP": 123.25}]}, "vtt": "128761125"}}},
    "NSE_EQ|INE263A01024": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 401.85}, "marketLevel": {"bidAskQuote": [{"bidQ": "4204", "bidP": 401.85, "askQ": "355", "askP": 402.0}, {"bidQ": "353", "bidP": 401.8, "askQ": "811", "askP": 402.05}]}, "vtt": "7953214"}}}
  }
};

let currentInstrumentId = "NSE_FO|65634"; // Default
let instrumentsCache: string[] = [];
let instrumentNames: { [key: string]: string } = {};
let feedInterval: any = null;
let subscribers: ((data: MarketState) => void)[] = [];
let connectionStatus: MarketState['connectionStatus'] = 'DISCONNECTED';
let onStatusUpdate: ((status: string) => void) | null = null;
let feedDataQueue: any[] = [];
let simulationSpeed = 1;

// WS State
let bridgeSocket: WebSocket | null = null;
let isLiveMode = false;

// Store state for MULTIPLE instruments
const instrumentStates: { [id: string]: InstrumentState } = {};

// Option Chain Logic State
let cachedOptionContracts: UpstoxContract[] = [];
let underlyingInstrumentId = "";
let futureInstrumentId = ""; // To track the future
let lastCalculatedAtm = 0;
let userToken = ""; // Store for API calls

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

// --- HELPER FUNCTIONS (Defined before use to prevent ReferenceError) ---

const convertQuoteToBook = (quotes: BidAskQuote[], currentPrice: number): PriceLevel[] => {
    const levelMap = new Map<number, PriceLevel>();

    quotes.forEach((q, idx) => {
        // Bid
        if (q.bidP > 0) {
            const bidP = parseFloat(q.bidP.toString()); // Ensure float
            if (!levelMap.has(bidP)) {
                levelMap.set(bidP, { price: bidP, bids: [], asks: [], totalBidSize: 0, totalAskSize: 0, impliedIceberg: false });
            }
            const l = levelMap.get(bidP)!;
            l.totalBidSize += parseInt(q.bidQ);
            // Simulate MBO orders from level data (for visual)
            if (l.bids.length < 3) {
                 l.bids.push({ id: `b-${idx}`, price: bidP, size: parseInt(q.bidQ), priority: idx, icebergType: IcebergType.NONE, displayedSize: parseInt(q.bidQ), totalSizeEstimated: parseInt(q.bidQ) });
            }
        }
        // Ask
        if (q.askP > 0) {
            const askP = parseFloat(q.askP.toString());
            if (!levelMap.has(askP)) {
                levelMap.set(askP, { price: askP, bids: [], asks: [], totalBidSize: 0, totalAskSize: 0, impliedIceberg: false });
            }
            const l = levelMap.get(askP)!;
            l.totalAskSize += parseInt(q.askQ);
            if (l.asks.length < 3) {
                 l.asks.push({ id: `a-${idx}`, price: askP, size: parseInt(q.askQ), priority: idx, icebergType: IcebergType.NONE, displayedSize: parseInt(q.askQ), totalSizeEstimated: parseInt(q.askQ) });
            }
        }
    });
    
    return Array.from(levelMap.values()).sort((a,b) => b.price - a.price);
};

const updateFootprint = (state: InstrumentState, trade: Trade) => {
    // 1. Get or Create Current Bar
    let bar = state.currentBar;
    
    // New Bar Logic (e.g., every 5000 volume for demo)
    if (bar.volume > 5000) {
        state.footprintBars = [...state.footprintBars, bar].slice(-20); // Keep last 20 bars
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

    // 2. Update Bar Stats
    bar.high = Math.max(bar.high, trade.price);
    bar.low = Math.min(bar.low, trade.price);
    bar.close = trade.price;
    bar.volume += trade.size;
    
    const deltaChange = trade.side === OrderSide.ASK ? trade.size : -trade.size;
    bar.delta += deltaChange;
    bar.cvd = state.globalCVD;

    // 3. Update Level Stats
    let level = bar.levels.find(l => Math.abs(l.price - trade.price) < 0.001);
    if (!level) {
        level = { price: trade.price, bidVol: 0, askVol: 0, delta: 0, imbalance: false, depthIntensity: 0 };
        bar.levels.push(level);
        bar.levels.sort((a, b) => b.price - a.price);
    }
    
    if (trade.side === OrderSide.ASK) {
        level.askVol += trade.size;
    } else {
        level.bidVol += trade.size;
    }
    level.delta = level.askVol - level.bidVol;
    
    // Imbalance Check (Diagonal or Level)
    if (level.askVol > level.bidVol * 3 || level.bidVol > level.askVol * 3) {
        level.imbalance = true;
    }

    // Update Depth Intensity (Heatmap effect inside footprint)
    const bookLevel = state.book.find(l => Math.abs(l.price - trade.price) < 0.001);
    if (bookLevel) {
        const totalDepth = bookLevel.totalBidSize + bookLevel.totalAskSize;
        level.depthIntensity = Math.min(totalDepth / 2000, 1);
    }
};

const analyzeMarketStructure = (state: InstrumentState) => {
   // Implementation of signal logic (CVD Divergence, Trapped Traders)
   const trade = state.recentTrades[0];
   if (!trade) return;

   // CVD Divergence: Price High but CVD Lower than previous High
   if (trade.price > state.swingHigh && state.globalCVD < 0) {
       // Signal: Absorption High (Example logic)
   }
};

// --- CORE FUNCTIONS ---

// Defined before use in higher order functions
const broadcast = () => {
    try {
        const currentState = instrumentStates[currentInstrumentId];
        if (!currentState) return; // Safely return if state is not ready

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
    try {
        if (!frame.feeds) return;

        // 1. Update List of Instruments (Basic append for raw feed)
        const frameInstruments = Object.keys(frame.feeds);
        // Only append if we aren't in dynamic option mode
        if (cachedOptionContracts.length === 0) {
            instrumentsCache = Array.from(new Set([...instrumentsCache, ...frameInstruments]));
        }

        // 2. Process each instrument in the frame
        frameInstruments.forEach(id => {
            const fullFeed = frame.feeds[id].fullFeed;
            if (!fullFeed || !fullFeed.marketFF) return; // Skip if empty

            const feedData = fullFeed.marketFF;
            
            // Safety check for LTPC
            if (!feedData.ltpc) return;

            // Initialize if new
            if (!instrumentStates[id]) {
                instrumentStates[id] = createInitialState(feedData.ltpc.ltp || 0);
            }

            const state = instrumentStates[id];
            
            // A. Update Price
            const newPrice = feedData.ltpc.ltp;
            const prevPrice = state.currentPrice;
            state.currentPrice = newPrice;

            // *** DYNAMIC OPTION LIST RECALCULATION ***
            if (id === underlyingInstrumentId && cachedOptionContracts.length > 0) {
                 recalculateOptionList(newPrice);
            }

            // B. Update Book (MBO Simulation from Depth)
            if (feedData.marketLevel && feedData.marketLevel.bidAskQuote) {
                 state.book = convertQuoteToBook(feedData.marketLevel.bidAskQuote, state.currentPrice);
                 state.lastBook = state.book;
            }

            // C. Update OI (Open Interest)
            if (feedData.oi) {
                const currentOI = parseInt(feedData.oi, 10);
                if (!isNaN(currentOI)) {
                    if (state.openInterest === 0) {
                        state.openInterest = currentOI; // Init
                    } else {
                        state.openInterestDelta = currentOI - state.openInterest;
                        state.openInterestChange += state.openInterestDelta;
                        state.openInterest = currentOI;
                    }
                }
            }

            // D. Simulate Trades based on Volume Diff
            const currentTotalVol = parseInt(feedData.vtt || "0", 10);
            const volDiff = currentTotalVol - state.lastVol;
            
            if (volDiff > 0 && state.lastVol > 0) {
                // Infer trade side based on price move
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

                // Update Footprint
                updateFootprint(state, newTrade);
                
                // Run Signal Logic
                state.globalCVD += (side === OrderSide.ASK ? volDiff : -volDiff);
                analyzeMarketStructure(state);
            } else if (state.lastVol === 0) {
                state.lastVol = currentTotalVol;
            }

        });

        broadcast();
    } catch (e) {
        console.error("Feed Process Error:", e);
    }
};

const startFeedProcessing = () => {
    if (feedInterval) clearInterval(feedInterval);
    if (isLiveMode) return; // Don't run simulation in live mode
    
    feedInterval = setInterval(() => {
        if (feedDataQueue.length > 0) {
            // Process next frame
            const frame = feedDataQueue.shift();
            // Loop it for demo purposes if it runs out
            feedDataQueue.push(frame); 
            
            processFeedFrame(frame);
        }
    }, 1000 / simulationSpeed);
};

// --- EXPORTED FUNCTIONS ---

export const setInstrument = (id: string) => {
    currentInstrumentId = id;
    
    // Ensure state exists for this instrument before broadcasting
    if (!instrumentStates[id]) {
        // Try to copy price from another instrument as fallback, or use 1000
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
    // Reset states
    Object.keys(instrumentStates).forEach(k => delete instrumentStates[k]);
    if (!isLiveMode) startFeedProcessing();
};

export const subscribeToMarketData = (callback: (data: MarketState) => void) => {
  subscribers.push(callback);
  
  // If queue is empty and not live, load snapshot
  if (feedDataQueue.length === 0 && !isLiveMode) {
     uploadFeedData([REAL_DATA_SNAPSHOT]);
  } else {
      // Broadcast current state immediately to new subscriber
      broadcast();
  }

  return () => {
    subscribers = subscribers.filter(s => s !== callback);
  };
};

// --- DYNAMIC OPTION CHAIN LOGIC ---

export const fetchOptionChain = (underlyingKey: string, token: string, manualFutureKey?: string, statusCallback?: (s: string) => void) => {
    if (!bridgeSocket) {
        alert("Please connect to bridge first!");
        return;
    }
    if (statusCallback) onStatusUpdate = statusCallback;
    
    userToken = token;
    console.log(`Requesting Option Chain for ${underlyingKey}`);
    if (onStatusUpdate) onStatusUpdate('Fetching Chain...');
    
    underlyingInstrumentId = underlyingKey;
    if (manualFutureKey) futureInstrumentId = manualFutureKey;

    // 1. Send Option Chain Request
    bridgeSocket.send(JSON.stringify({
        type: 'get_option_chain',
        instrumentKey: underlyingKey,
        token: token
    }));

    // 2. IMMEDIATELY fetch the Quote/LTP for the underlying via REST
    bridgeSocket.send(JSON.stringify({
        type: 'get_quotes',
        instrumentKeys: [underlyingKey],
        token: token
    }));
};

const handleQuoteResponse = (data: any) => {
    if (!data) return;
    
    Object.keys(data).forEach(key => {
        const quote = data[key];
        const price = quote.last_price;
        if (price) {
             if (!instrumentStates[key]) {
                 instrumentStates[key] = createInitialState(price);
             } else {
                 instrumentStates[key].currentPrice = price;
             }
             
             if (key === underlyingInstrumentId) {
                 recalculateOptionList(price);
             }
        }
    });
};

const handleOptionChainData = (contracts: UpstoxContract[], underlyingKey: string, futureContract?: any) => {
    if (!contracts || contracts.length === 0) {
        if (onStatusUpdate) onStatusUpdate('No Contracts Found');
        return;
    }

    console.log(`Received ${contracts.length} contracts for ${underlyingKey}`);
    
    // 1. Find Nearest Expiry
    const today = new Date().toISOString().split('T')[0];
    const expiries = Array.from(new Set(contracts.map(c => c.expiry))).sort();
    const nearestExpiry = expiries.find(e => e >= today) || expiries[0];
    
    if (!nearestExpiry) return;

    if (onStatusUpdate) onStatusUpdate(`Expiry: ${nearestExpiry}`);

    // 2. Filter for Nearest Expiry
    cachedOptionContracts = contracts.filter(c => c.expiry === nearestExpiry);
    
    // 3. Set Future Key if provided by Bridge
    const newInstrumentKeys: string[] = [];
    const newNames: { [key: string]: string } = {};

    // Add Underlying
    newInstrumentKeys.push(underlyingKey);
    newNames[underlyingKey] = "SPOT / INDEX";

    if (futureContract) {
        futureInstrumentId = futureContract.instrument_key;
        newInstrumentKeys.push(futureInstrumentId);
        newNames[futureInstrumentId] = `FUT: ${futureContract.trading_symbol}`;
        
        console.log(`Set Future Key from Bridge: ${futureContract.trading_symbol}`);
        if (onStatusUpdate) onStatusUpdate(`Found Future: ${futureContract.trading_symbol}`);
        
        // Auto-select Future
        currentInstrumentId = futureInstrumentId;
        
        // CRITICAL: Initialize state for future IMMEDIATELY
        if (!instrumentStates[currentInstrumentId]) {
             let initialPrice = 1000;
             if (instrumentStates[underlyingKey]) {
                 initialPrice = instrumentStates[underlyingKey].currentPrice;
             }
             instrumentStates[currentInstrumentId] = createInitialState(initialPrice);
        }

    } else {
        if (onStatusUpdate) onStatusUpdate('Future Not Found (Check Bridge Logs)');
    }
    
    instrumentsCache = newInstrumentKeys;
    instrumentNames = newNames;
    broadcast();
    
    lastCalculatedAtm = 0;
    
    const state = instrumentStates[underlyingKey];
    if (state && state.currentPrice > 0) {
        recalculateOptionList(state.currentPrice);
    }
};

const recalculateOptionList = (spotPrice: number) => {
    if (cachedOptionContracts.length === 0) return;

    // Find nearest strike
    let minDiff = Infinity;
    let atmStrike = 0;
    
    cachedOptionContracts.forEach(c => {
        const diff = Math.abs(c.strike_price - spotPrice);
        if (diff < minDiff) {
            minDiff = diff;
            atmStrike = c.strike_price;
        }
    });

    if (atmStrike === 0) return; 

    // Debounce
    if (atmStrike === lastCalculatedAtm) return;
    lastCalculatedAtm = atmStrike;
    
    if (onStatusUpdate) onStatusUpdate(`ATM: ${atmStrike}`);

    // Get Strikes: ATM, +5, -5
    const distinctStrikes = Array.from(new Set(cachedOptionContracts.map(c => c.strike_price))).sort((a,b) => a-b);
    const atmIndex = distinctStrikes.indexOf(atmStrike);
    
    if (atmIndex === -1) return;

    const startIndex = Math.max(0, atmIndex - 5);
    const endIndex = Math.min(distinctStrikes.length, atmIndex + 6);
    const relevantStrikes = distinctStrikes.slice(startIndex, endIndex);

    const relevantContracts = cachedOptionContracts.filter(c => relevantStrikes.includes(c.strike_price));
    
    // Generate new cache list
    const newInstrumentKeys: string[] = [];
    const newNames: { [key: string]: string } = {};

    if (underlyingInstrumentId) {
        newInstrumentKeys.push(underlyingInstrumentId);
        newNames[underlyingInstrumentId] = "SPOT / INDEX";
    }

    if (futureInstrumentId) {
        newInstrumentKeys.push(futureInstrumentId);
        newNames[futureInstrumentId] = instrumentNames[futureInstrumentId] || "FUTURE (CUR MONTH)";
    }

    relevantContracts.sort((a,b) => a.strike_price - b.strike_price).forEach(c => {
        newInstrumentKeys.push(c.instrument_key);
        newNames[c.instrument_key] = c.trading_symbol || `${c.instrument_type} ${c.strike_price}`;
    });

    instrumentsCache = newInstrumentKeys;
    instrumentNames = newNames;
    
    if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
        bridgeSocket.send(JSON.stringify({ type: 'subscribe', instrumentKeys: newInstrumentKeys }));
    }
    
    broadcast();
};

export const connectToBridge = (url: string, token: string) => {
    if (bridgeSocket) {
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
            
            bridgeSocket?.send(JSON.stringify({
                type: 'init',
                token: token,
                instrumentKeys: [currentInstrumentId]
            }));
            broadcast();
        };

        bridgeSocket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                
                if (msg.type === 'live_feed' || msg.type === 'initial_feed') {
                    processFeedFrame(msg as NSEFeed);
                } else if (msg.type === 'option_chain_response') {
                    handleOptionChainData(msg.data, msg.underlyingKey, msg.futureContract);
                } else if (msg.type === 'quote_response') {
                    handleQuoteResponse(msg.data);
                } else if (msg.type === 'connection_status') {
                    if (msg.status === 'LOADING_MASTER_LIST') {
                        if (onStatusUpdate) onStatusUpdate('Server Loading Master List...');
                    } else {
                        connectionStatus = msg.status;
                        broadcast();
                    }
                } else if (msg.type === 'error') {
                    console.error("Bridge Error:", msg.message);
                    connectionStatus = 'ERROR';
                    broadcast();
                }
            } catch (e) {
                console.error("Failed to parse bridge message", e);
            }
        };

        bridgeSocket.onclose = () => {
            console.log("Bridge Disconnected");
            connectionStatus = 'DISCONNECTED';
            isLiveMode = false;
            startFeedProcessing();
            broadcast();
        };

        bridgeSocket.onerror = (err) => {
            console.error("Bridge WebSocket Connection Error. Check if server is running on port 4000.");
            connectionStatus = 'ERROR';
            broadcast();
        };

    } catch (err) {
        console.error("Failed to connect to bridge", err);
        connectionStatus = 'ERROR';
        broadcast();
    }
};

export const injectIceberg = (side: OrderSide) => {
    const state = instrumentStates[currentInstrumentId];
    if (!state) return;
    
    const price = state.currentPrice;
    const iceberg: ActiveIceberg = {
        id: Math.random().toString(),
        price: price,
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