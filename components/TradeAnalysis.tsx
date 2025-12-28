import React, { useMemo } from 'react';
import { MarketState, TradeSignal } from '../types';
import { BrainCircuit, Shield, Zap, TrendingUp, CheckCircle, XCircle, Clock, DollarSign, BarChart3, ArrowDownToLine, ArrowUpToLine } from 'lucide-react';

interface TradeAnalysisProps {
  marketState: MarketState;
}

export const TradeAnalysis: React.FC<TradeAnalysisProps> = ({ marketState }) => {
  
  const { activeSignals, signalHistory, auctionProfile } = marketState;

  // Calculate Performance Metrics
  const stats = useMemo(() => {
    // History (Realized)
    const totalClosed = signalHistory.length;
    const wins = signalHistory.filter(s => s.status === 'WIN').length;
    const realizedPnL = signalHistory.reduce((acc, s) => acc + s.pnlTicks, 0);
    const winRate = totalClosed > 0 ? (wins / totalClosed) * 100 : 0;

    // Active (Unrealized)
    const unrealizedPnL = activeSignals.reduce((acc, s) => acc + s.pnlTicks, 0);

    return { totalClosed, wins, winRate, realizedPnL, unrealizedPnL };
  }, [activeSignals, signalHistory]);

  return (
    <div className="flex flex-col h-full bg-trading-panel border border-trading-border rounded-lg overflow-hidden shadow-lg">
      <div className="p-2 border-b border-trading-border bg-[#0a0d13] flex justify-between items-center shrink-0">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-purple-500" /> 
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400">Trade Logic AI</span>
        </h3>
        {/* Realized PnL Badge */}
        <div className={`text-[10px] font-mono px-2 py-0.5 rounded border flex items-center gap-2 ${stats.realizedPnL >= 0 ? 'text-green-400 border-green-900 bg-green-900/20' : 'text-red-400 border-red-900 bg-red-900/20'}`}>
           <span className="opacity-70">Realized:</span> 
           <span className="font-bold">{stats.realizedPnL > 0 ? '+' : ''}{stats.realizedPnL.toFixed(0)} Ticks</span>
        </div>
      </div>
      
      {/* Auction Market Profile Stats */}
      {auctionProfile && (
          <div className="flex justify-between items-center bg-[#0d1117] border-b border-trading-border p-1 text-[9px] font-mono">
             <div className="flex items-center gap-1">
                <span className="text-red-400 flex items-center"><ArrowDownToLine size={10} className="mr-0.5"/>VAL: {auctionProfile.val.toFixed(2)}</span>
             </div>
             <div className="flex items-center gap-1">
                <span className="text-yellow-400 flex items-center"><BarChart3 size={10} className="mr-0.5"/>PoC: {auctionProfile.poc.toFixed(2)}</span>
             </div>
             <div className="flex items-center gap-1">
                <span className="text-green-400 flex items-center"><ArrowUpToLine size={10} className="mr-0.5"/>VAH: {auctionProfile.vah.toFixed(2)}</span>
             </div>
          </div>
      )}

      {/* Stats Bar */}
      <div className="flex text-[9px] bg-[#0d1117] border-b border-trading-border divide-x divide-trading-border">
          <div className="flex-1 p-1 text-center">
             <div className="text-gray-500">WIN RATE</div>
             <div className="font-bold text-gray-200">{stats.winRate.toFixed(1)}%</div>
          </div>
          <div className="flex-1 p-1 text-center">
             <div className="text-gray-500">UNREALIZED</div>
             <div className={`font-bold ${stats.unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {stats.unrealizedPnL > 0 ? '+' : ''}{stats.unrealizedPnL.toFixed(1)}
             </div>
          </div>
          <div className="flex-1 p-1 text-center">
             <div className="text-gray-500">OPEN TRADES</div>
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
                    {(signal.type === 'VAL_REJECTION' || signal.type === 'VAH_REJECTION') && <BarChart3 size={10} />}
                    {signal.type.replace('_', ' ')}
                </span>
                
                {/* Status / PnL */}
                {isActive ? (
                   <span className={`text-[9px] font-mono font-bold ${signal.pnlTicks >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {signal.pnlTicks > 0 ? '+' : ''}{signal.pnlTicks.toFixed(1)}
                   </span>
                ) : (
                   <span className={`text-[9px] font-bold flex items-center gap-1 ${signal.status === 'WIN' ? 'text-green-500' : 'text-red-500'}`}>
                      {signal.status === 'WIN' ? <CheckCircle size={10} /> : <XCircle size={10} />}
                      {signal.pnlTicks.toFixed(1)}
                   </span>
                )}
            </div>
            
            <div className="flex justify-between items-end">
                <div className="text-[9px] text-gray-400 font-mono">
                    @{signal.price.toFixed(2)}
                </div>
                 {isActive && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>}
            </div>
        </div>
    )
}