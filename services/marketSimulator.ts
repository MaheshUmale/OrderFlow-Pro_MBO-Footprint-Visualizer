import { MarketState, OrderSide, PriceLevel, IcebergType, Trade, FootprintBar, Order, ActiveIceberg, NSEFeed, InstrumentFeed, BidAskQuote, TradeSignal, AuctionProfile } from '../types';

// --- ACTUAL DATA SNAPSHOT FROM USER (Default Fallback) ---
const REAL_DATA_SNAPSHOT: any = {
  "type": "live_feed",
  "feeds": {
    "NSE_EQ|INE118H01025": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 2659.7, "ltt": "1766733809227", "ltq": "1", "cp": 2670.9}, "marketLevel": {"bidAskQuote": [{"bidQ": "15", "bidP": 2659.2, "askQ": "3", "askP": 2659.7}, {"bidQ": "71", "bidP": 2659.1, "askQ": "680", "askP": 2660.0}, {"bidQ": "275", "bidP": 2659.0, "askQ": "29", "askP": 2660.2}, {"bidQ": "48", "bidP": 2658.9, "askQ": "271", "askP": 2660.4}, {"bidQ": "225", "bidP": 2658.8, "askQ": "147", "askP": 2660.6}]}, "vtt": "1742386"}}},
    "NSE_EQ|INE498L01015": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 302.05}, "marketLevel": {"bidAskQuote": [{"bidQ": "78", "bidP": 302.05, "askQ": "2172", "askP": 302.2}, {"bidQ": "1773", "bidP": 302.0, "askQ": "1603", "askP": 302.25}]}, "vtt": "2418902"}}},
    "NSE_FO|65634": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 123.3}, "marketLevel": {"bidAskQuote": [{"bidQ": "1200", "bidP": 123.0, "askQ": "825", "askP": 123.2}, {"bidQ": "525", "bidP": 122.95, "askQ": "1200", "askP": 123.25}]}, "vtt": "128761125"}}},
    "NSE_EQ|INE263A01024": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 401.85}, "marketLevel": {"bidAskQuote": [{"bidQ": "4204", "bidP": 401.85, "askQ": "355", "askP": 401.95}]}, "vtt": "7440770"}}},
    "NSE_EQ|INE018A01030": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 4032.0}, "marketLevel": {"bidAskQuote": [{"bidQ": "12", "bidP": 4030.9, "askQ": "266", "askP": 4032.0}]}, "vtt": "299637"}}},
    "NSE_EQ|INE522F01014": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 404.25}, "marketLevel": {"bidAskQuote": [{"bidQ": "10", "bidP": 404.1, "askQ": "6", "askP": 404.25}, {"bidQ": "3085", "bidP": 404.05, "askQ": "1030", "askP": 404.3}]}, "vtt": "3472544"}}},
    "NSE_EQ|INE053F01010": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 131.73}, "marketLevel": {"bidAskQuote": [{"bidQ": "416", "bidP": 131.7, "askQ": "10", "askP": 131.71}, {"bidQ": "124", "bidP": 131.67, "askQ": "367", "askP": 131.72}]}, "vtt": "111130499"}}},
    "NSE_EQ|INE280A01028": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 3991.3}, "marketLevel": {"bidAskQuote": [{"bidQ": "23", "bidP": 3991.4, "askQ": "4", "askP": 3992.0}]}, "vtt": "626714"}}},
    "NSE_EQ|INE749A01030": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 988.0}, "marketLevel": {"bidAskQuote": [{"bidQ": "631", "bidP": 988.1, "askQ": "47", "askP": 988.5}]}, "vtt": "492722"}}},
    "NSE_FO|65629": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 32.3}, "marketLevel": {"bidAskQuote": [{"bidQ": "8775", "bidP": 32.2, "askQ": "2250", "askP": 32.3}, {"bidQ": "8325", "bidP": 32.15, "askQ": "9450", "askP": 32.35}]}, "vtt": "153141000"}}},
    "NSE_EQ|INE002A01018": {"fullFeed": {"marketFF": {"ltpc": {"ltp": 1556.3}, "marketLevel": {"bidAskQuote": [{"bidQ": "297", "bidP": 1556.0, "askQ": "471", "askP": 1556.3}]}, "vtt": "1107661"}}}
  },
  "currentTs": "1766733809445"
};

