import React, { useEffect, useRef } from 'react';
import { MarketState, OrderSide } from '../types';
import { Activity, Disc, Layers } from 'lucide-react';

interface HeatmapProps {
  marketState: MarketState;
}

export const HeatmapWidget: React.FC<HeatmapProps> = ({ marketState }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // Initialize Offscreen Canvas for buffering the scrolling history
    if (!offscreenCanvasRef.current) {
        const osc = document.createElement('canvas');
        osc.width = 800; // Default buffer width
        osc.height = 300;
        offscreenCanvasRef.current = osc;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const offscreen = offscreenCanvasRef.current;
    if (!canvas || !offscreen) return;
    
    const ctx = canvas.getContext('2d');
    const osCtx = offscreen.getContext('2d');
    if (!ctx || !osCtx) return;

    // Sync dimensions
    if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        if (canvas.width !== clientWidth || canvas.height !== clientHeight) {
             canvas.width = clientWidth;
             canvas.height = clientHeight;
             offscreen.width = clientWidth;
             offscreen.height = clientHeight;
             // Fill black on resize
             osCtx.fillStyle = '#050505';
             osCtx.fillRect(0, 0, clientWidth, clientHeight);
        }
    }

    const width = canvas.width;
    const height = canvas.height;
    
    // --- 1. SHIFT HISTORY LEFT ---
    // Get existing image data from 1px right to end
    // Draw it at 0,0 (shifting left by 1px)
    // Note: drawImage is faster than putImageData for shifting
    osCtx.globalCompositeOperation = 'copy';
    osCtx.drawImage(offscreen, 1, 0, width - 1, height, 0, 0, width - 1, height);
    osCtx.globalCompositeOperation = 'source-over';

    // --- 2. DRAW NEW COLUMN AT RIGHTMOST PIXEL ---
    // Clear the new column column
    osCtx.fillStyle = '#050505';
    osCtx.fillRect(width - 1, 0, 1, height);

    const midY = height / 2;
    const pxPerPrice = 12; // Zoom Level
    const currentPrice = marketState.currentPrice;

    // Render Depth Gradient for the current moment
    marketState.book.forEach(level => {
        const diff = (currentPrice - level.price) * 100;
        const y = midY + (diff * pxPerPrice * 0.1);
        
        // Only draw if within view
        if (y >= 0 && y < height) {
            const totalVol = level.totalBidSize + level.totalAskSize;
            // Intensity scaling: Cap at 2000 qty for full brightness
            const intensity = Math.min(totalVol / 1000, 1);
            
            // Heatmap Gradient: Blue (Low) -> Cyan -> Yellow -> Red/White (High)
            let r = 0, g = 0, b = 0;
            if (intensity < 0.25) { // Deep Blue
                r = 0; g = 0; b = 50 + (intensity * 4 * 200);
            } else if (intensity < 0.5) { // Cyan
                r = 0; g = (intensity - 0.25) * 4 * 255; b = 255;
            } else if (intensity < 0.75) { // Yellow
                r = (intensity - 0.5) * 4 * 255; g = 255; b = 255 - ((intensity - 0.5) * 4 * 255);
            } else { // Red/White
                r = 255; g = 255 - ((intensity - 0.75) * 4 * 100); b = (intensity - 0.75) * 4 * 255;
            }

            osCtx.fillStyle = `rgb(${r},${g},${b})`;
            // Draw a 1px wide block for this price level
            // Height is usually 1px, but we can make it slightly taller if zoomed out
            osCtx.fillRect(width - 1, y, 1, 2); 
        }
    });

    // --- 3. DRAW TRADES (BUBBLES) ---
    // We only draw trades that happened *just now* (since last render or within last 100ms)
    // For this demo, we assume the render loop is fast enough to catch "recentTrades[0]" if it's new.
    // Ideally, we'd track lastProcessedTradeId.
    const latestTrade = marketState.recentTrades[0];
    if (latestTrade && (Date.now() - latestTrade.timestamp) < 200) {
        const diff = (currentPrice - latestTrade.price) * 100;
        const y = midY + (diff * pxPerPrice * 0.1);
        
        // Draw bubble on the new column
        const radius = Math.min(Math.max(latestTrade.size / 10, 2), 6);
        osCtx.beginPath();
        osCtx.arc(width - 5, y, radius, 0, 2 * Math.PI); // Draw slightly offset so it's visible
        osCtx.fillStyle = latestTrade.side === OrderSide.BID ? '#ef4444' : '#22c55e'; // Red for sell-market (hit bid), Green for buy-market (lift ask)
        osCtx.fill();
    }

    // --- 4. RENDER TO MAIN CANVAS ---
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(offscreen, 0, 0);

    // --- 5. OVERLAYS (Static Elements like Price Line) ---
    // These are drawn on the visible canvas, NOT the history buffer
    ctx.strokeStyle = '#fbbf24';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();
    
    ctx.fillStyle = '#fbbf24';
    ctx.font = '10px JetBrains Mono';
    ctx.fillText(currentPrice.toFixed(2), width - 50, midY - 5);

    // Draw Iceberg Lines (optional overlay)
    marketState.activeIcebergs.forEach(iceberg => {
        const diff = (currentPrice - iceberg.price) * 100;
        const y = midY + (diff * pxPerPrice * 0.1);
        if (y > 0 && y < height) {
            ctx.beginPath();
            ctx.moveTo(width - 50, y);
            ctx.lineTo(width, y);
            ctx.strokeStyle = iceberg.side === OrderSide.BID ? '#00eaff' : '#ff00aa';
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            ctx.stroke();
        }
    });

  }, [marketState]); // Re-run on every state update (feed tick)

  return (
    <div className="bg-trading-panel border border-trading-border rounded-lg overflow-hidden flex flex-col h-full shadow-lg">
      <div className="p-2 border-b border-trading-border bg-[#0a0d13] flex justify-between items-center shrink-0">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <Activity className="w-4 h-4 text-purple-400" /> 
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400">Liquidity History</span>
        </h3>
        <div className="flex gap-3 items-center text-[10px] text-gray-500 font-mono">
             <span className="flex items-center gap-1"><Layers className="w-3 h-3 text-blue-500"/> High Liq</span>
             <span className="flex items-center gap-1"><Disc className="w-3 h-3 text-green-500"/> Buy</span>
             <span className="flex items-center gap-1"><Disc className="w-3 h-3 text-red-500"/> Sell</span>
        </div>
      </div>
      <div ref={containerRef} className="relative flex-1 bg-[#050505] overflow-hidden cursor-crosshair">
         <canvas 
            ref={canvasRef} 
            className="w-full h-full object-cover"
         />
      </div>
    </div>
  );
};