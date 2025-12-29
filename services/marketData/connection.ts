
import * as state from './state';
import * as processing from './processing';

let bridgeSocket: WebSocket | null = null;

const triggerBackendSubscription = () => {
    if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) return;

    const { instrumentsCache, lastSentSubscribeKeys } = state.getState();
    const uniqueKeys = Array.from(new Set(instrumentsCache)).sort();

    const isSame = uniqueKeys.length === lastSentSubscribeKeys.length &&
                   uniqueKeys.every((value, index) => value === lastSentSubscribeKeys[index]);

    if (!isSame) {
        console.log(`[Frontend] Subscribing to ${uniqueKeys.length} instruments.`);
        state.updateStatus(`Subscribing ${uniqueKeys.length} items...`);

        bridgeSocket.send(JSON.stringify({ type: 'subscribe', instrumentKeys: uniqueKeys }));
        state.setLastSentSubscribeKeys(uniqueKeys);
    }
};

export const fetchOptionChain = (underlyingKey: string, token: string, statusCallback: (s: string) => void) => {
    if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
        alert("Server Bridge Not Connected.");
        return;
    }
    state.setOptionChain(underlyingKey, token, statusCallback);

    console.log(`[Frontend] Requesting Option Chain for: ${underlyingKey}`);
    bridgeSocket.send(JSON.stringify({ type: 'get_option_chain', instrumentKey: underlyingKey, token }));
    bridgeSocket.send(JSON.stringify({ type: 'get_quotes', instrumentKeys: [underlyingKey], token }));

    triggerBackendSubscription();
};


export const connectToBridge = (url: string, token: string) => {
    if (bridgeSocket) {
        if (bridgeSocket.readyState === WebSocket.OPEN || bridgeSocket.readyState === WebSocket.CONNECTING) {
            return;
        }
        bridgeSocket.close();
    }

    try {
        state.setConnectionStatus('CONNECTING');
        console.log(`Connecting to Bridge at ${url}`);

        bridgeSocket = new WebSocket(url);

        bridgeSocket.onopen = () => {
            console.log("Bridge Socket Open");
            const { currentInstrumentId } = state.getState();
            bridgeSocket?.send(JSON.stringify({ type: 'init', token, instrumentKeys: [currentInstrumentId] }));
        };

        bridgeSocket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);

                switch(msg.type) {
                    case 'connection_status':
                        state.setConnectionStatus(msg.status);
                        if (msg.status === 'CONNECTED') {
                            state.setLiveMode(true);
                        }
                        break;
                    case 'live_feed':
                    case 'initial_feed':
                        processing.processFeedFrame(msg);
                        break;
                    case 'option_chain_response':
                        processing.handleOptionChainData(msg.data);
                        // After handling, we likely have new instruments to subscribe to
                        triggerBackendSubscription();
                        break;
                    case 'quote_response':
                        processing.handleQuoteResponse(msg.data);
                        break;
                    case 'error':
                        console.error("Bridge Error:", msg.message);
                        state.updateStatus(`Error: ${msg.message}`);
                        alert(`Bridge Error: ${msg.message}`);
                        break;
                }
            } catch (e) {
                console.error("Parse Error", e);
            }
        };

        bridgeSocket.onclose = () => {
            state.setConnectionStatus('DISCONNECTED');
            state.setLiveMode(false);
            bridgeSocket = null;
        };

        bridgeSocket.onerror = (e) => {
            state.setConnectionStatus('ERROR');
            bridgeSocket = null;
            alert("Connection Error. Is the bridge running?");
        };

    } catch (err: any) {
        console.error("Connection Failed:", err);
        state.setConnectionStatus('ERROR');
        alert(`Failed to connect: ${err.message}`);
    }
};