// Extract instruments dynamically from the real data
let INSTRUMENTS = Object.keys(REAL_DATA_SNAPSHOT.feeds);

// Internal state storage for multiple instruments
interface InstrumentState {
    lastVol: number;
    footprintBars: FootprintBar[];
    activeIcebergs: ActiveIceberg[];
    recentTrades: Trade[];
    currentPrice: number;
    currentBar: FootprintBar;
    lastBook: PriceLevel[]; 
    activeSignals: TradeSignal[];
    signalHistory: TradeSignal[];
    tickSize: number;
    auctionProfile?: AuctionProfile;
    globalCVD: number; 
    
    // Market Structure
    swingHigh: number;
    swingLow: number;
    marketTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

const instrumentStates: Map<string, InstrumentState> = new Map();

// Helper to initialize state for an instrument if it doesn't exist
const ensureInstrumentState = (inst: string, price: number) => {
    if (!instrumentStates.has(inst)) {
        instrumentStates.set(inst, {
            lastVol: 0,
            footprintBars: [],
            activeIcebergs: [],
            recentTrades: [],
            currentPrice: price,
            tickSize: 0.05,
            currentBar: createNewBar(price, Date.now(), 0),
            lastBook: [],
            activeSignals: [],
            signalHistory: [],
            globalCVD: 0,
            swingHigh: price,
            swingLow: price,
            marketTrend: 'NEUTRAL'
        });
    }
}

// Initialize States using the Real Data Snapshot (Default)
INSTRUMENTS.forEach(inst => {
    const rawData = REAL_DATA_SNAPSHOT.feeds[inst].fullFeed.marketFF;
    const price = rawData.ltpc.ltp;
    ensureInstrumentState(inst, price);
    const state = instrumentStates.get(inst)!;
    state.lastVol = parseInt(rawData.vtt || "0");
    state.lastBook = parseBook(rawData.marketLevel?.bidAskQuote, price); // Initial book
});

function createNewBar(price: number, time: number, startCvd: number): FootprintBar {
    return {
        timestamp: time,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        delta: 0,
        cvd: startCvd, // Starts at previous close
        levels: []
    };
}

// --- REPLAY STATE ---
let rawDataFrames: NSEFeed[] = [];
let playbackIndex = 0;

// --- DATA PARSER ---

const parseFeedToMarketState = (feed: NSEFeed, selectedInst: string): MarketState => {
    // 1. Discovery
    if (feed.feeds) {
        Object.keys(feed.feeds).forEach(k => {
            if (!INSTRUMENTS.includes(k)) INSTRUMENTS.push(k);
        });
    }

    const instData = feed.feeds ? feed.feeds[selectedInst] : undefined;
    
    // 2. Retrieve existing state
    let state = instrumentStates.get(selectedInst);

    // 3. Handle Missing Data 
    const marketFF = instData?.fullFeed?.marketFF;
    const ltpc = marketFF?.ltpc;

    if (!instData || !marketFF || !ltpc) {
        if (state) {
             return {
                currentPrice: state.currentPrice,
                book: state.lastBook,
                recentTrades: state.recentTrades,
                footprintBars: [...state.footprintBars, state.currentBar].slice(-30), // Increased history for Profile calc
                activeIcebergs: state.activeIcebergs,
                activeSignals: [...state.activeSignals], 
                signalHistory: [...state.signalHistory], 
                auctionProfile: state.auctionProfile,
                selectedInstrument: selectedInst,
                availableInstruments: INSTRUMENTS,
                globalCVD: state.globalCVD,
                swingHigh: state.swingHigh,
                swingLow: state.swingLow,
                marketTrend: state.marketTrend
            };
        }
        return getEmptyState(selectedInst);
    }
    
    const ltp = ltpc.ltp;
    
    if (!state) {
        ensureInstrumentState(selectedInst, ltp);
        state = instrumentStates.get(selectedInst)!;
    }

    // 4. Update Price
    state.currentPrice = ltp;

    // 5. Process Book 
    const quotes = marketFF.marketLevel?.bidAskQuote;
    const book = parseBook(quotes, ltp);
    state.lastBook = book;

    // 6. Process Trades & CVD
    const currentVol = parseInt(marketFF.vtt || "0");
    if (state.lastVol > 0 && currentVol > state.lastVol) {
        const delta = currentVol - state.lastVol;
        if (delta < 100000) {
            const side = ltp >= state.currentBar.close ? OrderSide.ASK : OrderSide.BID; 
            const trade: Trade = {
                id: `trd-${Date.now()}-${Math.random()}`,
                price: ltp,
                size: delta,
                side: side,
                timestamp: Date.now(),
                isIcebergExecution: Math.random() < 0.1 
            };
            
            // INTENT: Ticks define intent. We update CVD here.
            if (side === OrderSide.ASK) state.globalCVD += delta;
            else state.globalCVD -= delta;

            state.recentTrades = [trade, ...state.recentTrades].slice(0, 50);
            updateFootprintBar(state, trade);
            
            if (trade.isIcebergExecution) {
                updateIcebergLifecycle(state, trade);
            }
        }
    }
    state.lastVol = currentVol;

    // 7. Heatmap Intensity
    book.forEach(level => {
        const fpLevel = state!.currentBar.levels.find(l => Math.abs(l.price - level.price) < 0.001);
        const totalDepth = level.totalBidSize + level.totalAskSize;
        if (fpLevel) {
            fpLevel.depthIntensity = Math.min(totalDepth / 5000, 1);
        } else if (Math.abs(level.price - ltp) < (state!.tickSize * 20)) {
            state!.currentBar.levels.push({
                price: level.price,
                bidVol: 0,
                askVol: 0,
                delta: 0,
                imbalance: false,
                depthIntensity: Math.min(totalDepth / 5000, 1)
            });
        }
    });
    state.currentBar.levels.sort((a,b) => b.price - a.price);

    // 8. Market Structure & Auction Profile
    updateMarketStructure(state);
    state.auctionProfile = calculateAuctionProfile(state.footprintBars, state.currentBar);

    // 9. GENERATE & TRACK TRADE SIGNALS (Structure + Intent)
    generateTradeSignals(state);
    trackSignalPerformance(state);

    return {
        currentPrice: ltp,
        book,
        recentTrades: state.recentTrades,
        footprintBars: [...state.footprintBars, state.currentBar].slice(-30),
        activeIcebergs: state.activeIcebergs,
        activeSignals: [...state.activeSignals],
        signalHistory: [...state.signalHistory],
        auctionProfile: state.auctionProfile,
        selectedInstrument: selectedInst,
        availableInstruments: INSTRUMENTS,
        globalCVD: state.globalCVD,
        swingHigh: state.swingHigh,
        swingLow: state.swingLow,
        marketTrend: state.marketTrend
    };
};

// --- MARKET STRUCTURE LOGIC ---
const updateMarketStructure = (state: InstrumentState) => {
    // 1. Identify Rolling Swing Highs/Lows 
    // Increased lookback to 25 bars to find more significant levels
    const lookback = 25;
    const bars = state.footprintBars.slice(-lookback);
    
    if (bars.length < 5) return;

    const maxHigh = Math.max(...bars.map(b => b.high));
    const minLow = Math.min(...bars.map(b => b.low));

    // Update if meaningful change or first run
    if (Math.abs(maxHigh - state.swingHigh) > 0.1 || state.swingHigh === 0) state.swingHigh = maxHigh;
    if (Math.abs(minLow - state.swingLow) > 0.1 || state.swingLow === 0) state.swingLow = minLow;

    // Trend Definition
    const lastBar = bars[bars.length-1];
    const prevBar = bars[0]; // oldest in lookback
    
    const priceTrend = state.currentPrice > state.swingHigh ? 'BULLISH' : state.currentPrice < state.swingLow ? 'BEARISH' : 'NEUTRAL';
    const cvdTrend = lastBar.cvd > prevBar.cvd ? 'BULLISH' : 'BEARISH';

    // Strong Trend requires Price AND CVD agreement
    if (priceTrend === 'BULLISH' && cvdTrend === 'BULLISH') state.marketTrend = 'BULLISH';
    else if (priceTrend === 'BEARISH' && cvdTrend === 'BEARISH') state.marketTrend = 'BEARISH';
    else state.marketTrend = 'NEUTRAL';
};

// --- AUCTION MARKET PROFILE CALCULATION ---
const calculateAuctionProfile = (history: FootprintBar[], current: FootprintBar): AuctionProfile => {
    const allBars = [...history, current];
    const volumeMap = new Map<string, number>();
    let totalVolume = 0;

    // 1. Aggregate Volume per Price Level
    allBars.forEach(bar => {
        bar.levels.forEach(lvl => {
            const key = lvl.price.toFixed(2);
            const vol = lvl.bidVol + lvl.askVol;
            const currentVol = volumeMap.get(key) || 0;
            volumeMap.set(key, currentVol + vol);
            totalVolume += vol;
        });
    });

    if (totalVolume === 0) return { poc: 0, vah: 0, val: 0 };

    // 2. Sort Levels by Price
    const sortedLevels = Array.from(volumeMap.entries())
        .map(([priceStr, vol]) => ({ price: parseFloat(priceStr), vol }))
        .sort((a, b) => b.price - a.price); // Descending Price

    if (sortedLevels.length === 0) return { poc: 0, vah: 0, val: 0 };

    // 3. Find PoC (Max Volume)
    let pocPrice = 0;
    let maxVol = -1;
    let pocIndex = -1;

    sortedLevels.forEach((l, idx) => {
        if (l.vol > maxVol) {
            maxVol = l.vol;
            pocPrice = l.price;
            pocIndex = idx;
        }
    });

    // 4. Calculate Value Area (70% of Vol)
    const targetVol = totalVolume * 0.70;
    let currentVA_Vol = maxVol;
    let upIdx = pocIndex - 1; 
    let downIdx = pocIndex + 1; 

    while (currentVA_Vol < targetVol) {
        const upVol = (upIdx >= 0) ? sortedLevels[upIdx].vol : 0;
        const downVol = (downIdx < sortedLevels.length) ? sortedLevels[downIdx].vol : 0;

        if (upVol === 0 && downVol === 0) break;

        if (upVol >= downVol) {
            currentVA_Vol += upVol;
            upIdx--;
        } else {
            currentVA_Vol += downVol;
            downIdx++;
        }
    }

    const highIdx = upIdx + 1;
    const lowIdx = downIdx - 1;

    return {
        poc: pocPrice,
        vah: sortedLevels[highIdx]?.price || pocPrice,
        val: sortedLevels[lowIdx]?.price || pocPrice
    };
};


function parseBook(quotes: BidAskQuote[], currentPrice: number): PriceLevel[] {
    if (!quotes || !Array.isArray(quotes)) return [];
    
    const rawEntries = quotes.flatMap(q => {
        const bidP = Number(q.bidP);
        const askP = Number(q.askP);
        const bidQ = parseInt(q.bidQ);
        const askQ = parseInt(q.askQ);

        return [
            {
                price: bidP,
                bids: [{ id: `b-${bidP}`, price: bidP, size: bidQ, priority: 1, icebergType: IcebergType.NONE, displayedSize: bidQ, totalSizeEstimated: bidQ }],
                asks: [],
                totalBidSize: bidQ,
                totalAskSize: 0,
                impliedIceberg: false
            },
            {
                price: askP,
                bids: [],
                asks: [{ id: `a-${askP}`, price: askP, size: askQ, priority: 1, icebergType: IcebergType.NONE, displayedSize: askQ, totalSizeEstimated: askQ }],
                totalBidSize: 0,
                totalAskSize: askQ,
                impliedIceberg: false
            }
        ];
    });

    const priceMap = new Map<string, PriceLevel>();
    rawEntries.forEach(entry => {
        const key = entry.price.toFixed(2);
        if (!priceMap.has(key)) {
            priceMap.set(key, entry);
        } else {
            const existing = priceMap.get(key)!;
            existing.bids = [...existing.bids, ...entry.bids];
            existing.asks = [...existing.asks, ...entry.asks];
            existing.totalBidSize += entry.totalBidSize;
            existing.totalAskSize += entry.totalAskSize;
        }
    });

    return Array.from(priceMap.values()).sort((a,b) => b.price - a.price);
};

// --- TRADE MANAGEMENT LOGIC ---
const calculateTradeParameters = (side: 'BULLISH' | 'BEARISH', entryPrice: number, state: InstrumentState) => {
    let stopLoss = 0;
    const minRiskTicks = 8 * state.tickSize;
    const maxRiskTicks = 25 * state.tickSize;

    if (side === 'BULLISH') {
        if (state.swingLow > 0 && state.swingLow < entryPrice) {
            stopLoss = state.swingLow - (state.tickSize * 2);
        } else {
            stopLoss = entryPrice - (state.tickSize * 15);
        }
        if (entryPrice - stopLoss > maxRiskTicks) stopLoss = entryPrice - maxRiskTicks;
        if (entryPrice - stopLoss < minRiskTicks) stopLoss = entryPrice - minRiskTicks;
    } else {
        if (state.swingHigh > 0 && state.swingHigh > entryPrice) {
            stopLoss = state.swingHigh + (state.tickSize * 2);
        } else {
            stopLoss = entryPrice + (state.tickSize * 15);
        }
        if (stopLoss - entryPrice > maxRiskTicks) stopLoss = entryPrice + maxRiskTicks;
        if (stopLoss - entryPrice < minRiskTicks) stopLoss = entryPrice + minRiskTicks;
    }

    const risk = Math.abs(entryPrice - stopLoss);
    const reward = risk * 2; 
    let takeProfit = side === 'BULLISH' ? entryPrice + reward : entryPrice - reward;

    return { stopLoss, takeProfit, risk };
};

// --- SIGNAL LOGIC ---

const generateTradeSignals = (state: InstrumentState) => {
    const { currentPrice, activeIcebergs, footprintBars, auctionProfile, marketTrend, swingHigh, swingLow } = state;
    const currentBar = footprintBars[footprintBars.length - 1]; 
    if (!currentBar) return;

    // 1. FILTER: Ignore Low Volume "Chop"
    // Calc avg volume of last 10 bars
    const recentBars = footprintBars.slice(-10);
    const avgVol = recentBars.reduce((sum, b) => sum + b.volume, 0) / recentBars.length;
    if (currentBar.volume < avgVol * 0.3) return; // Too quiet

    // 2. HELPER: Proximity to Key Levels (The "Location" Filter)
    const isNearKeyLevel = (price: number): { type: string, name: string } | null => {
        const threshold = state.tickSize * 5; // 5 ticks tolerance
        if (Math.abs(price - swingHigh) < threshold) return { type: 'STRUCTURE', name: 'Swing High' };
        if (Math.abs(price - swingLow) < threshold) return { type: 'STRUCTURE', name: 'Swing Low' };
        if (auctionProfile) {
            if (Math.abs(price - auctionProfile.vah) < threshold) return { type: 'PROFILE', name: 'VAH' };
            if (Math.abs(price - auctionProfile.val) < threshold) return { type: 'PROFILE', name: 'VAL' };
        }
        return null;
    };

    const location = isNearKeyLevel(currentPrice);

    // COOLDOWN: 45s to avoid duplicate signals on same level
    const canEmit = (type: string) => {
        const lastSig = state.activeSignals.find(s => s.type === type && s.status === 'OPEN');
        if (lastSig) return false;
        const lastHist = state.signalHistory.find(s => s.type === type && Date.now() - s.timestamp < 45000); 
        return !lastHist;
    };

    const emitSignal = (type: any, side: 'BULLISH' | 'BEARISH', msg: string) => {
        const params = calculateTradeParameters(side, currentPrice, state);
        state.activeSignals.push({
            id: `sig-${Date.now()}`,
            timestamp: Date.now(),
            type: type,
            side: side,
            price: currentPrice,
            message: msg,
            status: 'OPEN',
            pnlTicks: 0,
            entryTime: Date.now(),
            stopLoss: params.stopLoss,
            takeProfit: params.takeProfit,
            riskRewardRatio: 2.0 
        });
    }

    // --- STRATEGY 1: HIGH QUALITY BREAKOUTS (Trend Following) ---
    // Requires: 1. Price breaking Swing High/Low. 2. Delta confirming the break (INTENT).
    
    if (marketTrend === 'BULLISH' && currentPrice >= swingHigh) {
        // FILTER: Intent check. Must have positive delta to confirm break.
        if (currentBar.delta > 50 && canEmit('STRUCTURE_BREAK_BULL')) {
             emitSignal('STRUCTURE_BREAK_BULL', 'BULLISH', 'BoS: Swing High + Strong Buy Delta');
        }
    }

    if (marketTrend === 'BEARISH' && currentPrice <= swingLow) {
        // FILTER: Intent check. Must have negative delta.
        if (currentBar.delta < -50 && canEmit('STRUCTURE_BREAK_BEAR')) {
             emitSignal('STRUCTURE_BREAK_BEAR', 'BEARISH', 'BoS: Swing Low + Strong Sell Delta');
        }
    }

    // --- STRATEGY 2: HIGH QUALITY REVERSALS (Location + Divergence) ---
    // Requires: 1. Price at Key Level. 2. CVD Divergence / Absorption.
    // We do NOT take random CVD divergence signals in the middle of the range.

    if (footprintBars.length >= 5 && location) {
        const prevBar = footprintBars[footprintBars.length - 2];
        
        // Bullish Reversal at Support
        // Logic: Price making new low, but CVD making higher low (Absorption)
        if (currentBar.low < prevBar.low && currentBar.cvd > prevBar.cvd) {
             if (canEmit('CVD_DIVERGENCE') && marketTrend !== 'BEARISH') {
                // strict check: Only take if near Lows or VAL
                if (location.name === 'Swing Low' || location.name === 'VAL') {
                    emitSignal('CVD_DIVERGENCE', 'BULLISH', `Absorption at ${location.name}`);
                }
             }
        }

        // Bearish Reversal at Resistance
        // Logic: Price making new high, but CVD making lower high (Exhaustion)
        if (currentBar.high > prevBar.high && currentBar.cvd < prevBar.cvd) {
            if (canEmit('CVD_DIVERGENCE') && marketTrend !== 'BULLISH') {
                // strict check: Only take if near Highs or VAH
                if (location.name === 'Swing High' || location.name === 'VAH') {
                    emitSignal('CVD_DIVERGENCE', 'BEARISH', `Exhaustion at ${location.name}`);
                }
            }
       }
    }

    // --- STRATEGY 3: ICEBERG DEFENSE (Micro-Structure) ---
    // Icebergs act as concrete walls.
    const relevantIceberg = activeIcebergs.find(i => 
        i.status === 'ACTIVE' && Math.abs(currentPrice - i.price) <= (state.tickSize * 3)
    );
    if (relevantIceberg && canEmit('ICEBERG_DEFENSE')) {
        // If we hit a BID iceberg, it's support (Bullish). If ASK iceberg, resistance (Bearish).
        const side = relevantIceberg.side === OrderSide.BID ? 'BULLISH' : 'BEARISH';
        // Only take if it aligns somewhat with structure or mean reversion
        emitSignal('ICEBERG_DEFENSE', side, `Iceberg Defense`);
    }
};

const trackSignalPerformance = (state: InstrumentState) => {
    // Fallback timeout only for stale cleanup (e.g. 2 hours)
    const TIMEOUT_MS = 1000 * 60 * 60 * 2; 

    state.activeSignals.forEach(sig => {
        if (sig.status !== 'OPEN') return;

        // Current PnL
        const diff = state.currentPrice - sig.price;
        const ticks = diff / (state.tickSize || 0.05);
        sig.pnlTicks = sig.side === 'BULLISH' ? ticks : -ticks;

        // --- INTRADAY EXIT LOGIC ---
        if (sig.side === 'BULLISH' && state.currentPrice >= sig.takeProfit) sig.status = 'WIN';
        if (sig.side === 'BEARISH' && state.currentPrice <= sig.takeProfit) sig.status = 'WIN';

        if (sig.side === 'BULLISH' && state.currentPrice <= sig.stopLoss) sig.status = 'LOSS';
        if (sig.side === 'BEARISH' && state.currentPrice >= sig.stopLoss) sig.status = 'LOSS';

        const isExpired = Date.now() - sig.entryTime > TIMEOUT_MS;
        if (isExpired) {
            sig.status = sig.pnlTicks > 0 ? 'WIN' : 'LOSS';
            sig.message += " (Timed Out)";
        }

        if (sig.status !== 'OPEN') {
            state.signalHistory.unshift({...sig}); 
            if (state.signalHistory.length > 50) state.signalHistory.pop();
        }
    });

    state.activeSignals = state.activeSignals.filter(s => s.status === 'OPEN');
};


// --- SIMULATION HELPERS ---

const updateIcebergLifecycle = (state: InstrumentState, trade: Trade) => {
    let iceberg = state.activeIcebergs.find(i => Math.abs(i.price - trade.price) < 0.001 && i.side !== trade.side && i.status === 'ACTIVE');
    if (iceberg) {
        iceberg.totalFilled += trade.size;
        iceberg.lastUpdate = Date.now();
    } else {
        const icebergSide = trade.side === OrderSide.ASK ? OrderSide.BID : OrderSide.ASK;
        iceberg = {
            id: `ice-${Math.random()}`,
            price: trade.price,
            side: icebergSide,
            detectedAt: Date.now(),
            lastUpdate: Date.now(),
            totalFilled: trade.size,
            status: 'ACTIVE'
        };
        state.activeIcebergs.push(iceberg);
    }
    state.activeIcebergs = state.activeIcebergs.filter(i => Date.now() - i.lastUpdate < 30000); 
};

const updateFootprintBar = (state: InstrumentState, trade: Trade) => {
  if (Date.now() - state.currentBar.timestamp > 5000) { 
    state.footprintBars = [...state.footprintBars, state.currentBar].slice(-30); // keep more history for profile
    state.currentBar = createNewBar(trade.price, Date.now(), state.globalCVD);
  }

  const bar = state.currentBar;
  bar.high = Math.max(bar.high, trade.price);
  bar.low = Math.min(bar.low, trade.price);
  bar.close = trade.price;
  bar.volume += trade.size;
  
  // Update CVD for this bar
  bar.cvd = state.globalCVD;

  const deltaChange = trade.side === OrderSide.ASK ? trade.size : -trade.size;
  bar.delta += deltaChange;

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
  
  const ratio = trade.side === OrderSide.ASK 
    ? (level.bidVol > 0 ? level.askVol / level.bidVol : 10) 
    : (level.askVol > 0 ? level.bidVol / level.askVol : 10);
  
  level.imbalance = (level.askVol + level.bidVol > 10) && ratio > 3;
};

const getEmptyState = (inst: string): MarketState => ({
    currentPrice: 0,
    book: [],
    recentTrades: [],
    footprintBars: [],
    activeIcebergs: [],
    activeSignals: [],
    signalHistory: [],
    selectedInstrument: inst,
    availableInstruments: INSTRUMENTS,
    globalCVD: 0,
    swingHigh: 0,
    swingLow: 0,
    marketTrend: 'NEUTRAL'
});

// --- GENERATE FEED BASED ON SNAPSHOT + SIMULATED UPDATES ---
const generateLiveFeedFromSnapshot = (): NSEFeed => {
    // We deep clone the snapshot so we can mutate it for simulation
    const feed = JSON.parse(JSON.stringify(REAL_DATA_SNAPSHOT));
    
    // Iterate instruments and apply small random changes to simulate "Live Feed"
    INSTRUMENTS.forEach(inst => {
        // Safe check for valid instrument structure in snapshot
        if (!feed.feeds[inst] || !feed.feeds[inst].fullFeed || !feed.feeds[inst].fullFeed.marketFF) return;

        const marketFF = feed.feeds[inst].fullFeed.marketFF;
        let ltp = marketFF.ltpc.ltp;
        
        // Increased volatility to ensure PnL movement is visible
        if (Math.random() > 0.6) { // 40% chance to move
            const move = Math.random() > 0.5 ? 0.05 : -0.05;
            ltp += move;
            ltp = Math.round(ltp * 20) / 20;
            marketFF.ltpc.ltp = ltp;
        }

        // 30% chance to execute trade (increase Volume)
        if (Math.random() > 0.7) {
            const vol = parseInt(marketFF.vtt || "0");
            const newVol = Math.floor(Math.random() * 50) + 1;
            marketFF.vtt = (vol + newVol).toString();
        }

        // Jiggle the Quotes (Preserve Depth)
        if (marketFF.marketLevel && marketFF.marketLevel.bidAskQuote) {
            marketFF.marketLevel.bidAskQuote.forEach((q: any, i: number) => {
                 const spread = 0.05;
                 q.bidP = parseFloat((ltp - (spread * (i + 1))).toFixed(2));
                 q.askP = parseFloat((ltp + (spread * (i + 1))).toFixed(2));
                 
                 q.bidQ = (parseInt(q.bidQ) + Math.floor(Math.random() * 10 - 5)).toString();
                 q.askQ = (parseInt(q.askQ) + Math.floor(Math.random() * 10 - 5)).toString();
                 if (parseInt(q.bidQ) < 0) q.bidQ = "1";
                 if (parseInt(q.askQ) < 0) q.askQ = "1";
            });
        }
    });

    feed.currentTs = Date.now().toString();
    return feed;
};

// --- SUBSCRIPTION & TIMING LOOP ---

let currentInstrument = "NSE_EQ|INE118H01025"; // Default from data
let activeCallback: ((data: MarketState) => void) | null = null;
let simulationTimer: any = null;
let currentSpeedDelay = 200; // Default 200ms = 1x

const simulationLoop = () => {
    if (!activeCallback) return;

    let rawFeed: NSEFeed;

    if (rawDataFrames.length > 0) {
        // --- REPLAY MODE ---
        if (playbackIndex >= rawDataFrames.length) {
            playbackIndex = 0; // Loop or stop
        }
        rawFeed = rawDataFrames[playbackIndex];
        playbackIndex++;
    } else {
        // --- SIMULATION MODE ---
        rawFeed = generateLiveFeedFromSnapshot();
    }
    
    // 2. Parse
    const appState = parseFeedToMarketState(rawFeed, currentInstrument);
    
    // 3. Emit
    activeCallback(appState);

    // 4. Schedule next
    simulationTimer = setTimeout(simulationLoop, currentSpeedDelay);
}

export const setInstrument = (inst: string) => {
    // If we have custom instruments (from file), allow selection even if not in original snapshot
    currentInstrument = inst;
};

// New Function to handle data injection
export const uploadFeedData = (frames: NSEFeed[]) => {
    if (!frames || frames.length === 0) return;
    
    console.log("Feed Data Loaded:", frames.length, "frames");
    rawDataFrames = frames;
    playbackIndex = 0;
    
    // Reset instruments list based on the new data
    // We try to find the first valid frame with keys to populate the list initially
    for(const frame of frames) {
        if(frame.feeds) {
            INSTRUMENTS = Object.keys(frame.feeds);
            if (INSTRUMENTS.length > 0) {
                currentInstrument = INSTRUMENTS[0];
                break;
            }
        }
    }

    // Reset internal state for clean slate
    instrumentStates.clear();
};

export const setSimulationSpeed = (multiplier: number) => {
    // multiplier: 0.5 = slow, 1 = normal, 2 = fast
    if (multiplier <= 0) return;
    currentSpeedDelay = 200 / multiplier;
};

export const subscribeToMarketData = (callback: (data: MarketState) => void) => {
  activeCallback = callback;
  
  if (simulationTimer) clearTimeout(simulationTimer);
  simulationTimer = setTimeout(simulationLoop, currentSpeedDelay);

  return () => {
      activeCallback = null;
      clearTimeout(simulationTimer);
      simulationTimer = null;
  };
};

export const injectIceberg = (side: OrderSide) => {
    const state = instrumentStates.get(currentInstrument);
    if (state) {
        state.activeIcebergs.push({
            id: `ice-manual-${Date.now()}`,
            price: state.currentPrice,
            side,
            detectedAt: Date.now(),
            lastUpdate: Date.now(),
            totalFilled: 0,
            status: 'ACTIVE'
        });
    }
};