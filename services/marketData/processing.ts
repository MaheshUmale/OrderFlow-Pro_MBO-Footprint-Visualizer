
import {
    OrderSide, PriceLevel, IcebergType, Trade, FootprintBar, ActiveIceberg,
    NSEFeed, InstrumentFeed, BidAskQuote, TradeSignal, InstrumentState, UpstoxContract
} from '../../types';
import * as state from './state';

// --- UTILITIES ---
const areKeysEqual = (k1: string, k2: string) => {
    if (!k1 || !k2) return false;
    if (k1 === k2) return true;
    try {
        return decodeURIComponent(k1) === decodeURIComponent(k2);
    } catch (e) {
        return false;
    }
};


// --- CORE PROCESSING LOGIC ---
const convertQuoteToBook = (quotes: BidAskQuote[]): PriceLevel[] => {
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

const snapshotDepthToBar = (bar: FootprintBar, book: PriceLevel[]): FootprintBar => {
    const newSnapshot = { ...(bar.depthSnapshot || {}) };

    book.forEach(level => {
        const total = level.totalBidSize + level.totalAskSize;
        if (total > 0) {
            newSnapshot[level.price.toFixed(2)] = total;
        }
    });

    return { ...bar, depthSnapshot: newSnapshot };
};

const updateFootprint = (
    instrumentState: InstrumentState,
    trade: Trade
): { newBar: FootprintBar, oldBars: FootprintBar[] } => {
    let currentBar = snapshotDepthToBar({ ...instrumentState.currentBar }, instrumentState.book);
    let footprintBars = [...instrumentState.footprintBars];

    if (currentBar.volume > 5000) { // Rotation condition
        footprintBars = [...footprintBars, currentBar].slice(-30);
        currentBar = snapshotDepthToBar({
            timestamp: Date.now(),
            open: trade.price, high: trade.price, low: trade.price, close: trade.price,
            volume: 0, delta: 0, cvd: instrumentState.globalCVD,
            levels: [], depthSnapshot: {}
        }, instrumentState.book);
    }

    const deltaChange = trade.side === OrderSide.ASK ? trade.size : -trade.size;

    let newLevels = [...currentBar.levels];
    let levelIndex = newLevels.findIndex(l => Math.abs(l.price - trade.price) < 0.001);
    let levelToUpdate;

    if (levelIndex === -1) {
        levelToUpdate = { price: trade.price, bidVol: 0, askVol: 0, delta: 0, imbalance: false, depthIntensity: 0 };
    } else {
        levelToUpdate = { ...newLevels[levelIndex] };
    }

    if (trade.side === OrderSide.ASK) levelToUpdate.askVol += trade.size;
    else levelToUpdate.bidVol += trade.size;
    levelToUpdate.delta = levelToUpdate.askVol - levelToUpdate.bidVol;

    if (levelToUpdate.askVol > levelToUpdate.bidVol * 3 || levelToUpdate.bidVol > levelToUpdate.askVol * 3) {
        levelToUpdate.imbalance = true;
    }

    const bookLevel = instrumentState.book.find(l => Math.abs(l.price - trade.price) < 0.001);
    if (bookLevel) {
        levelToUpdate.depthIntensity = Math.min((bookLevel.totalBidSize + bookLevel.totalAskSize) / 2000, 1);
    }

    if (levelIndex === -1) {
        newLevels.push(levelToUpdate);
        newLevels.sort((a, b) => b.price - a.price);
    } else {
        newLevels[levelIndex] = levelToUpdate;
    }

    const updatedBar: FootprintBar = {
        ...currentBar,
        high: Math.max(currentBar.high, trade.price),
        low: Math.min(currentBar.low, trade.price),
        close: trade.price,
        volume: currentBar.volume + trade.size,
        delta: currentBar.delta + deltaChange,
        cvd: instrumentState.globalCVD,
        levels: newLevels,
    };

    return { newBar: updatedBar, oldBars: footprintBars };
};


// --- FEED & MESSAGE HANDLERS ---
export const processFeedFrame = (frame: NSEFeed) => {
    if (!frame.feeds) return;

    const appState = state.getState();
    const frameInstruments = Object.keys(frame.feeds);

    frameInstruments.forEach(id => {
        const fullFeed = frame.feeds[id].fullFeed;
        if (!fullFeed?.marketFF?.ltpc) return;

        const feedData = fullFeed.marketFF;
        let instrumentState = appState.instrumentStates[id];

        // This can happen on first load or with new instruments
        if (!instrumentState) {
            state.addInstrument(id, id); // Add with key as name initially
            instrumentState = state.getState().instrumentStates[id];
        }

        const newPrice = feedData.ltpc.ltp;
        const prevPrice = instrumentState.currentPrice;

        let updates: Partial<InstrumentState> = { currentPrice: newPrice };

        // Handle Options Recalculation
        if (appState.cachedOptionContracts.length > 0 && areKeysEqual(id, appState.underlyingInstrumentId)) {
            recalculateOptionList(newPrice);
        } else if (appState.cachedOptionContracts.length > 0 && appState.lastCalculatedAtm === 0 && id === appState.currentInstrumentId) {
            recalculateOptionList(newPrice);
        }

        // Handle Book Update
        if (feedData.marketLevel?.bidAskQuote) {
             updates.book = convertQuoteToBook(feedData.marketLevel.bidAskQuote);
             updates.lastBook = updates.book;
        }

        // Handle Trade & Volume Update
        const currentTotalVol = parseInt(feedData.vtt || "0", 10);
        const volDiff = currentTotalVol - instrumentState.lastVol;

        if (volDiff > 0 && instrumentState.lastVol > 0) {
            const side = newPrice >= prevPrice ? OrderSide.ASK : OrderSide.BID;
            const newTrade: Trade = {
                id: Math.random().toString(36).substr(2, 9),
                price: newPrice,
                size: volDiff,
                side: side,
                timestamp: Date.now(),
                isIcebergExecution: false
            };

            updates.recentTrades = [newTrade, ...instrumentState.recentTrades].slice(0, 50);
            updates.lastVol = currentTotalVol;
            updates.globalCVD = instrumentState.globalCVD + (side === OrderSide.ASK ? volDiff : -volDiff);

            const { newBar, oldBars } = updateFootprint(instrumentState, newTrade);
            updates.currentBar = newBar;
            updates.footprintBars = oldBars;
        } else if (instrumentState.lastVol === 0) {
            updates.lastVol = currentTotalVol;
        }

        if (updates.book && updates.book.length > 0) {
            snapshotDepthToBar(updates.currentBar || instrumentState.currentBar, updates.book);
        }

        state.updateInstrumentState(id, updates);
    });

    state.broadcast();
};

export const handleQuoteResponse = (data: { [key: string]: { last_price: number } }) => {
    if (!data) return;
    const appState = state.getState();

    Object.keys(data).forEach(k => {
        const price = data[k].last_price;
        if (price) {
            state.updateInstrumentState(k, { currentPrice: price });
            if (areKeysEqual(k, appState.underlyingInstrumentId)) {
                recalculateOptionList(price);
            }
        }
    });
    state.broadcast();
};

export const handleOptionChainData = (contracts: UpstoxContract[]) => {
    state.updateStatus(`Received ${contracts?.length} contracts.`);
    if (!contracts || contracts.length === 0) {
        state.updateStatus("No contracts found.");
        alert("No contracts found in Upstox response.");
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const distinctExpiries = Array.from(new Set(contracts.map(c => c.expiry))).sort();
    const nearestExpiry = distinctExpiries.find(e => e >= today) || distinctExpiries[0];

    state.updateStatus(`Using Expiry: ${nearestExpiry}`);
    if (!nearestExpiry) {
        alert("No valid expiry date found.");
        return;
    }

    const filtered = contracts.filter(c => c.expiry === nearestExpiry);
    state.setCachedOptionContracts(filtered);

    // Initial population before price is known
    const fallbackContracts = filtered.sort((a,b) => a.strike_price - b.strike_price);
    const midPoint = Math.floor(fallbackContracts.length / 2);
    const slice = fallbackContracts.slice(Math.max(0, midPoint - 10), midPoint + 10);

    state.addInstruments(slice.map(c => ({
        key: c.instrument_key,
        name: c.trading_symbol || `${c.strike_price} ${c.instrument_type}`
    })));

    // Trigger full subscription for everything we know
    // triggerBackendSubscription(); // This will be in connection.ts

    state.broadcast();

    // Check if we can already calculate ATM
    const appState = state.getState();
    const spotState = appState.instrumentStates[appState.underlyingInstrumentId];

    if (spotState && spotState.currentPrice > 0) {
        recalculateOptionList(spotState.currentPrice);
    } else {
        const currentInstState = appState.instrumentStates[appState.currentInstrumentId];
        if (currentInstState && currentInstState.currentPrice > 0) {
            recalculateOptionList(currentInstState.currentPrice);
        } else {
            state.updateStatus("Waiting for price to find ATM...");
        }
    }
};

const recalculateOptionList = (spotPrice: number) => {
    const appState = state.getState();
    if (appState.cachedOptionContracts.length === 0) return;

    let minDiff = Infinity;
    let atmStrike = 0;
    appState.cachedOptionContracts.forEach(c => {
        const diff = Math.abs(c.strike_price - spotPrice);
        if (diff < minDiff) { minDiff = diff; atmStrike = c.strike_price; }
    });

    if (atmStrike === appState.lastCalculatedAtm) return;
    state.setLastCalculatedAtm(atmStrike);
    state.updateStatus(`ATM Identified: ${atmStrike}`);

    const distinctStrikes = Array.from(new Set(appState.cachedOptionContracts.map(c => c.strike_price))).sort((a,b) => a-b);
    const atmIndex = distinctStrikes.indexOf(atmStrike);
    if (atmIndex === -1) return;

    const startIndex = Math.max(0, atmIndex - 10);
    const endIndex = Math.min(distinctStrikes.length, atmIndex + 11);
    const relevantStrikes = distinctStrikes.slice(startIndex, endIndex);

    const relevantContracts = appState.cachedOptionContracts.filter(c => relevantStrikes.includes(c.strike_price));

    state.addInstruments(relevantContracts.map(c => ({
        key: c.instrument_key,
        name: c.trading_symbol || `${c.strike_price} ${c.instrument_type}`
    })));

    // triggerBackendSubscription(); // Belongs in connection.ts

    state.broadcast();
};
