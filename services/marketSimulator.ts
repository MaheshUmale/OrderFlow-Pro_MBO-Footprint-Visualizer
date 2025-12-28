import { MarketState, OrderSide, PriceLevel, IcebergType, Trade, FootprintBar, Order, ActiveIceberg, NSEFeed, InstrumentFeed, BidAskQuote, TradeSignal, AuctionProfile, InstrumentState, MarketClusterConfig } from '../types';

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
let feedInterval: any = null;
let subscribers: ((data: MarketState) => void)[] = [];

// Store state for MULTIPLE instruments
const instrumentStates: { [id: string]: InstrumentState } = {};

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

// --- SIMULATION LOGIC ---
let feedDataQueue: any[] = [];
let simulationSpeed = 1;

export const setInstrument = (id: string) => {
    currentInstrumentId = id;
    broadcast();
};

export const setSimulationSpeed = (speed: number) => {
    simulationSpeed = speed;
    if (feedInterval) clearInterval(feedInterval);
    startFeedProcessing();
};

export const uploadFeedData = (frames: any[]) => {
    feedDataQueue = frames;
    // Reset states
    Object.keys(instrumentStates).forEach(k => delete instrumentStates[k]);
    startFeedProcessing();
};

export const subscribeToMarketData = (callback: (data: MarketState) => void) => {
  subscribers.push(callback);
  
  // If queue is empty, load snapshot
  if (feedDataQueue.length === 0) {
     uploadFeedData([REAL_DATA_SNAPSHOT]);
  }

  return () => {
    subscribers = subscribers.filter(s => s !== callback);
  };
};

