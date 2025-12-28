import React, { useState, useRef } from 'react';
import { injectIceberg, setInstrument, setSimulationSpeed, uploadFeedData } from '../services/marketSimulator';
import { OrderSide } from '../types';
import { ShieldAlert, Info, X, ChevronDown, Monitor, Upload, FileJson } from 'lucide-react';

interface ControlPanelProps {
    currentInstrument?: string;
    instruments?: string[];
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ currentInstrument, instruments = [] }) => {
  const [showSchema, setShowSchema] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleSpeedChange = (speed: number) => {
      setCurrentSpeed(speed);
      setSimulationSpeed(speed);
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
          
          // 1. Try parsing as a single standard JSON structure (Array or Object)
          try {
             const json = JSON.parse(textContent);
             if (Array.isArray(json)) {
                 frames = json;
             } else {
                 frames = [json];
             }
          } catch (standardJsonError) {
             // 2. If standard parsing fails, assume NDJSON (Newline Delimited JSON)
             // We split by newline and parse line-by-line permissively.
             
             // Normalize newlines and split
             const lines = textContent.replace(/\r\n/g, '\n').split('\n');
             
             frames = lines
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map((line, idx) => {
                    try {
                        return JSON.parse(line);
                    } catch (lineError) {
                        // Log first few errors but don't fail the whole file
                        if (idx < 5) console.warn(`Skipping invalid JSON at line ${idx + 1}:`, lineError);
                        return null;
                    }
                })
                .filter(frame => frame !== null);

             if (frames.length === 0) {
                 console.error("Standard Parse Error:", standardJsonError);
                 throw new Error("Failed to parse file: No valid JSON objects found.");
             }
          }
          
          if (frames.length > 0) {
              uploadFeedData(frames);
              alert(`Successfully loaded ${frames.length} data snapshots.`);
          } else {
              throw new Error("File contained no data.");
          }
          
          // Clear input so same file can be selected again if needed
          if (fileInputRef.current) fileInputRef.current.value = '';

      } catch (err: any) {
          console.error("Failed to parse feed file:", err);
          alert(`Error: ${err.message || "Invalid file format"}`);
      } finally {
          setIsUploading(false);
      }
  };

  return (
    <div className="bg-trading-panel border border-trading-border p-2 md:p-3 rounded-lg flex flex-wrap items-center gap-4">
      <div className="text-sm font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
         <Monitor className="w-4 h-4 text-blue-500" />
         OrderFlow Pro
      </div>
      
      {/* Instrument Selector */}
      <div className="relative group">
          <div className="flex items-center gap-2 bg-black border border-gray-700 px-3 py-1.5 rounded cursor-pointer hover:border-gray-500 min-w-[200px]">
              <span className="text-xs text-yellow-500 font-mono">{currentInstrument || "SELECT INSTRUMENT"}</span>
              <ChevronDown className="w-3 h-3 text-gray-500 ml-auto" />
          </div>
          {/* Dropdown */}
          <div className="absolute top-full left-0 mt-1 w-full bg-trading-panel border border-trading-border rounded shadow-xl z-50 hidden group-hover:block max-h-60 overflow-y-auto">
              {instruments.map(inst => (
                  <div 
                    key={inst}
                    onClick={() => setInstrument(inst)}
                    className={`px-3 py-2 text-xs hover:bg-gray-800 cursor-pointer border-b border-gray-800 last:border-0 font-mono ${inst === currentInstrument ? 'text-white bg-gray-800' : 'text-gray-400'}`}
                  >
                      {inst}
                  </div>
              ))}
          </div>
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
                    <div className="mt-4 text-gray-400 font-sans">
                        <p className="mb-2">Upload a <strong>.gz</strong>, <strong>.json</strong>, or <strong>.log</strong> file.</p>
                        <ul className="list-disc pl-4 space-y-1">
                            <li>Supports <strong>JSON Array</strong> format.</li>
                            <li>Supports <strong>NDJSON</strong> (Newline Delimited JSON) format for log streams.</li>
                            <li>The app uses the browser's <code>DecompressionStream</code> API for .gz files.</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};