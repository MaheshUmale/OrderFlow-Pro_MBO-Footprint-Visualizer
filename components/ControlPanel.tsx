import React, { useState, useRef, useEffect } from 'react';
import { injectIceberg, setInstrument, setSimulationSpeed, uploadFeedData, connectToBridge, fetchOptionChain, getUnderlyingForInstrument } from '../services/marketSimulator';
import { OrderSide } from '../types';
import { ShieldAlert, Info, X, ChevronDown, Monitor, Upload, Link, Wifi, Layers, Terminal } from 'lucide-react';

interface ControlPanelProps {
    currentInstrument?: string;
    instruments?: string[];
    instrumentNames?: { [key: string]: string };
    connectionStatus?: string;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ currentInstrument, instruments = [], instrumentNames = {}, connectionStatus }) => {
  const [showSchema, setShowSchema] = useState(false);
  const [showBridge, setShowBridge] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  // Bridge Config State
  const [accessToken, setAccessToken] = useState('');
  const [bridgeUrl, setBridgeUrl] = useState('ws://localhost:4000');
  const [chainStatus, setChainStatus] = useState<string>('');
  
  const isConnected = connectionStatus === 'CONNECTED';
  const isConnecting = connectionStatus === 'CONNECTING';
  const isError = connectionStatus === 'ERROR';
  
  const [underlyingKey, setUnderlyingKey] = useState('NSE_INDEX|Nifty 50');

  useEffect(() => {
      const savedToken = localStorage.getItem('upstox_token');
      if (savedToken) setAccessToken(savedToken);
      const savedUrl = localStorage.getItem('bridge_url');
      if (savedUrl) setBridgeUrl(savedUrl);
  }, []);
  
  useEffect(() => {
      if (currentInstrument) {
          const autoKey = getUnderlyingForInstrument(currentInstrument);
          if (autoKey) setUnderlyingKey(autoKey);
      }
  }, [currentInstrument]);

  const handleSpeedChange = (speed: number) => {
      setCurrentSpeed(speed);
      setSimulationSpeed(speed);
  };

  const handleConnect = () => {
      if (!accessToken) {
          alert("Please enter Upstox Access Token");
          return;
      }
      localStorage.setItem('upstox_token', accessToken);
      localStorage.setItem('bridge_url', bridgeUrl);
      connectToBridge(bridgeUrl, accessToken);
      setShowBridge(false);
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
          if (file.name.endsWith('.gz')) {
              try {
                if (typeof DecompressionStream === 'undefined') throw new Error("Browser does not support GZIP.");
                const ds = new DecompressionStream('gzip');
                const stream = file.stream().pipeThrough(ds);
                const response = new Response(stream);
                textContent = await response.text();
              } catch (gzError: any) {
                  throw new Error(gzError.message || "Failed to decompress .gz file.");
              }
          } else {
              textContent = await file.text();
          }

          let frames: any[] = [];
          try {
             const json = JSON.parse(textContent);
             frames = Array.isArray(json) ? json : [json];
          } catch (standardJsonError) {
             const lines = textContent.replace(/\r\n/g, '\n').split('\n');
             frames = lines.map(line => {
                    try { return JSON.parse(line); } catch (e) { return null; }
                }).filter(frame => frame !== null);
          }
          
          if (frames.length > 0) {
              uploadFeedData(frames);
              alert(`Successfully loaded ${frames.length} snapshots.`);
          } else {
              throw new Error("File contained no valid JSON data.");
          }
          if (fileInputRef.current) fileInputRef.current.value = '';

      } catch (err: any) {
          console.error("Parse error:", err);
          alert(`Error: ${err.message}`);
      } finally {
          setIsUploading(false);
      }
  };

  const getButtonClass = () => {
      if (isConnected) return 'bg-green-900/20 border-green-800 text-green-300';
      if (isError) return 'bg-red-900/20 border-red-800 text-red-300';
      if (isConnecting) return 'bg-yellow-900/20 border-yellow-800 text-yellow-300';
      return 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700';
  };
  
  const getButtonText = () => {
      if (isConnected) return 'Live Active';
      if (isError) return 'Failed (Run: npm run bridge)';
      if (isConnecting) return 'Connecting...';
      return 'Connect Live';
  };

  // Safe schema string (no invisible chars)
  const schemaString = `[
  {
    "type": "live_feed",
    "feeds": { "INSTRUMENT_ID": { ... } }
  }
]`;

  return (
    <div className="bg-trading-panel border border-trading-border p-2 md:p-3 rounded-lg flex flex-wrap items-center gap-4 shadow-xl">
      <div className="text-sm font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
         <Monitor className="w-4 h-4 text-blue-500" />
         OrderFlow Pro
      </div>
      
      <div className="relative group">
          <div className="flex items-center gap-2 bg-black border border-gray-700 px-3 py-1.5 rounded cursor-pointer hover:border-gray-500 min-w-[250px]">
              <span className={`text-xs font-mono truncate max-w-[200px] ${instruments.length === 0 ? 'text-red-400' : 'text-yellow-500'}`}>
                  {instruments.length === 0 ? "NO INSTRUMENTS LOADED" : (instrumentNames[currentInstrument || ''] || currentInstrument)}
              </span>
              <ChevronDown className="w-3 h-3 text-gray-500 ml-auto" />
          </div>
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
      
       <div className="relative group">
           <button onClick={() => setShowBridge(true)} className={`flex items-center gap-1 px-3 py-1.5 border rounded text-xs transition-all ${getButtonClass()}`}>
               <Wifi className={`w-3 h-3 ${isConnected ? 'animate-pulse' : ''}`} /> {getButtonText()}
           </button>
           {isError && (
               <div className="absolute top-full left-0 mt-2 w-64 bg-red-900/90 text-white text-[10px] p-2 rounded shadow-xl z-50 pointer-events-none">
                   <div className="font-bold flex items-center gap-1 mb-1"><Terminal size={10} /> Backend Required</div>
                   The Bridge Server is unreachable. Please run:
                   <div className="bg-black/50 p-1 rounded font-mono mt-1 select-all">npm run bridge</div>
               </div>
           )}
       </div>
       
       <div className="flex items-center gap-2 bg-gray-900/50 p-1 rounded border border-gray-800">
           <input 
              className="bg-black border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 w-[140px]" 
              value={underlyingKey}
              onChange={(e) => setUnderlyingKey(e.target.value)}
              placeholder="Underlying Key"
           />
           <button onClick={handleFetchChain} disabled={!isConnected} className={`px-2 py-1 border rounded text-xs flex items-center gap-1 ${isConnected ? 'bg-purple-900/30 border-purple-800 text-purple-300 hover:bg-purple-900/50' : 'bg-gray-800 text-gray-600 border-gray-700 cursor-not-allowed'}`}>
               <Layers className="w-3 h-3" /> Load
           </button>
           {chainStatus && <span className="text-[9px] text-cyan-400 animate-pulse font-mono px-1">{chainStatus}</span>}
       </div>

      <div className="h-6 w-px bg-gray-700 hidden md:block"></div>
      
      <div className="flex items-center gap-1 bg-gray-900 rounded p-1 border border-gray-800">
         <span className="text-[10px] text-gray-500 px-2">REPLAY:</span>
         {[0.5, 1, 2, 5].map(speed => (
             <button key={speed} onClick={() => handleSpeedChange(speed)} className={`text-[10px] px-2 py-0.5 rounded transition-colors ${currentSpeed === speed ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                {speed}x
             </button>
         ))}
      </div>

      <div className="h-6 w-px bg-gray-700 hidden md:block"></div>
      
      <div className="flex items-center gap-2">
        <button onClick={() => injectIceberg(OrderSide.BID)} className="flex items-center gap-1 px-3 py-1.5 bg-blue-900/20 hover:bg-blue-900/40 border border-blue-800 text-blue-200 rounded text-xs transition-all">
            <ShieldAlert className="w-3 h-3" /> Bid Iceberg
        </button>
        <button onClick={() => injectIceberg(OrderSide.ASK)} className="flex items-center gap-1 px-3 py-1.5 bg-red-900/20 hover:bg-red-900/40 border border-red-800 text-red-200 rounded text-xs transition-all">
            <ShieldAlert className="w-3 h-3" /> Ask Iceberg
        </button>
      </div>
    
      <div className="h-6 w-px bg-gray-700 hidden md:block"></div>

      <div>
         <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".json,.gz,.log,.txt" />
         <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-200 rounded text-xs transition-all">
            {isUploading ? <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full"></div> : <Upload className="w-3 h-3" />} 
            {isUploading ? 'Loading...' : 'Upload Feed'}
         </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
         <button onClick={() => setShowSchema(true)} className="text-xs text-gray-400 hover:text-white flex items-center gap-1 underline">
           <Info className="w-3 h-3" /> Schema
         </button>
      </div>

      {showBridge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-lg w-full flex flex-col shadow-2xl">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                    <h3 className="font-bold text-gray-200 flex items-center gap-2"><Link className="w-4 h-4 text-green-400" /> Connect to Upstox Bridge</h3>
                    <button onClick={() => setShowBridge(false)} className="text-gray-500 hover:text-white"><X size={18} /></button>
                </div>
                <div className="p-4 space-y-4">
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">Bridge URL</label>
                        <input type="text" value={bridgeUrl} onChange={(e) => setBridgeUrl(e.target.value)} className="w-full bg-black border border-gray-700 rounded px-2 py-1.5 text-xs text-white font-mono"/>
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">Upstox Access Token</label>
                        <textarea value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="Enter JWT Token" className="w-full bg-black border border-gray-700 rounded px-2 py-1.5 text-xs text-white font-mono min-h-[80px]"/>
                    </div>
                    <div className="bg-gray-800 p-2 rounded text-[10px] text-gray-400 border border-gray-600">
                        <span className="text-yellow-400 font-bold">Important:</span> You must start the backend server for this to work.
                        <br />Run this command in your terminal:
                        <div className="bg-black p-1 mt-1 font-mono text-green-400">npm run bridge</div>
                    </div>
                    <button onClick={handleConnect} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded text-xs transition-colors">CONNECT</button>
                </div>
            </div>
        </div>
      )}

      {showSchema && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col">
                <div className="flex justify-between items-center p-4 border-b border-gray-800">
                    <h3 className="font-bold text-gray-200">NSE JSON Feed Structure</h3>
                    <button onClick={() => setShowSchema(false)} className="text-gray-500 hover:text-white"><X size={20} /></button>
                </div>
                <div className="p-4 overflow-y-auto font-mono text-xs text-green-300 bg-[#0d1117]">
                    <pre>{schemaString}</pre>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};