import React, { useRef, useEffect, useState, useMemo } from 'react';
import { FootprintBar, FootprintLevel, TradeSignal, AuctionProfile } from '../types';
import { BoxSelect, AlignJustify, Spline, Layers, Minus, Plus, Maximize, MoveHorizontal, MoveVertical, RefreshCcw, TrendingUp, TrendingDown, Target, ShieldX, CheckSquare } from 'lucide-react';

interface FootprintChartProps {
  bars: FootprintBar[];
  activeSignals?: TradeSignal[];
  auctionProfile?: AuctionProfile;
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
  const showText = width > 40 && rowHeight > 14;
  
  const levelMap = useMemo(() => {
      const map = new Map<string, FootprintLevel>();
      if (bar.levels && Array.isArray(bar.levels)) {
          bar.levels.forEach(l => {
              if (l && typeof l.price === 'number') map.set(l.price.toFixed(2), l);
          });
      }
      return map;
  }, [bar]);

  // Heatmap Depth Snapshot Map (from Limit Book history)
  const depthMap = useMemo(() => {
      const map = new Map<string, number>();
      if (bar.depthSnapshot) {
          Object.keys(bar.depthSnapshot).forEach(k => map.set(k, bar.depthSnapshot![k]));
      }
      return map;
  }, [bar.depthSnapshot]);

  return (
    <div 
      className="flex flex-col border-r border-gray-800/20 bg-transparent relative select-none"
      style={{ minWidth: `${width}px`, width: `${width}px` }}
    >
      {/* Header */}
      <div className={`h-[24px] text-[9px] text-center border-b border-gray-800/50 flex justify-between px-1 items-center font-mono ${bar.delta > 0 ? 'text-bid' : 'text-ask'} bg-[#0a0d13]/90 overflow-hidden`}>
        {width > 30 && <span className="font-bold">Δ{bar.delta}</span>}
      </div>

      {/* Grid Rows */}
      <div className="flex flex-col w-full relative">
        {priceRows.map((price) => {
            const levelKey = price.toFixed(2);
            const level = levelMap.get(levelKey);
            const depthValue = depthMap.get(levelKey) || 0;
            
            // --- HEATMAP OVERLAY LOGIC ---
            // Calculate color based on depth value relative to some max (e.g. 50000)
            let heatmapStyle = {};
            if (depthValue > 0) {
                const intensity = Math.min(depthValue / 2000, 1); // Normalize 0-1
                // Bookmap style: Blue(Low) -> Cyan -> Yellow -> Red/White(High)
                let bgColor = '';
                if (intensity < 0.25) bgColor = `rgba(0,0,100, ${intensity * 0.8})`;
                else if (intensity < 0.5) bgColor = `rgba(0,150,150, ${intensity * 0.8})`;
                else if (intensity < 0.75) bgColor = `rgba(200,150,0, ${intensity * 0.8})`;
                else bgColor = `rgba(200,50,0, ${intensity * 0.9})`;
                
                heatmapStyle = { backgroundColor: bgColor };
            }

            // Candle Body Logic
            const inBody = price <= Math.max(bar.open, bar.close) + 0.001 && price >= Math.min(bar.open, bar.close) - 0.001;
            const isWick = price <= bar.high + 0.001 && price >= bar.low - 0.001;

            const bidVol = level ? (level.bidVol || 0) : 0;
            const askVol = level ? (level.askVol || 0) : 0;
            const isImbalanceBuy = askVol > bidVol * 3 && askVol > 10;
            const isImbalanceSell = bidVol > askVol * 3 && bidVol > 10;

            return (
                <div 
                    key={levelKey}
                    className="grid grid-cols-[1fr_20%_1fr] items-center relative overflow-hidden"
                    style={{ height: `${rowHeight}px`, ...heatmapStyle }}
                >
                     {/* Candle Body/Wick Layer */}
                     {isWick && (
                         <div className={`absolute left-1/2 -translate-x-1/2 w-[2px] h-full z-10 opacity-60 ${isUp ? 'bg-bid' : 'bg-ask'}`}></div>
                     )}
                     {inBody && (
                         <div className={`absolute inset-0 z-10 opacity-30 ${isUp ? 'bg-bid' : 'bg-ask'} border-x ${isUp ? 'border-bid/40' : 'border-ask/40'}`}></div>
                     )}

                     {/* Text Values */}
                     {level && showText ? (
                        <>
                            <div className={`text-right pr-1 relative z-20 text-[10px] font-mono leading-none flex items-center justify-end gap-0.5 ${isImbalanceSell && viewMode === 'imbalance' ? 'text-white font-bold bg-ask/60' : 'text-gray-400'}`}>
                                {bidVol > 0 ? bidVol : ''}
                            </div>
                            <div className="relative z-20"></div>
                            <div className={`text-left pl-1 relative z-20 text-[10px] font-mono leading-none flex items-center justify-start gap-0.5 ${isImbalanceBuy && viewMode === 'imbalance' ? 'text-white font-bold bg-bid/60' : 'text-gray-400'}`}>
                                {askVol > 0 ? askVol : ''}
                            </div>
                        </>
                     ) : (
                         <div className="col-span-3"></div>
                     )}
                </div>
            )
        })}
      </div>
    </div>
  );
};

