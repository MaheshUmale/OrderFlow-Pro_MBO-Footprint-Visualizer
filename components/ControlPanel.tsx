import React, { useState, useRef, useEffect } from 'react';
import { injectIceberg, setInstrument, setSimulationSpeed, uploadFeedData, connectToBridge, fetchOptionChain } from '../services/marketSimulator';
import { OrderSide } from '../types';
import { ShieldAlert, Info, X, ChevronDown, Monitor, Upload, Link, Wifi, Layers, RefreshCw } from 'lucide-react';

interface ControlPanelProps {
    currentInstrument?: string;
    instruments?: string[];
    instrumentNames?: { [key: string]: string };
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ currentInstrument, instruments = [], instrumentNames = {} }) => {
  const [showSchema, setShowSchema] = useState(false);
  const [showBridge, setShowBridge] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  // Bridge Config State
  const [accessToken, setAccessToken] = useState('');
  const [bridgeUrl, setBridgeUrl] = useState('ws://localhost:4000');
  const [isConnected, setIsConnected] = useState(false);
  const [chainStatus, setChainStatus] = useState<string>('');
  
  // Dynamic Chain State
  const [underlyingKey, setUnderlyingKey] = useState('NSE_INDEX|Nifty 50');

  // Load saved token on mount
  useEffect(() => {
      const savedToken = localStorage.getItem('upstox_token');
      if (savedToken) setAccessToken(savedToken);
      
      const savedUrl = localStorage.getItem('bridge_url');
      if (savedUrl) setBridgeUrl(savedUrl);
  }, []);

  const handleSpeedChange = (speed: number) => {
      setCurrentSpeed(speed);
      setSimulationSpeed(speed);
  };

  const handleConnect = () => {
      if (!accessToken) {
          alert("Please enter Upstox Access Token");
          return;
      }
      
      // Save for next time
      localStorage.setItem('upstox_token', accessToken);
      localStorage.setItem('bridge_url', bridgeUrl);

      connectToBridge(bridgeUrl, accessToken);
      setIsConnected(true);
      setShowBridge(false); // Close modal
  };

  const handleFetchChain = () => {
      if (!isConnected) {
          alert("Connect to Bridge first");
          setShowBridge(true);
          return;
      }
      setChainStatus('Requesting Chain...');
      fetchOptionChain(underlyingKey, accessToken, undefined, (status) => {
          setChainStatus(status);
      });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsUploading(true);
      try {
          let textContent = '';

          // Handle GZIP (.gz) or plain JSON
          if (file.name.endsWith('.gz')) {
              try {
                // Use native DecompressionStream (supported in modern Chrome/Firefox/Safari)
                const ds = new DecompressionStream('gzip');
                const stream = file.stream().pipeThrough(ds);
                const response = new Response(stream);
                textContent = await response.text();
              } catch (gzError) {
                  throw new Error("Failed to decompress .gz file. It might be corrupted or not gzip format.");
              }
          } else {
              textContent = await file.text();
          }

          // Parse JSON logic
          let frames: any[] = [];
          
          try {
             const json = JSON.parse(textContent);
             if (Array.isArray(json)) {
                 frames = json;
             } else {
                 frames = [json];
             }
          } catch (standardJsonError) {
             const lines = textContent.replace(/\r\n/g, '\n').split('\n');
             frames = lines
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map((line, idx) => {
                    try {
                        return JSON.parse(line);
                    } catch (lineError) {
                        return null;
                    }
                })
                .filter(frame => frame !== null);

             if (frames.length === 0) {
                 throw new Error("Failed to parse file: No valid JSON objects found.");
             }
          }
          
          if (frames.length > 0) {
              uploadFeedData(frames);
              alert(`Successfully loaded ${frames.length} data snapshots.`);
          } else {
              throw new Error("File contained no data.");
          }
          if (fileInputRef.current) fileInputRef.current.value = '';

      } catch (err: any) {
          console.error("Failed to parse feed file:", err);
          alert(`Error: ${err.message || "Invalid file format"}`);
      } finally {
          setIsUploading(false);
      }
  };

  return (
    <div className="bg-trading-panel border border-trading-border p-2 md:p-3 rounded-lg flex flex-wrap items-center gap-4 shadow-xl">
      <div className="text-sm font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
         <Monitor className="w-4 h-4 text-blue-500" />
         OrderFlow Pro
      </div>
      
      {/* Instrument Selector */}
      <div className="relative group">
          <div className="flex items-center gap-2 bg-black border border-gray-700 px-3 py-1.5 rounded cursor-pointer hover:border-gray-500 min-w-[250px]">
              <span className={`text-xs font-mono truncate max-w-[200px] ${instruments.length === 0 ? 'text-red-400' : 'text-yellow-500'}`}>
                  {instruments.length === 0 ? "NO INSTRUMENTS LOADED" : (instrumentNames[currentInstrument || ''] || currentInstrument || "SELECT INSTRUMENT")}
              </span>
              <ChevronDown className="w-3 h-3 text-gray-500 ml-auto" />
          </div>
          {/* Dropdown */}
          <div className="absolute top-full left-0 mt-1 w-full bg-trading-panel border border-trading-border rounded shadow-xl z-50 hidden group-hover:block max-h-60 overflow-y-auto">
              {instruments.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-500 italic">Connect & Load Chain first</div>
              ) : (
                  instruments.map(inst => (
                    <div 
                        key={inst}
                        onClick={() => setInstrument(inst)}
                        className={`px-3 py-2 text-xs hover:bg-gray-800 cursor-pointer border-b border-gray-800 last:border-0 font-mono ${inst === currentInstrument ? 'text-white bg-gray-800' : 'text-gray-400'}`}
                    >
                        {instrumentNames[inst] || inst}
                    </div>
                  ))
              )}
          </div>
      </div>

      <div className="h-6 w-px bg-gray-700 hidden md:block"></div>
      
      {/* Bridge / Live Controls */}
       <button 
           onClick={() => setShowBridge(true)}
           className={`flex items-center gap-1 px-3 py-1.5 border rounded text-xs transition-all ${isConnected ? 'bg-green-900/20 border-green-800 text-green-300' : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'}`}
       >
           <Wifi className={`w-3 h-3 ${isConnected ? 'animate-pulse' : ''}`} /> {isConnected ? 'Live Active' : 'Connect Live'}
       </button>
       
       {/* Option Chain Quick Loader */}
       <div className="flex items-center gap-2 bg-gray-900/50 p-1 rounded border border-gray-800">
           <input 
              className="bg-black border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 w-[140px]" 
              value={underlyingKey}
              onChange={(e) => setUnderlyingKey(e.target.value)}
              placeholder="Underlying Key"
           />
           <button 
               onClick={handleFetchChain}
               disabled={!isConnected}
               className={`px-2 py-1 border rounded text-xs flex items-center gap-1
                  ${isConnected ? 'bg-purple-900/30 border-purple-800 text-purple-300 hover:bg-purple-900/50' : 'bg-gray-800 text-gray-600 border-gray-700 cursor-not-allowed'}
               `}
               title="Load Option Chain from Upstox API"
            >
               <Layers className="w-3 h-3" />
               Load
           </button>
           {chainStatus && (
               <span className="text-[9px] text-cyan-400 animate-pulse font-mono px-1">{chainStatus}</span>
           )}
       </div>


      <div className="h-6 w-px bg-gray-700 hidden md:block"></div>
      
      {/* Replay Speed Controls */}
      <div className="flex items-center gap-1 bg-gray-900 rounded p-1 border border-gray-800">
         <span className="text-[10px] text-gray-500 px-2">REPLAY:</span>
         {[0.5, 1, 2, 5].map(speed => (
             <button
                key={speed}
                onClick={() => handleSpeedChange(speed)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${currentSpeed === speed ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
             >
                {speed}x
             </button>
         ))}
      </div>

      <div className="h-6 w-px bg-gray-700 hidden md:block"></div>
      
      {/* Simulation Controls */}
      <div className="flex items-center gap-2">
        <button 
            onClick={() => injectIceberg(OrderSide.BID)}
            className="flex items-center gap-1 px-3 py-1.5 bg-blue-900/20 hover:bg-blue-900/40 border border-blue-800 text-blue-200 rounded text-xs transition-all"
        >
            <ShieldAlert className="w-3 h-3" /> Bid Iceberg
        </button>
        <button 
            onClick={() => injectIceberg(OrderSide.ASK)}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-900/20 hover:bg-red-900/40 border border-red-800 text-red-200 rounded text-xs transition-all"
        >
            <ShieldAlert className="w-3 h-3" /> Ask Iceberg
        </button>
      </div>
    
      <div className="h-6 w-px bg-gray-700 hidden md:block"></div>

      {/* Upload Control */}
      <div>
         <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            accept=".json,.gz,.log,.txt"
         />
         <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-200 rounded text-xs transition-all"
         >
            {isUploading ? <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full"></div> : <Upload className="w-3 h-3" />} 
            {isUploading ? 'Loading...' : 'Upload Feed'}
         </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
         <button 
           onClick={() => setShowSchema(true)}
           className="text-xs text-gray-400 hover:text-white flex items-center gap-1 underline"
         >
           <Info className="w-3 h-3" /> Feed Schema
         </button>
      </div>

      {/* Bridge Config Modal */}
      {showBridge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-lg w-full flex flex-col shadow-2xl">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                    <h3 className="font-bold text-gray-200 flex items-center gap-2">
                        <Link className="w-4 h-4 text-green-400" /> Connect to Upstox Bridge
                    </h3>
                    <button onClick={() => setShowBridge(false)} className="text-gray-500 hover:text-white"><X size={18} /></button>
                </div>
                <div className="p-4 space-y-4">
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">Bridge URL (Localhost)</label>
                        <input 
                            type="text" 
                            value={bridgeUrl}
                            onChange={(e) => setBridgeUrl(e.target.value)}
                            className="w-full bg-black border border-gray-700 rounded px-2 py-1.5 text-xs text-white font-mono"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">Upstox Access Token</label>
                        <textarea 
                            value={accessToken}
                            onChange={(e) => setAccessToken(e.target.value)}
                            placeholder="Enter your Upstox access token (JWT)"
                            className="w-full bg-black border border-gray-700 rounded px-2 py-1.5 text-xs text-white font-mono min-h-[80px]"
                        />
                    </div>
                    <div className="bg-blue-900/20 text-blue-300 p-2 rounded text-[10px] border border-blue-900/50">
                        Ensure you are running <code>node server/upstox-bridge.js</code> in your terminal before connecting.
                    </div>
                    <button 
                        onClick={handleConnect}
                        className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded text-xs transition-colors"
                    >
                        CONNECT TO BRIDGE
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Schema Modal */}
      {showSchema && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col">
                <div className="flex justify-between items-center p-4 border-b border-gray-800">
                    <h3 className="font-bold text-gray-200">Aligned NSE JSON Feed Structure</h3>
                    <button onClick={() => setShowSchema(false)} className="text-gray-500 hover:text-white"><X size={20} /></button>
                </div>
                <div className="p-4 overflow-y-auto font-mono text-xs text-green-300 bg-[#0d1117]">
<pre>{`[
  {
    "type": "live_feed",
    "feeds": { ... }
  },
  ...
]

OR NDJSON (Newline Delimited):
{ "type": "live_feed", ... }
{ "type": "live_feed", ... }`}</pre>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};