import React, { useMemo } from 'react';
import { MarketState, TradeSignal } from '../types';
import { BrainCircuit, Shield, Zap, AlertTriangle, TrendingUp, CheckCircle, XCircle, Clock } from 'lucide-react';

interface TradeAnalysisProps {
  marketState: MarketState;
}

export const TradeAnalysis: React.FC<TradeAnalysisProps> = ({ marketState }) => {
  
  const { activeSignals, signalHistory } = marketState;

  // Calculate Performance Metrics
  const stats = useMemo(() => {
    const totalClosed = signalHistory.length;
    const wins = signalHistory.filter(s => s.status === 'WIN').length;
    const losses = signalHistory.filter(s => s.status === 'LOSS').length;
    const winRate = totalClosed > 0 ? (wins / totalClosed) * 100 : 0;
    const totalPnL = signalHistory.reduce((acc, s) => acc + s.pnlTicks, 0);

    return { totalClosed, wins, losses, winRate, totalPnL };
  }, [signalHistory]);

  return (
    <div className="flex flex-col h-full bg-trading-panel border border-trading-border rounded-lg overflow-hidden shadow-lg">
      <div className="p-2 border-b border-trading-border bg-[#0a0d13] flex justify-between items-center shrink-0">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-purple-500" /> 
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400">Trade Logic AI</span>
        </h3>
        {/* Live PnL Badge */}
        <div className={`text-[10px] font-mono px-2 py-0.5 rounded border ${stats.totalPnL >= 0 ? 'text-green-400 border-green-900 bg-green-900/20' : 'text-red-400 border-red-900 bg-red-900/20'}`}>
           PnL: {stats.totalPnL > 0 ? '+' : ''}{stats.totalPnL.toFixed(0)} Ticks
        </div>
      </div>
      
      {/* Stats Bar */}
      <div className="flex text-[9px] bg-[#0d1117] border-b border-trading-border divide-x divide-trading-border">
          <div className="flex-1 p-1 text-center">
             <div className="text-gray-500">WIN RATE</div>
             <div className="font-bold text-gray-200">{stats.winRate.toFixed(1)}%</div>
          </div>
          <div className="flex-1 p-1 text-center">
             <div className="text-gray-500">TRADES</div>
             <div className="font-bold text-gray-200">{stats.totalClosed}</div>
          </div>
          <div className="flex-1 p-1 text-center">
             <div className="text-gray-500">OPEN</div>
             <div className="font-bold text-blue-400">{activeSignals.length}</div>
          </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-[#050505]">
        
        {/* ACTIVE SIGNALS */}
        {activeSignals.length > 0 && (
            <div className="space-y-1 mb-4">
                <div className="text-[9px] font-bold text-blue-400 mb-1 flex items-center gap-1"><Clock size={10} /> OPEN POSITIONS</div>
                {activeSignals.map((sig) => (
                    <SignalCard key={sig.id} signal={sig} isActive={true} />
                ))}
            </div>
        )}

        {/* SIGNAL HISTORY */}
        <div className="space-y-1">
             <div className="text-[9px] font-bold text-gray-500 mb-1">HISTORY</div>
             {signalHistory.length === 0 && activeSignals.length === 0 ? (
                 <div className="flex flex-col items-center justify-center py-8 opacity-50 text-gray-600">
                    <BrainCircuit className="w-8 h-8 mb-2" />
                    <span className="text-xs">Waiting for setups...</span>
                 </div>
             ) : (
                 signalHistory.slice(0, 15).map((sig) => (
                     <SignalCard key={sig.id} signal={sig} isActive={false} />
                 ))
             )}
        </div>

      </div>
    </div>
  );
};

const SignalCard = ({ signal, isActive }: { signal: TradeSignal, isActive: boolean }) => {
    return (
        <div className={`border-l-2 p-2 rounded bg-opacity-10 mb-1 transition-all
            ${signal.side === 'BULLISH' ? 'border-bid bg-bid/5' : 'border-ask bg-ask/5'}
            ${isActive ? 'bg-[#1c2128]' : ''}
        `}>
            <div className="flex justify-between items-start mb-1">
                <span className={`text-[9px] font-bold px-1 rounded flex items-center gap-1
                    ${signal.side === 'BULLISH' ? 'text-bid bg-bid/10' : 'text-ask bg-ask/10'}
                `}>
                    {signal.type === 'ICEBERG_DEFENSE' && <Shield size={10} />}
                    {signal.type === 'MOMENTUM_BREAKOUT' && <Zap size={10} />}
                    {signal.type.replace('_', ' ')}
                </span>
                
                {/* Status / PnL */}
                {isActive ? (
                   <span className={`text-[9px] font-mono ${signal.pnlTicks >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {signal.pnlTicks > 0 ? '+' : ''}{signal.pnlTicks.toFixed(1)} ticks
                   </span>
                ) : (
                   <span className={`text-[9px] font-bold flex items-center gap-1 ${signal.status === 'WIN' ? 'text-green-500' : 'text-red-500'}`}>
                      {signal.status === 'WIN' ? <CheckCircle size={10} /> : <XCircle size={10} />}
                      {signal.pnlTicks.toFixed(1)}
                   </span>
                )}
            </div>
            
            <div className="flex justify-between items-end">
                <div className="text-[9px] text-gray-400">
                    @{signal.price.toFixed(2)}
                </div>
                 {isActive && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>}
            </div>
        </div>
    )
}