const CVDPane = ({ bars, width }: { bars: FootprintBar[], width: number }) => {
    const minCVD = Math.min(...bars.map(b => b.cvd), 0);
    const maxCVD = Math.max(...bars.map(b => b.cvd), 1);
    const range = maxCVD - minCVD || 1;
    
    return (
        <div className="h-[60px] bg-[#0d1117] border-t border-trading-border relative flex flex-row">
            <div className="absolute left-1 top-1 text-[8px] text-gray-500 font-mono">CVD</div>
            <div className="flex h-full items-end pl-[60px]">
                {bars.map((bar, i) => {
                    const prevCvd = i > 0 ? bars[i-1].cvd : 0;
                    const h = ((bar.cvd - minCVD) / range) * 40;
                    const color = bar.cvd >= prevCvd ? '#22c55e' : '#ef4444';
                    return (
                        <div key={bar.timestamp} style={{ minWidth: `${width}px`, width: `${width}px` }} className="h-full relative border-r border-gray-800/30 flex items-end justify-center pb-1">
                             <div style={{ height: `${Math.max(h, 2)}px`, backgroundColor: color }} className="w-2 rounded-sm opacity-80"></div>
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

  // --- 1. Price Grid Logic ---
  const { minPrice, maxPrice } = useMemo(() => {
    if (!bars || !bars.length) return { minPrice: 0, maxPrice: 100 };
    let min = Infinity, max = -Infinity;
    bars.forEach(b => {
        if (b.low < min) min = b.low;
        if (b.high > max) max = b.high;
    });
    if (min === Infinity || max === -Infinity) return { minPrice: 0, maxPrice: 100 };
    return { minPrice: min - (TICK_SIZE * 5), maxPrice: max + (TICK_SIZE * 5) };
  }, [bars]);

  const priceRows = useMemo(() => {
      const rows: number[] = [];
      if (!isFinite(maxPrice) || !isFinite(minPrice)) return [];
      const startTick = Math.ceil(maxPrice / TICK_SIZE);
      const endTick = Math.floor(minPrice / TICK_SIZE);
      if (startTick - endTick > 5000) return []; 
      for (let t = startTick; t >= endTick; t--) rows.push(t * TICK_SIZE);
      return rows;
  }, [minPrice, maxPrice]);

  // --- 2. AutoScale Logic ---
  const handleAutoScale = () => {
      if (!scrollRef.current || !bars || bars.length === 0 || priceRows.length === 0) return;
      
      const { clientWidth, clientHeight } = scrollRef.current;
      const xAxisSpace = clientWidth - 60; // Subtract axis width
      const yAxisSpace = clientHeight - 24; // Subtract header

      // Fit All Candles horizontally
      const newCandleWidth = Math.max(xAxisSpace / bars.length, 10);
      
      // Fit Price Range vertically
      const newRowHeight = Math.max(yAxisSpace / priceRows.length, 4);

      setCandleWidth(newCandleWidth);
      setRowHeight(newRowHeight);

      // Reset scroll to end/middle
      setTimeout(() => {
          if (scrollRef.current) {
              scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight / 2 - scrollRef.current.clientHeight / 2;
          }
      }, 50);
  };

  // Scroll to middle on init
  useEffect(() => {
      if (scrollRef.current && priceRows.length > 0) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight / 2 - scrollRef.current.clientHeight / 2;
      }
  }, [priceRows.length]);

  return (
    <div className="flex flex-col h-full bg-trading-panel border border-trading-border rounded-lg overflow-hidden shadow-2xl">
      {/* Toolbar */}
      <div className="p-2 border-b border-trading-border bg-[#0a0d13] flex justify-between items-center shrink-0 z-20 relative gap-2">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2 hidden md:flex">
          <Layers className="w-4 h-4 text-blue-400" /> 
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-green-400">OrderFlow + Heatmap</span>
        </h3>
        
        <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
             <div className="flex bg-gray-900 rounded p-0.5 gap-0.5 border border-gray-800">
                <button onClick={() => setViewMode('cluster')} className={`px-2 py-1 text-[10px] rounded ${viewMode === 'cluster' ? 'bg-gray-700 text-white' : 'text-gray-500'}`} title="Cluster"><BoxSelect size={12} /></button>
                <button onClick={() => setViewMode('imbalance')} className={`px-2 py-1 text-[10px] rounded ${viewMode === 'imbalance' ? 'bg-gray-700 text-white' : 'text-gray-500'}`} title="Imbalance"><AlignJustify size={12} /></button>
            </div>
            <div className="h-4 w-px bg-gray-800"></div>
            <div className="flex items-center gap-1 bg-gray-900 rounded px-1 border border-gray-800">
                <MoveHorizontal size={10} className="text-gray-500" />
                <button onClick={() => setCandleWidth(p => Math.max(p-5, 4))} className="p-1 hover:text-white"><Minus size={10} /></button>
                <button onClick={() => setCandleWidth(p => Math.min(p+5, 200))} className="p-1 hover:text-white"><Plus size={10} /></button>
            </div>
            <div className="flex items-center gap-1 bg-gray-900 rounded px-1 border border-gray-800">
                <MoveVertical size={10} className="text-gray-500" />
                <button onClick={() => setRowHeight(p => Math.max(p-2, 2))} className="p-1 hover:text-white"><Minus size={10} /></button>
                <button onClick={() => setRowHeight(p => Math.min(p+2, 100))} className="p-1 hover:text-white"><Plus size={10} /></button>
            </div>
             <button 
                onClick={handleAutoScale} 
                className="flex items-center gap-1 bg-green-900/30 hover:bg-green-900/50 text-green-300 px-2 py-1 rounded text-[10px] border border-green-900/50 transition-colors animate-pulse"
                title="AutoScale X & Y"
            >
                <Maximize size={10} /> AutoScale
            </button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden bg-[#000000] flex flex-col" ref={containerRef}>
        <div ref={scrollRef} className="w-full flex-1 overflow-auto flex flex-col items-start custom-chart-scroll relative">
            <div className="flex h-full relative">
                
                {/* Y-Axis Price Scale */}
                <div className="sticky left-0 z-30 bg-[#0a0d13] border-r border-gray-800 flex flex-col pt-[24px]">
                    {priceRows.map(price => (
                        <div 
                            key={price} 
                            className="px-2 text-[10px] font-mono flex items-center justify-end border-b border-gray-800/30 text-gray-500 overflow-hidden whitespace-nowrap"
                            style={{ height: `${rowHeight}px` }}
                        >
                            {rowHeight > 8 && price.toFixed(2)}
                        </div>
                    ))}
                </div>

                {/* Chart Area */}
                <div className="flex h-min relative">
                    
                    {/* Structure Lines (VAH/VAL/POC) */}
                    {auctionProfile && (
                        <div className="absolute inset-0 z-10 pointer-events-none">
                            {[
                                { val: auctionProfile.vah, color: 'border-green-500', bg: 'bg-green-900', label: 'VAH' },
                                { val: auctionProfile.val, color: 'border-red-500', bg: 'bg-red-900', label: 'VAL' },
                                { val: auctionProfile.poc, color: 'border-yellow-500', bg: 'bg-yellow-900', label: 'POC' },
                            ].map(level => {
                                const idx = priceRows.findIndex(p => Math.abs(p - level.val) < 0.001);
                                if (idx === -1) return null;
                                return (
                                    <div key={level.label} className={`absolute left-0 right-0 border-t-2 ${level.color} opacity-60 flex justify-end`} style={{ top: idx * rowHeight + 24 }}>
                                        <span className={`text-[9px] ${level.bg} text-white px-1 rounded-bl opacity-80`}>{level.label} {level.val}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {(!bars || bars.length === 0) && (
                        <div className="flex flex-col items-center justify-center p-10 text-gray-600 gap-2 w-[400px]">
                            <RefreshCcw className="animate-spin" />
                            <span className="text-xs">Waiting for Data Stream...</span>
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
                    
                    {/* Empty Space on Right */}
                    <div className="min-w-[100px] h-full bg-[#050505] border-l border-dashed border-gray-800/30"></div>
                </div>
            </div>

            <div className="sticky bottom-0 left-0 right-0 z-40 bg-[#0a0d13] border-t border-gray-800 w-full min-w-max">
                 <CVDPane bars={bars || []} width={candleWidth} />
            </div>

        </div>
      </div>
    </div>
  );
};