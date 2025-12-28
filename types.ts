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
  currentTs: string;
}

export interface InstrumentFeed {
  fullFeed: {
    marketFF: MarketFF;
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
  atp?: number;
  vtt?: string; // Volume Total Traded
  oi?: number;
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

// --- Internal App Types ---

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
  
  // Depth snapshot at this level for the bar duration (avg or close)
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
}

export interface AuctionProfile {
  vah: number; // Value Area High (70% vol top)
  val: number; // Value Area Low (70% vol bottom)
  poc: number; // Point of Control (Max Vol)
}

export interface TradeSignal {
  id: string;
  timestamp: number;
  type: 'ICEBERG_DEFENSE' | 'ABSORPTION' | 'MOMENTUM_BREAKOUT' | 'LIQUIDITY_SKEW' | 'VAL_REJECTION' | 'VAH_REJECTION' | 'CVD_DIVERGENCE';
  side: 'BULLISH' | 'BEARISH';
  price: number; // Entry price
  message: string;
  status: 'OPEN' | 'WIN' | 'LOSS' | 'EXPIRED';
  pnlTicks: number; 
  entryTime: number;
}

// Simulating the state of the "Market"
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
}