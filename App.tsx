import React, { useEffect, useState } from 'react';
import { subscribeToMarketData } from './services/marketSimulator';
import { MarketState } from './types';
import { MBODOM } from './components/MBODOM';
import { FootprintChart } from './components/FootprintChart';
import { HeatmapWidget } from './components/HeatmapWidget';
import { ControlPanel } from './components/ControlPanel';
import { TradeAnalysis } from './components/TradeAnalysis';

export default function App() {
  const [data, setData] = useState<MarketState | null>(null);

  useEffect(() => {
    // Connect to "WebSocket"
    const unsubscribe = subscribeToMarketData((newState) => {
      setData(newState);
    });
    return () => unsubscribe();
  }, []);

  if (!data) return <div className="h-screen w-screen bg-trading-bg text-white flex items-center justify-center font-mono text-xs">Initializing Feed Parser...</div>;

  return (
    <div className="min-h-screen bg-trading-bg text-gray-200 p-2 font-sans flex flex-col gap-2 overflow-hidden h-screen">
      
      {/* Top Header / Control Panel */}
      <header className="shrink-0">
          <ControlPanel 
            currentInstrument={data.selectedInstrument} 
            instruments={data.availableInstruments}
          />
      </header>

      {/* Main Grid Layout */}
      <main className="flex-1 grid grid-cols-12 gap-2 min-h-0">
        
        {/* Left Col: Split View (DOM + Analysis) */}
        <div className="col-span-12 md:col-span-3 lg:col-span-3 h-full min-h-0 flex flex-col gap-2">
          
          {/* Top: DOM (55% height) */}
          <div className="flex-[5.5] min-h-0">
             <MBODOM 
                key={data.selectedInstrument} 
                book={data.book} 
                currentPrice={data.currentPrice} 
             />
          </div>

          {/* Bottom: Trade AI (45% height) */}
          <div className="flex-[4.5] min-h-0">
              <TradeAnalysis marketState={data} />
          </div>

        </div>

        {/* Center/Right Col: Heatmap + Footprint Stack */}
        <div className="col-span-12 md:col-span-9 lg:col-span-9 flex flex-col gap-2 h-full min-h-0">
             
             {/* 1. Liquidity Heatmap (Bookmap Style) - 35% Height */}
             <div className="flex-[3.5] min-h-0 relative">
                 <HeatmapWidget marketState={data} />
                 <div className="absolute top-2 right-2 z-10 text-[10px] text-gray-400 font-mono bg-black/50 px-2 rounded">
                    LTP: <span className="text-white font-bold">{data.currentPrice.toFixed(2)}</span>
                 </div>
             </div>

             {/* 2. Footprint Chart (Auction Detail) - 65% Height */}
             <div className="flex-[6.5] min-h-0 bg-[#050505] rounded-lg border border-trading-border overflow-hidden relative shadow-2xl">
                 <FootprintChart 
                    key={data.selectedInstrument}
                    bars={data.footprintBars} 
                    activeSignals={data.activeSignals}
                    auctionProfile={data.auctionProfile}
                    swingHigh={data.swingHigh}
                    swingLow={data.swingLow}
                 />
             </div>
        </div>

      </main>
      
      {/* Footer Status Bar */}
      <footer className="shrink-0 h-6 bg-trading-panel border-t border-trading-border flex items-center px-4 text-[10px] text-gray-500 justify-between">
         <div className="flex gap-4">
            <span>Feed: <span className="text-green-500">ACTIVE</span></span>
            <span>Database: <span className="text-purple-400">QUESTDB (CONNECTED)</span></span>
            <span>Instrument: <span className="text-yellow-500">{data.selectedInstrument}</span></span>
         </div>
         <div className="flex gap-4">
            <span>Mode: <span className="text-iceberg">INSTITUTIONAL (OI TRACKING)</span></span>
         </div>
      </footer>
    </div>
  );
}