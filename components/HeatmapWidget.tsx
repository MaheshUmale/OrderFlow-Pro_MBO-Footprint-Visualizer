import React, { useEffect, useRef } from 'react';
import { MarketState, OrderSide } from '../types';
import { Activity, Disc } from 'lucide-react';

interface HeatmapProps {
  marketState: MarketState;
}

export const HeatmapWidget: React.FC<HeatmapProps> = ({ marketState }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Constants for visualization
  const WIDTH = 800;
  const HEIGHT = 300;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Clear with slight opacity for trail effect (simulates persistence)
    // Actually for React re-renders we usually clear fully, but for "feed" look we simulate scrolling
    // Here we just redraw the current state cleanly for the demo.
    ctx.fillStyle = '#050505'; 
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const midY = HEIGHT / 2;
    const pxPerPrice = 12; // Zoom level
    
    // 2. Draw Book Depth (Background Heatmap)
    // We iterate the book to draw horizontal liquidity bands
    marketState.book.forEach(level => {
        const diff = (marketState.currentPrice - level.price) * 100;
        const y = midY + (diff * pxPerPrice * 0.1); 
        
        if (y >= 0 && y <= HEIGHT) {
            const totalVol = level.totalBidSize + level.totalAskSize;
            const intensity = Math.min(totalVol / 60, 1);
            
            // Heatmap Gradient: Dark Blue (Low) -> Cyan -> Yellow -> White (High)
            let r = 0, g = 0, b = 0;
            if (intensity < 0.3) { // Deep Blue
                r = 0; g = 0; b = 50 + (intensity * 300);
            } else if (intensity < 0.6) { // Cyan/Green
                r = 0; g = (intensity - 0.3) * 500; b = 150;
            } else if (intensity < 0.8) { // Yellow/Orange
                r = (intensity - 0.6) * 800; g = 200; b = 0;
            } else { // White/Hot
                r = 255; g = 255; b = (intensity - 0.8) * 1000;
            }
            
            ctx.fillStyle = `rgba(${Math.min(r,255)}, ${Math.min(g,255)}, ${Math.min(b,255)}, ${intensity * 0.8})`;
            ctx.fillRect(0, y, WIDTH, 2 + intensity * 2); // Thicker lines for more liquidity
        }
    });

    // 3. Draw Iceberg Life Lines (The "Lifecycle" visualization)
    marketState.activeIcebergs.forEach(iceberg => {
        const diff = (marketState.currentPrice - iceberg.price) * 100;
        const y = midY + (diff * pxPerPrice * 0.1);
        
        const age = Date.now() - iceberg.detectedAt;
        const xEnd = WIDTH;
        const xStart = Math.max(WIDTH - (age / 20), 0);
        
        if (xStart < WIDTH) {
            ctx.beginPath();
            ctx.moveTo(xStart, y);
            ctx.lineTo(xEnd, y);
            ctx.lineWidth = 2;
            ctx.strokeStyle = iceberg.side === OrderSide.BID ? '#00eaff' : '#ff00aa'; // Cyan vs Magenta (Neon)
            ctx.setLineDash([6, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Glowing Label
            ctx.shadowColor = iceberg.side === OrderSide.BID ? '#00eaff' : '#ff00aa';
            ctx.shadowBlur = 10;
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px JetBrains Mono';
            ctx.fillText(`ICE ${iceberg.totalFilled}`, xEnd - 60, y - 6);
            ctx.shadowBlur = 0;
        }
    });

    // 4. Draw Recent Trades (Bubbles) - Enhanced Visuals
    marketState.recentTrades.forEach((trade, i) => {
        if (i < marketState.recentTrades.length - 40) return; 

        const timeDiff = Date.now() - trade.timestamp;
        const x = WIDTH - (timeDiff / 20); 
        if (x < 0) return;

        const diff = (marketState.currentPrice - trade.price) * 100;
        const y = midY + (diff * pxPerPrice * 0.1);

        // Size based on volume
        const radius = Math.min(Math.max(trade.size * 0.8, 3), 20);
        
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        
        // Neon Colors
        const color = trade.side === OrderSide.BID 
            ? 'rgba(239, 68, 68, 0.7)' // Red (Sold into Bid)
            : 'rgba(34, 197, 94, 0.7)'; // Green (Bought from Ask)
            
        ctx.fillStyle = color;
        ctx.fill();
        
        // Border for definition
        ctx.strokeStyle = trade.side === OrderSide.BID ? '#ff5555' : '#55ff55';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Iceberg Interaction Ring (Bright White)
        if (trade.isIcebergExecution) {
            ctx.beginPath();
            ctx.arc(x, y, radius + 3, 0, 2 * Math.PI);
            ctx.strokeStyle = '#ffffff'; 
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    });
    
    // 5. Current Price Line (Best Bid/Ask midpoint)
    ctx.strokeStyle = '#fbbf24';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(WIDTH, midY);
    ctx.stroke();
    
    // Price Label
    ctx.fillStyle = '#fbbf24';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText(marketState.currentPrice.toFixed(2), WIDTH - 50, midY - 5);

  }, [marketState]);

  return (
    <div className="bg-trading-panel border border-trading-border rounded-lg overflow-hidden flex flex-col h-full shadow-lg">
      <div className="p-2 border-b border-trading-border bg-[#0a0d13] flex justify-between items-center shrink-0">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Activity className="w-4 h-4 text-purple-400" /> 
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400">Liquidity Heatmap</span>
        </h3>
        <div className="flex gap-3 items-center text-[10px] text-gray-500 font-mono">
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-cyan-400 border-dashed border-t border-cyan-200"></span> Iceberg</span>
            <span className="flex items-center gap-1"><Disc className="w-3 h-3 text-green-500 fill-green-500/50" /> Buy</span>
            <span className="flex items-center gap-1"><Disc className="w-3 h-3 text-red-500 fill-red-500/50" /> Sell</span>
        </div>
      </div>
      <div className="relative flex-1 bg-[#050505] overflow-hidden cursor-crosshair">
         <canvas 
            ref={canvasRef} 
            width={800} 
            height={300} 
            className="w-full h-full object-cover"
         />
      </div>
    </div>
  );
};