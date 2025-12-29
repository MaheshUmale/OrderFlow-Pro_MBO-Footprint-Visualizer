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
    const unsubscribe = subscribeToMarketData(setData);
    return () => unsubscribe();
  }, []);

  if (!data) return (
      <div className="h-screen w-screen bg-trading-bg text-white flex flex-col items-center justify-center font-mono text-xs gap-4">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
          <div>Initializing System...</div>
      </div>
  );

  return (
    <div className="min-h-screen bg-trading-bg text-gray-200 p-2 font-sans flex flex-col gap-2 overflow-hidden h-screen">
      <header className="shrink-0">
          <ControlPanel 
            currentInstrument={data.selectedInstrument} 
            instruments={data.availableInstruments}
            instrumentNames={data.instrumentNames}
            connectionStatus={data.connectionStatus}
          />
      </header>

      <main className="flex-1 grid grid-cols-12 gap-2 min-h-0">
        {/* Left Panel: DOM & Signals */}
        <div className="col-span-12 md:col-span-3 lg:col-span-3 h-full min-h-0 flex flex-col gap-2">
          <div className="flex-[5.5] min-h-0">
             <MBODOM book={data.book} currentPrice={data.currentPrice} />
          </div>
          <div className="flex-[4.5] min-h-0">
              <TradeAnalysis marketState={data} />
          </div>
        </div>

        {/* Right Panel: Visualization */}
        <div className="col-span-12 md:col-span-9 lg:col-span-9 flex flex-col gap-2 h-full min-h-0">
             <div className="flex-[3.5] min-h-0 relative">
                 <HeatmapWidget marketState={data} />
                 <div className="absolute top-2 right-2 z-10 text-[10px] text-gray-400 font-mono bg-black/50 px-2 rounded border border-gray-800">
                    LTP: <span className="text-white font-bold">{data.currentPrice.toFixed(2)}</span>
                 </div>
             </div>
             <div className="flex-[6.5] min-h-0 bg-[#050505] rounded-lg border border-trading-border overflow-hidden relative shadow-2xl">
                 <FootprintChart 
                    bars={data.footprintBars} 
                    activeSignals={data.activeSignals}
                    auctionProfile={data.auctionProfile}
                    swingHigh={data.swingHigh}
                    swingLow={data.swingLow}
                 />
             </div>
        </div>
      </main>
      
      <footer className="shrink-0 h-6 bg-trading-panel border-t border-trading-border flex items-center px-4 text-[10px] text-gray-500 justify-between">
         <div className="flex gap-4">
            <span>Server: <span className={data.connectionStatus === 'CONNECTED' ? "text-green-500" : "text-red-500"}>{data.connectionStatus}</span></span>
            <span>Inst: <span className="text-yellow-500">{data.instrumentNames?.[data.selectedInstrument] || data.selectedInstrument}</span></span>
         </div>
         <div className="flex gap-4">
            <span className="text-blue-400">ORDERFLOW PRO v1.2</span>
         </div>
      </footer>
    </div>
  );
}