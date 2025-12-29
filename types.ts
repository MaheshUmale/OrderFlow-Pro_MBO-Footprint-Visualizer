// Data types representing the "WebSocket Feed" structure

export enum OrderSide {
  BID = 'BID',
  ASK = 'ASK'
}

export enum IcebergType {
  NONE = 'NONE',
  NATIVE = 'NATIVE', // Standard exchange iceberg
  AGGRESSIVE = 'AGGRESSIVE', // Reloading rapidly at best price
  TRAPPED = 'TRAPPED', // Price moved past it but it's still significant
}

// --- NEW: External JSON Feed Structures ---
export interface NSEFeed {
  type: string;
  feeds: { [instrumentId: string]: InstrumentFeed };
  currentTs?: string;
}

export interface InstrumentFeed {
  fullFeed?: {
    marketFF: MarketFF;
  };
  optionChain?: {
    optionChain: OptionChainData;
  };
  requestMode?: string;
}

export interface MarketFF {
  ltpc: {
    ltp: number; // Last Traded Price
    ltt: string; // Time
    ltq: string; // Last Traded Qty
    cp: number;  // Close Price
  };
  marketLevel: {
    bidAskQuote: BidAskQuote[];
  };
  marketOHLC: {
    ohlc: OHLCData[];
  };
  atp?: number; // Avg Traded Price (VWAP)
  vtt?: string; // Volume Total Traded
  oi?: string;  // Open Interest (String from feed, needs parsing)
  tbq?: number;
  tsq?: number;
}

export interface BidAskQuote {
  bidQ: string;
  bidP: number;
  askQ: string;
  askP: number;
}

export interface OHLCData {
  interval: string;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: string;
  ts: string;
}

export interface OptionChainData {
    ltpc: { ltp: number };
    optionGreeks: {
        delta: number;
        theta: number;
        gamma: number;
        vega: number;
        iv: number;
    };
}

// --- UPSTOX API TYPES ---
export interface UpstoxContract {
  instrument_key: string;
  trading_symbol: string;
  expiry: string; // "2024-02-15"
  strike_price: number;
  instrument_type: "CE" | "PE";
  lot_size: number;
  underlying_key: string;
}

export interface Order {
  id: string;
  price: number;
  size: number;
  priority: number; // Queue position
  icebergType: IcebergType;
  displayedSize: number; // What shows on standard DOM
  totalSizeEstimated: number; // For iceberg detection logic
}

export interface PriceLevel {
  price: number;
  bids: Order[];
  asks: Order[];
  totalBidSize: number;
  totalAskSize: number;
  impliedIceberg: boolean; // Visual flag for summary
}

export interface Trade {
  id: string;
  price: number;
  size: number;
  side: OrderSide; // Side that initiated (aggressor)
  timestamp: number;
  isIcebergExecution: boolean;
}

export interface ActiveIceberg {
  id: string;
  price: number;
  side: OrderSide;
  detectedAt: number;
  lastUpdate: number;
  totalFilled: number;
  status: 'ACTIVE' | 'FINISHED';
}

export interface FootprintLevel {
  price: number;
  bidVol: number; // Volume traded on Bid side (Seller aggressed)
  askVol: number; // Volume traded on Ask side (Buyer aggressed)
  delta: number; // askVol - bidVol
  imbalance: boolean; // Significant difference
  depthIntensity: number; // 0 to 1 normalized volume relative to view
}

export interface FootprintBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;
  cvd: number; // Cumulative Volume Delta at close of bar
  levels: FootprintLevel[];
  // NEW: Snapshot of liquidity for heatmap overlay
  depthSnapshot?: { [priceStr: string]: number }; 
}

export interface AuctionProfile {
  vah: number; // Value Area High (70% vol top)
  val: number; // Value Area Low (70% vol bottom)
  poc: number; // Point of Control (Max Vol)
}

export interface TradeSignal {
  id: string;
  timestamp: number;
  type: 'ICEBERG_DEFENSE' | 'ABSORPTION' | 'MOMENTUM_BREAKOUT' | 'LIQUIDITY_SKEW' | 'VAL_REJECTION' | 'VAH_REJECTION' | 'CVD_DIVERGENCE' | 'STRUCTURE_BREAK_BULL' | 'STRUCTURE_BREAK_BEAR' | 'CONTEXT_ALIGNMENT_LONG' | 'CONTEXT_ALIGNMENT_SHORT';
  side: 'BULLISH' | 'BEARISH';
  price: number; // Entry price
  message: string;
  status: 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED';
  pnlTicks: number; 
  entryTime: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
}

// Simulating the state of the "Market"
export interface InstrumentState {
  currentPrice: number;
  book: PriceLevel[];
  recentTrades: Trade[];
  footprintBars: FootprintBar[];
  auctionProfile?: AuctionProfile;
  activeIcebergs: ActiveIceberg[]; 
  activeSignals: TradeSignal[];
  signalHistory: TradeSignal[];
  globalCVD: number; // Persistent CVD counter
  tickSize: number;
  
  // Market Structure Logic
  swingHigh: number;
  swingLow: number;
  sessionHigh: number; // New: Session Stats
  sessionLow: number;  // New: Session Stats
  cumulativeVolume: number; // New: For VWAP
  cumulativePV: number; // New: For VWAP (Price * Volume)
  vwap: number;

  marketTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  
  // Phase Two Fields - OI TRACKING
  openInterest: number;     // Current absolute OI
  openInterestChange: number; // Change since session start
  openInterestDelta: number;  // Change in the last bar/tick
  
  lastVol: number;
  currentBar: FootprintBar;
  lastBook: PriceLevel[];

  // Internal Logic State
  icebergTracker: { [price: string]: { vol: number, startTime: number } };
}

// The Global App State sent to UI
export interface MarketState {
    currentPrice: number;
    book: PriceLevel[];
    recentTrades: Trade[];
    footprintBars: FootprintBar[];
    auctionProfile?: AuctionProfile;
    activeIcebergs: ActiveIceberg[]; 
    activeSignals: TradeSignal[];
    signalHistory: TradeSignal[];
    selectedInstrument: string;
    availableInstruments: string[];
    instrumentNames: { [key: string]: string };
    globalCVD: number;
    swingHigh: number;
    swingLow: number;
    marketTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    openInterest: number;
    openInterestChange: number;
    vwap: number;
    connectionStatus?: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';
}