const startFeedProcessing = () => {
    if (feedInterval) clearInterval(feedInterval);
    
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

const processFeedFrame = (frame: NSEFeed) => {
    // 1. Update List of Instruments
    const frameInstruments = Object.keys(frame.feeds);
    instrumentsCache = Array.from(new Set([...instrumentsCache, ...frameInstruments]));

    // 2. Process each instrument in the frame
    frameInstruments.forEach(id => {
        const feedData = frame.feeds[id].fullFeed.marketFF;
        
        // Initialize if new
        if (!instrumentStates[id]) {
            instrumentStates[id] = createInitialState(feedData.ltpc.ltp);
        }

        const state = instrumentStates[id];
        
        // A. Update Price
        const newPrice = feedData.ltpc.ltp;
        const prevPrice = state.currentPrice;
        state.currentPrice = newPrice;

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
        // In a real MBO feed, we get individual trade ticks. 
        // In a snapshot feed, we must infer trades from Total Volume change.
        const currentTotalVol = parseInt(feedData.vtt || "0", 10);
        const volDiff = currentTotalVol - state.lastVol;
        
        if (volDiff > 0 && state.lastVol > 0) {
            // Infer trade side based on price move
            const side = newPrice >= prevPrice ? OrderSide.ASK : OrderSide.BID; // Simple uptick rule
            
            const newTrade: Trade = {
                id: Math.random().toString(36).substr(2, 9),
                price: newPrice,
                size: volDiff,
                side: side,
                timestamp: Date.now(),
                isIcebergExecution: false // Logic to detect this requires real MBO
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
};

const convertQuoteToBook = (quotes: BidAskQuote[], currentPrice: number): PriceLevel[] => {
    // Map NSE Quote format to our internal PriceLevel format
    const levels: PriceLevel[] = [];
    
    // Process Bids and Asks into a unified sorted list
    // NSE gives 5 best bids and 5 best asks.
    
    // We create a map to merge same price levels if they overlap (unlikely in quote data but good practice)
    const levelMap = new Map<number, PriceLevel>();

    quotes.forEach((q, idx) => {
        // Bid
        if (q.bidP > 0) {
            const bidP = parseFloat(q.bidP.toString()); // Ensure float
            if (!levelMap.has(bidP)) {
                levelMap.set(bidP, { price: bidP, bids: [], asks: [], totalBidSize: 0, totalAskSize: 0, impliedIceberg: false });
            }
            const l = levelMap.get(bidP)!;
            l.totalBidSize = parseInt(q.bidQ);
            // Simulate MBO orders for visualization
            l.bids.push({ id: `b-${idx}`, price: bidP, size: l.totalBidSize, priority: idx, icebergType: IcebergType.NONE, displayedSize: l.totalBidSize, totalSizeEstimated: l.totalBidSize });
        }

        // Ask
        if (q.askP > 0) {
            const askP = parseFloat(q.askP.toString());
            if (!levelMap.has(askP)) {
                levelMap.set(askP, { price: askP, bids: [], asks: [], totalBidSize: 0, totalAskSize: 0, impliedIceberg: false });
            }
            const l = levelMap.get(askP)!;
            l.totalAskSize = parseInt(q.askQ);
            l.asks.push({ id: `a-${idx}`, price: askP, size: l.totalAskSize, priority: idx, icebergType: IcebergType.NONE, displayedSize: l.totalAskSize, totalSizeEstimated: l.totalAskSize });
        }
    });

    return Array.from(levelMap.values()).sort((a, b) => b.price - a.price); // High to Low
};

const updateFootprint = (state: InstrumentState, trade: Trade) => {
    const currentBar = state.currentBar;
    
    // Check if we need a new bar (e.g., every 30 seconds or volume threshold)
    // For demo, we rotate every 10 ticks or if time gap is large
    const TIME_THRESHOLD = 30 * 1000; 
    if (Date.now() - currentBar.timestamp > TIME_THRESHOLD) {
        // Close Bar
        currentBar.close = state.currentPrice;
        state.footprintBars.push({ ...currentBar }); // push copy
        if (state.footprintBars.length > 50) state.footprintBars.shift();
        
        // Reset
        state.currentBar = {
            timestamp: Date.now(),
            open: state.currentPrice,
            high: state.currentPrice,
            low: state.currentPrice,
            close: state.currentPrice,
            volume: 0,
            delta: 0,
            cvd: state.globalCVD,
            levels: []
        };
    }

    const bar = state.currentBar;
    bar.high = Math.max(bar.high, trade.price);
    bar.low = Math.min(bar.low, trade.price);
    bar.volume += trade.size;
    bar.delta += (trade.side === OrderSide.ASK ? trade.size : -trade.size);
    bar.cvd = state.globalCVD;
    bar.close = trade.price;

    // Update Levels
    let level = bar.levels.find(l => Math.abs(l.price - trade.price) < 0.001);
    if (!level) {
        level = { price: trade.price, bidVol: 0, askVol: 0, delta: 0, imbalance: false, depthIntensity: 0 };
        bar.levels.push(level);
        bar.levels.sort((a, b) => b.price - a.price);
    }

    if (trade.side === OrderSide.BID) {
        level.bidVol += trade.size;
    } else {
        level.askVol += trade.size;
    }
    level.delta = level.askVol - level.bidVol;
    
    // Calculate simple depth intensity for heatmap (relative to bar volume)
    level.depthIntensity = (level.bidVol + level.askVol) / (bar.volume || 1);
};

const analyzeMarketStructure = (state: InstrumentState) => {
    // 1. Structure Break
    if (state.currentPrice > state.swingHigh) {
        state.swingHigh = state.currentPrice;
        state.marketTrend = 'BULLISH';
        // Only signal if we have momentum
        if (state.recentTrades[0].size > 500) {
             emitSignal(state, 'STRUCTURE_BREAK_BULL', 'New High with Volume');
        }
    } else if (state.currentPrice < state.swingLow) {
        state.swingLow = state.currentPrice;
        state.marketTrend = 'BEARISH';
         if (state.recentTrades[0].size > 500) {
             emitSignal(state, 'STRUCTURE_BREAK_BEAR', 'New Low with Volume');
        }
    }

    // 2. Iceberg Detection (Simulated)
    // In real app, we check if price stays same but volume increases massively
    const trade = state.recentTrades[0];
    const level = state.currentBar.levels.find(l => Math.abs(l.price - trade.price) < 0.001);
    if (level) {
        if (level.bidVol > 1000 && level.askVol < 100) {
            // Massive selling absorbed
            emitSignal(state, 'ICEBERG_DEFENSE', 'Passive Buyers Absorbing Selling', OrderSide.BID);
        } else if (level.askVol > 1000 && level.bidVol < 100) {
             emitSignal(state, 'ICEBERG_DEFENSE', 'Passive Sellers Absorbing Buying', OrderSide.ASK);
        }
    }
};

const emitSignal = (state: InstrumentState, type: TradeSignal['type'], msg: string, side?: OrderSide) => {
    // Debounce signals at same price
    const existing = state.activeSignals.find(s => s.type === type && Math.abs(s.price - state.currentPrice) < 0.5);
    if (existing) return;

    const signal: TradeSignal = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        type: type,
        side: side === OrderSide.BID ? 'BULLISH' : 'BEARISH',
        price: state.currentPrice,
        message: msg,
        status: 'OPEN',
        pnlTicks: 0,
        entryTime: Date.now(),
        stopLoss: state.currentPrice + (side === OrderSide.BID ? -2.0 : 2.0),
        takeProfit: state.currentPrice + (side === OrderSide.BID ? 4.0 : -4.0),
        riskRewardRatio: 2
    };

    state.activeSignals.push(signal);
    // Move old closed signals to history (mock logic)
    if (state.activeSignals.length > 5) {
        const closed = state.activeSignals.shift();
        if (closed) {
            closed.status = closed.pnlTicks > 0 ? 'WIN' : 'LOSS';
            state.signalHistory.unshift(closed);
        }
    }
};

// --- EXPORTS FOR UI ACTIONS ---
export const injectIceberg = (side: OrderSide) => {
    const state = instrumentStates[currentInstrumentId];
    if (!state) return;
    
    // Create a fake iceberg at current price
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
};

const broadcast = () => {
    const state = instrumentStates[currentInstrumentId];
    if (!state) return;

    const uiState: MarketState = {
        ...state,
        selectedInstrument: currentInstrumentId,
        availableInstruments: instrumentsCache
    };
    subscribers.forEach(cb => cb(uiState));
};
