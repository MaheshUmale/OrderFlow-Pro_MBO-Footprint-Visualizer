import React, { useRef, useEffect, useState, useMemo } from 'react';
import { FootprintBar, FootprintLevel, TradeSignal, AuctionProfile } from '../types';
import { BoxSelect, AlignJustify, Spline, Layers, ZoomIn, ZoomOut, RefreshCcw, Maximize, MoveHorizontal, MoveVertical, Minus, Plus, TrendingUp, TrendingDown, Activity, Target, ShieldX } from 'lucide-react';

interface FootprintChartProps {
  bars: FootprintBar[];
  activeSignals?: TradeSignal[];
  auctionProfile?: AuctionProfile;
  // Market Structure Props
  swingHigh?: number;
  swingLow?: number;
}

interface FootprintCandleProps {
  bar: FootprintBar;
  viewMode: 'cluster' | 'profile' | 'imbalance';
  width: number;
  priceRows: number[];
  rowHeight: number;
}

const TICK_SIZE = 0.05;

const FootprintCandle: React.FC<FootprintCandleProps> = ({ bar, viewMode, width, priceRows, rowHeight }) => {
  const isUp = bar.close >= bar.open;
  
  // Adaptive Rendering: Hide text if cells are too small
  const showText = width > 40 && rowHeight > 14;
  
  // Create a map for fast lookup of levels in this bar
  const levelMap = useMemo(() => {
      const map = new Map<string, FootprintLevel>();
      if (bar.levels && Array.isArray(bar.levels)) {
          bar.levels.forEach(l => {
              if (l && typeof l.price === 'number') {
                  // Key by fixed string to avoid float precision issues
                  map.set(l.price.toFixed(2), l);
              }
          });
      }
      return map;
  }, [bar]);

  return (
    <div 
      className="flex flex-col border-r border-gray-800/30 bg-[#050505] relative select-none"
      style={{ minWidth: `${width}px`, width: `${width}px` }}
    >
      {/* Header Info */}
      <div className={`h-[24px] text-[9px] text-center border-b border-gray-800 flex justify-between px-1 items-center font-mono ${bar.delta > 0 ? 'text-bid' : 'text-ask'} bg-[#0a0d13] overflow-hidden`}>
        {width > 30 && <span className="font-bold">Δ{bar.delta}</span>}
        {width > 50 && <span className="text-gray-500">{bar.volume}</span>}
      </div>

      {/* Grid Rows */}
      <div className="flex flex-col w-full relative">
        {priceRows.map((price) => {
            const levelKey = price.toFixed(2);
            const level = levelMap.get(levelKey);
            
            // Candle Body Logic
            const inBody = price <= Math.max(bar.open, bar.close) + 0.001 && price >= Math.min(bar.open, bar.close) - 0.001;
            const isWick = price <= bar.high + 0.001 && price >= bar.low - 0.001;

            // Data extraction (Safe Access)
            const bidVol = level ? (level.bidVol || 0) : 0;
            const askVol = level ? (level.askVol || 0) : 0;
            const delta = askVol - bidVol;
            const depthIntensity = level ? (level.depthIntensity || 0) : 0;
            
            // Imbalance Logic
            const isImbalanceBuy = askVol > bidVol * 3 && askVol > 10;
            const isImbalanceSell = bidVol > askVol * 3 && bidVol > 10;
            
            const isPotentialIceberg = (isImbalanceBuy && askVol > 30) || (isImbalanceSell && bidVol > 30);
            
            // Heatmap Background Color
            let bgStyle = {};
            if (depthIntensity > 0) {
               const i = depthIntensity;
               let color = '';
               // Blue -> Cyan -> Yellow -> White heatmap
               if (i < 0.3) color = `rgba(0, 0, 100, ${i + 0.1})`; 
               else if (i < 0.6) color = `rgba(0, 150, 150, ${i})`; 
               else if (i < 0.8) color = `rgba(200, 150, 0, ${i})`; 
               else color = `rgba(255, 255, 255, ${i})`; 
               bgStyle = { backgroundColor: color };
            }

            return (
                <div 
                    key={levelKey}
                    className="grid grid-cols-[1fr_20%_1fr] items-center relative border-b border-gray-800/20 overflow-hidden"
                    style={{ height: `${rowHeight}px` }}
                >
                     {/* Heatmap Layer */}
                     <div className="absolute inset-0 z-0 opacity-50" style={bgStyle}></div>

                     {/* Candle Body/Wick Layer */}
                     {isWick && (
                         <div className={`absolute left-1/2 -translate-x-1/2 w-[2px] h-full z-10 opacity-30 ${isUp ? 'bg-bid' : 'bg-ask'}`}></div>
                     )}
                     {inBody && (
                         <div className={`absolute inset-0 z-10 opacity-20 ${isUp ? 'bg-bid' : 'bg-ask'} border-x ${isUp ? 'border-bid/40' : 'border-ask/40'}`}></div>
                     )}

                     {/* Values (Only show if space permits) */}
                     {level && showText ? (
                        <>
                            <div className={`text-right pr-1 relative z-20 text-[10px] font-mono leading-none flex items-center justify-end gap-0.5 ${isImbalanceSell && viewMode === 'imbalance' ? 'text-white font-bold bg-ask/60' : 'text-gray-400'}`}>
                                {bidVol > 0 ? bidVol : ''}
                                {isPotentialIceberg && isImbalanceSell && viewMode === 'imbalance' && (
                                    <div title="Potential Sell Iceberg/Absorption" className="w-1.5 h-1.5 bg-iceberg rounded-full animate-pulse shadow-[0_0_5px_rgba(59,130,246,1)]"></div>
                                )}
                            </div>
                            
                            {/* Spacer */}
                            <div className="relative z-20"></div>

                            <div className={`text-left pl-1 relative z-20 text-[10px] font-mono leading-none flex items-center justify-start gap-0.5 ${isImbalanceBuy && viewMode === 'imbalance' ? 'text-white font-bold bg-bid/60' : 'text-gray-400'}`}>
                                {isPotentialIceberg && isImbalanceBuy && viewMode === 'imbalance' && (
                                    <div title="Potential Buy Iceberg/Absorption" className="w-1.5 h-1.5 bg-iceberg rounded-full animate-pulse shadow-[0_0_5px_rgba(59,130,246,1)]"></div>
                                )}
                                {askVol > 0 ? askVol : ''}
                            </div>

                             {/* Profile View Overlay */}
                            {viewMode === 'profile' && (
                                <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
                                    <div 
                                        className={`h-[2px] absolute bottom-0 ${delta > 0 ? 'bg-bid' : 'bg-ask'}`} 
                                        style={{width: `${Math.min(Math.abs(delta) * 5, 100)}%`, left: delta > 0 ? '50%' : 'auto', right: delta < 0 ? '50%' : 'auto'}}
                                    />
                                </div>
                            )}
                        </>
                     ) : (
                         // If text is hidden, maintain structure but empty
                         <>
                             <div></div>
                             <div></div>
                             <div></div>
                         </>
                     )}
                </div>
            )
        })}
      </div>
    </div>
  );
};

