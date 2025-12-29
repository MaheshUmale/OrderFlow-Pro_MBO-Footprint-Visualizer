
import { MarketState, InstrumentState, UpstoxContract, PriceLevel, FootprintBar, Trade } from '../../types';

// --- INITIAL STATE & CONFIG ---
const DEFAULT_INSTRUMENTS = [
    { key: "NSE_FO|49543", name: "NIFTY FUT 30 DEC 25", underlying: "NSE_INDEX|Nifty 50" },
    { key: "NSE_FO|49508", name: "BANKNIFTY FUT 30 DEC 25", underlying: "NSE_INDEX|Nifty Bank" }
];

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
    levels: [],
    depthSnapshot: {}
  },
  lastBook: []
});


// --- IN-MEMORY STATE ---
let state = {
    connectionStatus: 'DISCONNECTED' as MarketState['connectionStatus'],
    simulationSpeed: 1,
    isLiveMode: false,
    userToken: "",
    underlyingInstrumentId: "",
    lastCalculatedAtm: 0,
    cachedOptionContracts: [] as UpstoxContract[],
    instrumentStates: Object.fromEntries(DEFAULT_INSTRUMENTS.map(inst => [inst.key, createInitialState(24000)])) as { [id: string]: InstrumentState },
    subscribers: [] as ((data: MarketState) => void)[],
    onStatusUpdate: null as ((status: string) => void) | null,
    currentInstrumentId: DEFAULT_INSTRUMENTS[0].key,
    instrumentsCache: DEFAULT_INSTRUMENTS.map(i => i.key),
    instrumentNames: Object.fromEntries(DEFAULT_INSTRUMENTS.map(i => [i.key, i.name])),
    lastSentSubscribeKeys: [] as string[],
};

// --- STATE GETTERS & MUTATORS ---
export const getState = () => Object.freeze({ ...state });

const setState = (newState: Partial<typeof state>) => {
    state = { ...state, ...newState };
};


// --- SUBSCRIBER & BROADCAST ---
export const subscribe = (callback: (data: MarketState) => void): (() => void) => {
    const currentSubs = getState().subscribers;
    setState({ subscribers: [...currentSubs, callback] });
    broadcast();

    return () => {
        const currentSubs = getState().subscribers;
        setState({ subscribers: currentSubs.filter(s => s !== callback) });
    };
};

export const broadcast = () => {
    const currentState = getState();
    let currentInstrumentState = currentState.instrumentStates[currentState.currentInstrumentId];

    if (!currentInstrumentState) {
        const firstKey = currentState.instrumentsCache[0];
        if (firstKey && currentState.instrumentStates[firstKey]) {
            setState({ currentInstrumentId: firstKey });
            currentInstrumentState = getState().instrumentStates[firstKey];
        } else {
            return;
        }
    }

    const marketState: MarketState = {
        ...currentInstrumentState,
        selectedInstrument: currentState.currentInstrumentId,
        availableInstruments: currentState.instrumentsCache,
        instrumentNames: currentState.instrumentNames,
        connectionStatus: currentState.connectionStatus,
    };

    currentState.subscribers.forEach(cb => cb(marketState));
};

export const getUnderlyingForInstrument = (instrumentKey: string): string => {
    const inst = DEFAULT_INSTRUMENTS.find(i => i.key === instrumentKey);
    return inst?.underlying || "";
};


// --- STATE MODIFICATION FUNCTIONS ---
export const setConnectionStatus = (status: MarketState['connectionStatus']) => {
    setState({ connectionStatus: status });
    broadcast();
};

export const setLiveMode = (isLive: boolean) => {
    setState({ isLiveMode: isLive });
};

export const setInstrument = (id: string) => {
    const currentState = getState();
    if (!currentState.instrumentStates[id]) {
        const knownPrice = Object.values(currentState.instrumentStates).find(s => s.currentPrice > 0)?.currentPrice || 1000;
        const newInstrumentState = createInitialState(knownPrice);
        setState({
            currentInstrumentId: id,
            instrumentStates: { ...currentState.instrumentStates, [id]: newInstrumentState },
        });
    } else {
        setState({ currentInstrumentId: id });
    }
    broadcast();
};

export const updateInstrumentState = (id: string, updates: Partial<InstrumentState>) => {
    const currentState = getState();
    const existingState = currentState.instrumentStates[id] || createInitialState(updates.currentPrice || 0);
    setState({
        instrumentStates: {
            ...currentState.instrumentStates,
            [id]: { ...existingState, ...updates },
        },
    });
};

export const addInstrument = (key: string, name: string) => {
    const currentState = getState();
    if (currentState.instrumentsCache.includes(key)) return;
    setState({
        instrumentsCache: [...currentState.instrumentsCache, key],
        instrumentNames: { ...currentState.instrumentNames, [key]: name },
    });
};

export const addInstruments = (contracts: { key: string, name: string }[]) => {
    const currentState = getState();
    const newCache = [...currentState.instrumentsCache];
    const newNames = { ...currentState.instrumentNames };
    let added = false;

    contracts.forEach(c => {
        if (!newCache.includes(c.key)) {
            newCache.push(c.key);
            newNames[c.key] = c.name;
            added = true;
        }
    });

    if (added) {
        setState({ instrumentsCache: newCache, instrumentNames: newNames });
    }
};

export const setOptionChain = (underlying: string, token: string, statusCallback: (s: string) => void) => {
    setState({
        underlyingInstrumentId: underlying,
        userToken: token,
        onStatusUpdate: statusCallback,
        cachedOptionContracts: [],
        lastCalculatedAtm: 0,
        lastSentSubscribeKeys: [],
    });
    addInstrument(underlying, "SPOT / INDEX");
};

export const setCachedOptionContracts = (contracts: UpstoxContract[]) => {
    setState({ cachedOptionContracts: contracts });
};

export const setLastCalculatedAtm = (atm: number) => {
    setState({ lastCalculatedAtm: atm });
};

export const setLastSentSubscribeKeys = (keys: string[]) => {
    setState({ lastSentSubscribeKeys: keys });
};

export const updateStatus = (message: string) => {
    if (state.onStatusUpdate) {
        state.onStatusUpdate(message);
    }
};
