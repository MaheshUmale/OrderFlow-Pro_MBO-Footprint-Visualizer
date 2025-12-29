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
      setChainStatus('Requesting...');
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
      
      {/* Instrument Dropdown */}
      <div className="relative group">
          <div className="flex items-center gap-2 bg-black border border-gray-700 px-3 py-1.5 rounded cursor-pointer hover:border-gray-500 min-w-[250px] justify-between">
              <span className={`text-xs font-mono truncate max-w-[220px] ${instruments.length === 0 ? 'text-red-400' : 'text-yellow-500'}`}>
                  {instruments.length === 0 ? 'No Instruments' : (instrumentNames[currentInstrument || ''] || currentInstrument)}
              </span>
              <ChevronDown className="w-3 h-3 text-gray-500" />
          </div>
          
          <div className="absolute top-full left-0 mt-1 w-[350px] bg-[#0d1117] border border-gray-700 rounded shadow-2xl z-50 hidden group-hover:block max-h-[400px] overflow-y-auto">
              <div className="p-2 bg-[#161b22] border-b border-gray-700 sticky top-0">
                  <div className="text-[10px] text-gray-400 font-bold mb-1">OPTION CHAIN / SEARCH</div>
                  <div className="flex gap-1">
                      <input 
                        type="text" 
                        className="w-full bg-black border border-gray-600 text-xs px-2 py-1 rounded text-white"
                        placeholder="e.g. NSE_INDEX|Nifty 50"
                        value={underlyingKey}
                        onChange={(e) => setUnderlyingKey(e.target.value)}
                      />
                      <button 
                        onClick={handleFetchChain}
                        className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] px-2 rounded font-bold whitespace-nowrap"
                        disabled={!isConnected}
                      >
                         {chainStatus || 'Fetch Chain'}
                      </button>
                  </div>
              </div>
              
              {instruments.map(inst => (
                  <div 
                    key={inst}
                    className={`px-3 py-2 text-xs cursor-pointer flex justify-between items-center border-b border-gray-800/50 hover:bg-gray-800 ${currentInstrument === inst ? 'bg-blue-900/20 text-blue-400' : 'text-gray-300'}`}
                    onClick={() => setInstrument(inst)}
                  >
                      <span>{instrumentNames[inst] || inst}</span>
                      {inst === currentInstrument && <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>}
                  </div>
              ))}
          </div>
      </div>

      <div className="h-6 w-px bg-gray-700 mx-2"></div>

      {/* Bridge Connection */}
      <button 
        onClick={() => setShowBridge(true)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${getButtonClass()}`}
      >
        <Wifi className="w-3 h-3" />
        {getButtonText()}
      </button>

      {/* Upload Feed */}
      <div className="relative">
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden" 
            accept=".json,.txt,.gz"
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-xs text-gray-300 transition-colors"
            disabled={isUploading}
          >
             {isUploading ? <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full"></div> : <Upload className="w-3 h-3" />}
             Load Replay
          </button>
      </div>

      <div className="flex-1"></div>

      {/* Simulation Speed */}
      <div className="flex items-center gap-1 bg-black rounded p-1 border border-gray-800">
          {[1, 5, 10, 50].map(speed => (
              <button
                key={speed}
                onClick={() => handleSpeedChange(speed)}
                className={`px-2 py-0.5 text-[10px] rounded ${currentSpeed === speed ? 'bg-blue-600 text-white font-bold' : 'text-gray-500 hover:text-gray-300'}`}
              >
                  {speed}x
              </button>
          ))}
      </div>

      {/* Iceberg Injection Test */}
      <div className="flex gap-1">
          <button onClick={() => injectIceberg(OrderSide.BID)} className="bg-green-900/30 hover:bg-green-900/50 text-green-400 border border-green-900 px-2 py-1 rounded text-[10px] font-bold" title="Simulate Buy Iceberg">
             + ICE BUY
          </button>
          <button onClick={() => injectIceberg(OrderSide.ASK)} className="bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-900 px-2 py-1 rounded text-[10px] font-bold" title="Simulate Sell Iceberg">
             + ICE SELL
          </button>
      </div>

      {/* Schema Info */}
      <button onClick={() => setShowSchema(true)} className="text-gray-500 hover:text-white">
          <Info className="w-4 h-4" />
      </button>

      {/* Modals */}
      {showSchema && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-6 max-w-2xl w-full shadow-2xl">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2"><Terminal className="w-5 h-5 text-yellow-500"/> Feed Schema</h3>
                    <button onClick={() => setShowSchema(false)}><X className="w-5 h-5 text-gray-500" /></button>
                </div>
                <div className="bg-black p-4 rounded border border-gray-800 overflow-auto max-h-[400px]">
                    <pre className="text-xs text-green-400 font-mono">{schemaString}</pre>
                </div>
            </div>
        </div>
      )}

      {showBridge && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-[#0d1117] border border-gray-700 rounded-lg p-6 max-w-md w-full shadow-2xl">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2"><Link className="w-5 h-5 text-blue-500"/> Connect Bridge</h3>
                    <button onClick={() => setShowBridge(false)}><X className="w-5 h-5 text-gray-500" /></button>
                </div>
                
                <div className="space-y-4">
                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Bridge URL</label>
                        <input 
                            type="text" 
                            className="w-full bg-black border border-gray-700 rounded px-3 py-2 text-sm text-white focus:border-blue-500 outline-none"
                            value={bridgeUrl}
                            onChange={(e) => setBridgeUrl(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 block mb-1">Upstox Access Token</label>
                        <input 
                            type="password" 
                            className="w-full bg-black border border-gray-700 rounded px-3 py-2 text-sm text-white focus:border-blue-500 outline-none"
                            placeholder="ey..."
                            value={accessToken}
                            onChange={(e) => setAccessToken(e.target.value)}
                        />
                        <p className="text-[10px] text-gray-500 mt-1">Token is stored locally in browser.</p>
                    </div>
                    
                    <button 
                        onClick={handleConnect}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded text-sm transition-colors flex justify-center items-center gap-2"
                    >
                        <Wifi className="w-4 h-4" /> Connect Live
                    </button>

                    <div className="text-[10px] text-gray-500 text-center border-t border-gray-800 pt-2">
                        Ensure <code>node server/upstox-bridge.js</code> is running.
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};