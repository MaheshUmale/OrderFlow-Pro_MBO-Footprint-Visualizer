import React, { useMemo, useEffect, useRef } from 'react';
import { PriceLevel, OrderSide, IcebergType } from '../types';
import { Zap, Lock, Layers, AlertCircle } from 'lucide-react';

interface MBODOMProps {
  book: PriceLevel[];
  currentPrice: number;
}

const IcebergIcon = ({ type }: { type: IcebergType }) => {
  switch (type) {
    case IcebergType.NATIVE:
      return <Layers className="w-3 h-3 text-blue-400 inline-block ml-1 animate-pulse" />;
    case IcebergType.AGGRESSIVE:
      return <Zap className="w-3 h-3 text-yellow-400 inline-block ml-1 animate-bounce" />;
    case IcebergType.TRAPPED:
      return <Lock className="w-3 h-3 text-orange-500 inline-block ml-1" />;
    default:
      return null;
  }
};

const OrderCell = ({ orders, side }: { orders: any[], side: OrderSide }) => {
  const visibleOrders = orders.slice(0, 3);
  const remaining = orders.length - 3;

  // Calculate Average Size for Context
  const totalSize = orders.reduce((acc, o) => acc + o.size, 0);
  const avgSize = totalSize / (orders.length || 1);

  return (
    <div className={`flex items-center gap-0.5 ${side === OrderSide.BID ? 'flex-row-reverse justify-start' : 'flex-row justify-start'}`}>
      {visibleOrders.map((order) => {
        // Aggressive Order Logic: significantly larger than average
        const isAggressive = order.size > 100 && order.size > (avgSize * 1.5);

        return (
            <div 
              key={order.id} 
              className={`
                text-[9px] px-1 h-4 flex items-center justify-center rounded-[1px]
                ${order.icebergType !== IcebergType.NONE 
                    ? 'bg-blue-600 text-white border border-blue-400 shadow-[0_0_5px_rgba(59,130,246,0.5)]' 
                    : isAggressive 
                        ? 'bg-gray-800 text-white font-bold border-2 animate-pulse shadow-lg' 
                        : 'bg-gray-800 text-gray-300 border border-gray-700'
                }
                ${isAggressive && side === OrderSide.BID ? 'border-green-500 shadow-green-900/50' : ''}
                ${isAggressive && side === OrderSide.ASK ? 'border-red-500 shadow-red-900/50' : ''}
                min-w-[20px] relative group cursor-help transition-all duration-300
              `}
            >
              {order.size}
              {order.icebergType !== IcebergType.NONE && <div className="scale-75"><IcebergIcon type={order.icebergType} /></div>}
              
              {/* Tooltip */}
              <div className="absolute hidden group-hover:block bottom-full left-1/2 -translate-x-1/2 mb-1 bg-black border border-gray-600 p-2 z-50 whitespace-nowrap rounded text-xs shadow-xl">
                 <div className="font-bold text-gray-300">Order #{order.id}</div>
                 <div>Est. Total: <span className="text-yellow-400">{order.totalSizeEstimated}</span></div>
                 <div>Priority: {order.priority}</div>
                 {isAggressive && <div className="text-red-400 font-bold uppercase text-[10px] mt-1">Aggressive Order</div>}
              </div>
            </div>
        );
      })}
      {remaining > 0 && <span className="text-[8px] text-gray-600 font-mono">+{remaining}</span>}
    </div>
  );
};

export const MBODOM: React.FC<MBODOMProps> = ({ book, currentPrice }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const maxVol = useMemo(() => {
    if (!book || book.length === 0) return 1;
    return Math.max(...book.map(l => Math.max(l.totalBidSize, l.totalAskSize)), 1);
  }, [book]);

  // Reset scroll on mount (component remounts when instrument changes due to key in parent)
  useEffect(() => {
      if (containerRef.current) {
          containerRef.current.scrollTop = 0;
      }
  }, []);

  if (!book) return <div className="p-4 text-xs text-red-400">Error: Book Data Missing</div>;

  return (
    <div className="flex flex-col h-full bg-trading-panel border border-trading-border rounded-lg overflow-hidden shadow-lg">
      <div className="p-2 border-b border-trading-border bg-[#0a0d13] flex justify-between items-center shrink-0">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Layers className="w-4 h-4 text-orange-400" /> SuperDOM
        </h3>
        <span className="text-[9px] bg-green-900/30 text-green-400 border border-green-900 px-1.5 rounded animate-pulse">LIVE</span>
      </div>
      
      <div ref={containerRef} className="flex-1 overflow-y-auto relative font-mono text-xs bg-[#050505]">
        <div className="sticky top-0 z-20 grid grid-cols-[1fr_60px_1fr] bg-[#0a0d13] border-b border-trading-border text-[9px] text-gray-500 font-bold text-center py-1 shadow-sm">
          <div>BID MBO</div>
          <div>PRICE</div>
          <div>ASK MBO</div>
        </div>

        {book.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-gray-600 gap-2">
                <AlertCircle className="w-6 h-6" />
                <span>No Depth Data</span>
            </div>
        )}

        <div className="relative">
          {book.map((level) => {
            const isCurrent = Math.abs(level.price - currentPrice) < 0.001;
            
            return (
              <div 
                key={level.price} 
                className={`grid grid-cols-[1fr_60px_1fr] border-b border-gray-800/20 hover:bg-white/5 transition-colors h-[26px] items-center
                ${isCurrent ? 'bg-yellow-900/10' : ''}`}
              >
                
                {/* Bid Side */}
                <div className="relative h-full flex items-center justify-end px-2 border-r border-gray-800/50">
                  <div 
                    className="absolute right-0 top-[2px] bottom-[2px] bg-green-500/10 border-l-2 border-green-500/30 transition-all duration-300"
                    style={{ width: `${(level.totalBidSize / maxVol) * 100}%` }}
                  />
                  <div className="relative z-10 flex items-center justify-end w-full gap-2">
                    {level.totalBidSize > 0 && (
                        <>
                            <span className="font-bold text-green-400">{level.totalBidSize}</span>
                            <OrderCell orders={level.bids} side={OrderSide.BID} />
                        </>
                    )}
                  </div>
                </div>

                {/* Price Column */}
                <div className={`
                  text-center font-bold relative h-full flex items-center justify-center text-[11px]
                  ${isCurrent ? 'text-yellow-400 bg-yellow-500/10' : 'text-gray-400'}
                  ${level.impliedIceberg ? 'text-cyan-400 shadow-[inset_0_0_10px_rgba(34,211,238,0.1)]' : ''}
                `}>
                  {level.price.toFixed(2)}
                  {level.impliedIceberg && <div className="absolute inset-y-0 left-0 w-[2px] bg-cyan-400 shadow-[0_0_8px_cyan]"></div>}
                </div>

                {/* Ask Side */}
                <div className="relative h-full flex items-center justify-start px-2 border-l border-gray-800/50">
                  <div 
                    className="absolute left-0 top-[2px] bottom-[2px] bg-red-500/10 border-r-2 border-red-500/30 transition-all duration-300"
                    style={{ width: `${(level.totalAskSize / maxVol) * 100}%` }}
                  />
                  <div className="relative z-10 flex items-center justify-start w-full gap-2">
                     {level.totalAskSize > 0 && (
                        <>
                            <OrderCell orders={level.asks} side={OrderSide.ASK} />
                            <span className="font-bold text-red-400">{level.totalAskSize}</span>
                        </>
                    )}
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};