const CVDPane = ({ bars, width }: { bars: FootprintBar[], width: number }) => {
    // Basic scaling logic
    const minCVD = Math.min(...bars.map(b => b.cvd), 0);
    const maxCVD = Math.max(...bars.map(b => b.cvd), 1);
    const range = maxCVD - minCVD || 1;
    
    return (
        <div className="h-[80px] bg-[#0d1117] border-t border-trading-border relative flex flex-row">
            {/* Y Axis Label */}
            <div className="absolute left-1 top-1 text-[8px] text-gray-500 font-mono">CVD (Intent)</div>

            {/* Bars container matches chart structure */}
            <div className="flex h-full items-end pl-[60px]"> {/* 60px padding for left axis alignment */}
                {bars.map((bar, i) => {
                    const prevCvd = i > 0 ? bars[i-1].cvd : 0;
                    const h = ((bar.cvd - minCVD) / range) * 60; // 60px max height inside 80px container
                    const color = bar.cvd >= prevCvd ? '#22c55e' : '#ef4444';
                    
                    return (
                        <div key={bar.timestamp} style={{ minWidth: `${width}px`, width: `${width}px` }} className="h-full relative border-r border-gray-800/30 flex items-end justify-center pb-2">
                             <div 
                                style={{ height: `${Math.max(h, 2)}px`, backgroundColor: color }} 
                                className="w-2 rounded-sm opacity-80"
                             ></div>
                             {/* Delta Label */}
                             <div className="absolute bottom-0 text-[8px] text-gray-600 font-mono transform -rotate-90 origin-bottom-left translate-x-2 mb-2">
                                {bar.cvd.toFixed(0)}
                             </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

export const FootprintChart: React.FC<FootprintChartProps> = ({ bars, activeSignals = [], auctionProfile, swingHigh, swingLow }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const [viewMode, setViewMode] = useState<'cluster' | 'profile' | 'imbalance'>('cluster');
  
  // Independent Zoom States
  const [candleWidth, setCandleWidth] = useState(60); 
  const [rowHeight, setRowHeight] = useState(20); 

  // 1. Calculate Global Price Bounds for the Grid
  const { minPrice, maxPrice } = useMemo(() => {
    if (!bars || !bars.length) return { minPrice: 0, maxPrice: 100 };
    
    let min = Infinity;
    let max = -Infinity;

    bars.forEach(b => {
        if (!isNaN(b.low) && b.low > 0.01 && b.low < min) min = b.low;
        if (!isNaN(b.high) && b.high > 0.01 && b.high > max) max = b.high;
        
        if (b.levels) {
            b.levels.forEach(l => {
                if (l && !isNaN(l.price) && l.price > 0.01) {
                   if (l.price < min) min = l.price;
                   if (l.price > max) max = l.price;
                }
            });
        }
    });

    // Safety: If data is completely broken
    if (min === Infinity || max === -Infinity) return { minPrice: 0, maxPrice: 100 };
    if (min === max) { min -= 1; max += 1; } // Prevent 0 height

    // Add padding (2 ticks)
    min -= (TICK_SIZE * 2);
    max += (TICK_SIZE * 2);

    return { minPrice: min, maxPrice: max };
  }, [bars]);

  // 2. Generate Unified Price Grid
  const priceRows = useMemo(() => {
      const rows: number[] = [];
      // Safety check to prevent infinite loop
      if (!isFinite(maxPrice) || !isFinite(minPrice)) return [];
      
      const startTick = Math.ceil(maxPrice / TICK_SIZE);
      const endTick = Math.floor(minPrice / TICK_SIZE);
      
      // Limit total rows to prevent browser freeze (max 5000 rows)
      if (startTick - endTick > 5000) return []; 

      for (let t = startTick; t >= endTick; t--) {
          rows.push(t * TICK_SIZE);
      }
      return rows;
  }, [minPrice, maxPrice]);

  // Auto-scroll logic (only if user hasn't scrolled away significantly)
  useEffect(() => {
    if (scrollRef.current) {
        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        const isNearEnd = scrollWidth - scrollLeft - clientWidth < 200;
        if (isNearEnd) {
             scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
    }
  }, [bars.length]);

  // Initial center vertically
  useEffect(() => {
      if (scrollRef.current && priceRows.length > 0) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight / 2 - scrollRef.current.clientHeight / 2;
      }
  }, [priceRows.length]);


  const handleFitContent = () => {
      if (!scrollRef.current || !bars || bars.length === 0 || priceRows.length === 0) return;
      
      const { clientWidth, clientHeight } = scrollRef.current;
      const priceScaleWidth = 60; // Approximate width of left axis
      const availableWidth = clientWidth - priceScaleWidth;
      
      const newRowHeight = Math.max(clientHeight / priceRows.length, 2); 
      const newCandleWidth = Math.max(availableWidth / bars.length, 4);

      setRowHeight(newRowHeight);
      setCandleWidth(newCandleWidth);
  };

  const handleZoom = (axis: 'x' | 'y', delta: number) => {
      if (axis === 'x') {
          setCandleWidth(prev => Math.max(Math.min(prev + delta, 300), 4));
      } else {
          setRowHeight(prev => Math.max(Math.min(prev + delta, 100), 2));
      }
  };

  return (
    <div className="flex flex-col h-full bg-trading-panel border border-trading-border rounded-lg overflow-hidden shadow-2xl">
      {/* Toolbar */}
      <div className="p-2 border-b border-trading-border bg-[#0a0d13] flex justify-between items-center shrink-0 z-20 relative gap-2">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2 hidden md:flex">
          <Layers className="w-4 h-4 text-blue-400" /> 
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-green-400">Footprint</span>
        </h3>
        
        <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
            {/* View Modes */}
            <div className="flex bg-gray-900 rounded p-0.5 gap-0.5 border border-gray-800">
                <button onClick={() => setViewMode('cluster')} className={`px-2 py-1 text-[10px] rounded ${viewMode === 'cluster' ? 'bg-gray-700 text-white' : 'text-gray-500'}`} title="Cluster View"><BoxSelect size={12} /></button>
                <button onClick={() => setViewMode('imbalance')} className={`px-2 py-1 text-[10px] rounded ${viewMode === 'imbalance' ? 'bg-gray-700 text-white' : 'text-gray-500'}`} title="Imbalance View"><AlignJustify size={12} /></button>
                <button onClick={() => setViewMode('profile')} className={`px-2 py-1 text-[10px] rounded ${viewMode === 'profile' ? 'bg-gray-700 text-white' : 'text-gray-500'}`} title="Profile View"><Spline size={12} /></button>
            </div>

            <div className="h-4 w-px bg-gray-800"></div>

            {/* X-Axis Zoom */}
            <div className="flex items-center gap-1 bg-gray-900 rounded px-1 border border-gray-800">
                <MoveHorizontal size={10} className="text-gray-500" />
                <button onClick={() => handleZoom('x', -10)} className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"><Minus size={10} /></button>
                <button onClick={() => handleZoom('x', 10)} className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"><Plus size={10} /></button>
            </div>

            {/* Y-Axis Zoom */}
            <div className="flex items-center gap-1 bg-gray-900 rounded px-1 border border-gray-800">
                <MoveVertical size={10} className="text-gray-500" />
                <button onClick={() => handleZoom('y', -2)} className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"><Minus size={10} /></button>
                <button onClick={() => handleZoom('y', 2)} className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"><Plus size={10} /></button>
            </div>

            {/* Fit Button */}
             <button 
                onClick={handleFitContent} 
                className="flex items-center gap-1 bg-blue-900/30 hover:bg-blue-900/50 text-blue-300 px-2 py-1 rounded text-[10px] border border-blue-900/50 transition-colors"
                title="Fit Content to Screen"
            >
                <Maximize size={10} /> <span className="hidden sm:inline">Fit</span>
            </button>
        </div>
      </div>

      {/* Main Chart Area with Two-Way Scroll */}
      <div className="flex-1 relative overflow-hidden bg-[#000000] flex flex-col" ref={containerRef}>
        
        <div 
            ref={scrollRef}
            className="w-full flex-1 overflow-auto flex flex-col items-start custom-chart-scroll relative"
        >
            <div className="flex h-full relative">
                {/* 1. Price Scale (Sticky Left) */}
                <div className="sticky left-0 z-30 bg-[#0a0d13] border-r border-gray-800 flex flex-col pt-[24px]">
                    {priceRows.map(price => {
                        // Check if there is an active signal at this price
                        const sig = activeSignals.find(s => Math.abs(s.price - price) < 0.001);
                        return (
                            <div 
                                key={price} 
                                className={`px-2 text-[10px] font-mono flex items-center justify-end border-b overflow-hidden whitespace-nowrap relative
                                    ${sig ? (sig.side === 'BULLISH' ? 'bg-green-900/40 text-green-400 font-bold border-green-800' : 'bg-red-900/40 text-red-400 font-bold border-red-800') : 'text-gray-500 border-gray-800/30'}
                                `}
                                style={{ height: `${rowHeight}px` }}
                            >
                                {/* Only show price label if row is tall enough */}
                                {rowHeight > 8 && price.toFixed(2)}
                                
                                {/* Signal Label on Axis */}
                                {sig && (
                                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${sig.side === 'BULLISH' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* 2. Candles Area */}
                <div className="flex h-min relative">
                    
                    {/* AUCTION MARKET PROFILE LINES (Existing) */}
                    {auctionProfile && (
                        <div className="absolute inset-0 z-10 pointer-events-none">
                            {/* VAH */}
                            {(() => {
                                const idx = priceRows.findIndex(p => Math.abs(p - auctionProfile.vah) < 0.001);
                                if (idx >= 0) {
                                    const top = idx * rowHeight + 24;
                                    return (
                                        <div className="absolute left-0 right-0 border-t-2 border-green-500 opacity-60 flex justify-end" style={{ top }}>
                                            <span className="text-[9px] bg-green-900 text-green-200 px-1 rounded-bl">VAH {auctionProfile.vah.toFixed(2)}</span>
                                        </div>
                                    )
                                }
                            })()}
                            {/* VAL */}
                            {(() => {
                                const idx = priceRows.findIndex(p => Math.abs(p - auctionProfile.val) < 0.001);
                                if (idx >= 0) {
                                    const top = idx * rowHeight + 24;
                                    return (
                                        <div className="absolute left-0 right-0 border-t-2 border-red-500 opacity-60 flex justify-end" style={{ top }}>
                                            <span className="text-[9px] bg-red-900 text-red-200 px-1 rounded-bl">VAL {auctionProfile.val.toFixed(2)}</span>
                                        </div>
                                    )
                                }
                            })()}
                            {/* PoC */}
                            {(() => {
                                const idx = priceRows.findIndex(p => Math.abs(p - auctionProfile.poc) < 0.001);
                                if (idx >= 0) {
                                    const top = idx * rowHeight + 24;
                                    return (
                                        <div className="absolute left-0 right-0 border-t-2 border-yellow-400 opacity-80 flex justify-end" style={{ top }}>
                                            <span className="text-[9px] bg-yellow-900 text-yellow-200 px-1 rounded-bl">PoC {auctionProfile.poc.toFixed(2)}</span>
                                        </div>
                                    )
                                }
                            })()}
                        </div>
                    )}
                    
                    {/* NEW: MARKET STRUCTURE LINES (Swing H/L) */}
                    <div className="absolute inset-0 z-10 pointer-events-none">
                        {swingHigh && (() => {
                            const idx = priceRows.findIndex(p => Math.abs(p - swingHigh) < 0.001);
                            if (idx >= 0) {
                                const top = idx * rowHeight + 24;
                                return (
                                    <div className="absolute left-0 right-0 border-t border-dashed border-gray-400 opacity-50 flex justify-start" style={{ top }}>
                                        <span className="text-[9px] text-gray-400 px-1 bg-black/50">Structure High {swingHigh.toFixed(2)}</span>
                                    </div>
                                )
                            }
                        })()}
                         {swingLow && (() => {
                            const idx = priceRows.findIndex(p => Math.abs(p - swingLow) < 0.001);
                            if (idx >= 0) {
                                const top = idx * rowHeight + 24;
                                return (
                                    <div className="absolute left-0 right-0 border-t border-dashed border-gray-400 opacity-50 flex justify-start" style={{ top }}>
                                        <span className="text-[9px] text-gray-400 px-1 bg-black/50">Structure Low {swingLow.toFixed(2)}</span>
                                    </div>
                                )
                            }
                        })()}
                    </div>


                    {/* Signal Lines Overlay */}
                    <div className="absolute inset-0 z-20 pointer-events-none">
                        {activeSignals.map(sig => {
                            const rowIndex = priceRows.findIndex(p => Math.abs(p - sig.price) < 0.001);
                            if (rowIndex === -1) return null;
                            
                            const top = rowIndex * rowHeight + 24; // +24 for header offset
                            const color = sig.side === 'BULLISH' ? '#22c55e' : '#ef4444';
                            const isProfit = sig.pnlTicks >= 0;

                            // Calculate positions for SL and TP lines
                            const tpIndex = priceRows.findIndex(p => Math.abs(p - sig.takeProfit) < 0.001);
                            const slIndex = priceRows.findIndex(p => Math.abs(p - sig.stopLoss) < 0.001);
                            const tpTop = tpIndex >= 0 ? tpIndex * rowHeight + 24 : -1;
                            const slTop = slIndex >= 0 ? slIndex * rowHeight + 24 : -1;

                            return (
                                <React.Fragment key={sig.id}>
                                    {/* Entry Line */}
                                    <div 
                                        className="absolute left-0 right-0 border-b-2 border-dashed flex items-end px-2 opacity-90 transition-all duration-300"
                                        style={{ 
                                            top: `${top + (rowHeight/2)}px`, 
                                            borderColor: color,
                                            height: '0px'
                                        }}
                                    >
                                        <div 
                                            className="px-2 py-0.5 rounded -translate-y-1/2 text-white shadow-lg flex items-center gap-2 border border-white/20" 
                                            style={{ backgroundColor: color }}
                                        >
                                            <span className="text-[9px] font-bold">
                                                {sig.side === 'BULLISH' ? <TrendingUp size={10} className="inline mr-1" /> : <TrendingDown size={10} className="inline mr-1" />}
                                                {sig.type === 'CVD_DIVERGENCE' ? 'DIV' : sig.type === 'MOMENTUM_BREAKOUT' ? 'MOM' : sig.type === 'STRUCTURE_BREAK_BULL' ? 'BoS BULL' : sig.type === 'STRUCTURE_BREAK_BEAR' ? 'BoS BEAR' : 'DEF'}
                                            </span>
                                            <div className="h-3 w-px bg-white/30"></div>
                                            <span className={`text-[10px] font-mono font-bold ${isProfit ? 'text-white' : 'text-white'}`}>
                                                {sig.pnlTicks > 0 ? '+' : ''}{sig.pnlTicks.toFixed(0)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Stop Loss Line */}
                                    {slTop >= 0 && (
                                        <div className="absolute left-0 right-0 border-b border-dotted border-red-500 opacity-70 flex justify-end pointer-events-none" style={{ top: slTop + (rowHeight/2) }}>
                                            <span className="text-[8px] text-red-500 bg-red-900/20 px-1 flex items-center gap-1"><ShieldX size={8} /> SL {sig.stopLoss.toFixed(2)}</span>
                                        </div>
                                    )}

                                    {/* Take Profit Line */}
                                    {tpTop >= 0 && (
                                        <div className="absolute left-0 right-0 border-b border-dotted border-green-500 opacity-70 flex justify-end pointer-events-none" style={{ top: tpTop + (rowHeight/2) }}>
                                            <span className="text-[8px] text-green-500 bg-green-900/20 px-1 flex items-center gap-1"><Target size={8} /> TP {sig.takeProfit.toFixed(2)}</span>
                                        </div>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>

                    {(!bars || bars.length === 0) && (
                        <div className="flex flex-col items-center justify-center p-10 text-gray-600 gap-2 w-[400px]">
                            <RefreshCcw className="animate-spin" />
                            <span className="text-xs">Waiting for Tick Data...</span>
                        </div>
                    )}
                    
                    {bars && bars.map((bar) => (
                        <FootprintCandle 
                            key={bar.timestamp}
                            bar={bar}
                            viewMode={viewMode}
                            width={candleWidth}
                            priceRows={priceRows}
                            rowHeight={rowHeight}
                        />
                    ))}
                    
                    {/* 3. Empty Future Space */}
                    <div className="min-w-[150px] h-full bg-gradient-to-r from-[#050505] to-transparent border-l border-dashed border-gray-800/30"></div>
                </div>
            </div>

            {/* CVD PANE (Sticky Bottom) */}
            <div className="sticky bottom-0 left-0 right-0 z-40 bg-[#0a0d13] border-t border-gray-800 w-full min-w-max">
                 <CVDPane bars={bars || []} width={candleWidth} />
            </div>

        </div>
      </div>
    </div>
  );
};