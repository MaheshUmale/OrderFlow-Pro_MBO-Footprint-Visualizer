# Upstox V3 Live Feed Setup

This project uses a **Node.js Bridge** to connect to the Upstox V3 WebSocket API, as the browser cannot easily handle the Protobuf decoding and CORS requirements directly.

## Prerequisites

1.  **Node.js** installed.
2.  **Upstox Account** and **Access Token**.

## Setup Instructions

1.  **Install Dependencies**
    Open your terminal in the project root and run:
    ```bash
    npm install ws protobufjs upstox-js-sdk axios
    ```

2.  **Download Proto File**
    You need the `market_data_feed.proto` file from Upstox.
    *   Download it from: [Upstox NodeJS SDK Examples](https://github.com/upstox/upstox-nodejs/blob/master/examples/websocket/market_data/v3/market_data_feed.proto)
    *   Save it as `market_data_feed.proto` in the **root directory** of this project.

3.  **Run the Bridge**
    ```bash
    node server/upstox-bridge.js
    ```
    You should see: `Bridge Server running on ws://localhost:4000`

4.  **Connect Frontend**
    *   Open the Web App.
    *   Click the **Connect Live** button in the Control Panel.
    *   Enter your **Upstox Access Token**.
    *   Click **Connect**.

## How it Works

1.  The **Frontend** connects to the local bridge (`ws://localhost:4000`).
2.  It sends your Access Token to the bridge.
3.  The **Bridge** authenticates with Upstox API to get a secure WebSocket URL.
4.  The **Bridge** connects to Upstox and receives binary Protobuf data.
5.  The **Bridge** decodes the binary data into JSON.
6.  The **Bridge** forwards the JSON to the Frontend.
7.  The **Frontend** visualizes the data (Footprint, Heatmap, DOM).
