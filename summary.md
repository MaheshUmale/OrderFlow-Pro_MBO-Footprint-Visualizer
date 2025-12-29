# OrderFlow Pro Summary

This document provides a comprehensive overview of the data flow, calculation logic, and display components of the OrderFlow Pro application.

## 1. Data Flow

The application's data flow is designed to efficiently handle real-time market data from the Upstox API and deliver it to the user interface for visualization.

1.  **Upstox API:** The primary source of market data is the Upstox V3 WebSocket API, which provides real-time market data in Protocol Buffers (Protobuf) format.

2.  **Node.js Bridge (`server/upstox-bridge.js`):**
    *   Acts as a WebSocket server for the frontend and a client for the Upstox API.
    *   Handles the connection and authentication with the Upstox API.
    *   Decodes the incoming Protobuf messages into a JSON format that the frontend can understand.
    *   Forwards the decoded market data to the connected frontend clients over WebSocket.

3.  **Frontend Service (`services/marketData/state.ts`):**
    *   Establishes a WebSocket connection with the Node.js bridge.
    *   Receives the JSON-formatted market data from the bridge.
    *   Manages the application's state, including the current instrument, market data, and user preferences.
    *   Processes the incoming data and updates the application state accordingly.

4.  **React Components (`components/`):**
    *   Subscribe to the state management service to receive real-time updates.
    *   The `App.tsx` component serves as the main container, orchestrating the layout and data flow to the various display components.
    *   Display components (e.g., `MBODOM`, `FootprintChart`) render the market data in a user-friendly format.

## 2. Calculation Logic

The frontend performs several key calculations to transform raw market data into actionable insights for traders.

1.  **Footprint Chart Aggregation:**
    *   The `FootprintChart` component aggregates raw trade data into footprint bars.
    *   Each bar represents a specific time interval or volume range.
    *   Trades are grouped by price level within each bar, and the volume is split into bid and ask volumes.

2.  **Delta Calculation:**
    *   Delta is calculated for each price level within a footprint bar by subtracting the bid volume from the ask volume (`Delta = Ask Volume - Bid Volume`).
    *   The total delta for the bar is the sum of the deltas at each price level.

3.  **Cumulative Volume Delta (CVD):**
    *   CVD is a running total of the delta, providing a cumulative measure of buying and selling pressure over time.

4.  **Trade Signal Generation:**
    *   The application generates real-time trading signals based on order flow patterns, such as:
        *   **Absorption:** Large volume traded at a price level without significant price movement.
        *   **Momentum:** A rapid price movement accompanied by a surge in volume and delta.
        *   **Imbalance:** A significant difference between the bid and ask volume at a specific price level.

## 3. Display Components

The user interface is composed of several specialized components, each designed to visualize a specific aspect of the market data.

1.  **`ControlPanel.tsx`:**
    *   Provides controls for connecting to the market data feed, selecting instruments, and configuring application settings.

2.  **`MBODOM.tsx` (Market-By-Order Depth of Market):**
    *   Displays the order book with individual order queue positions.
    *   Visualizes market depth and liquidity at different price levels.

3.  **`FootprintChart.tsx`:**
    *   The core component for order flow analysis.
    *   Displays footprint bars with detailed information on volume, delta, and trade imbalances at each price level.

4.  **`HeatmapWidget.tsx`:**
    *   Visualizes historical liquidity and order flow as a heatmap, similar to Bookmap.
    *   Helps identify areas of high liquidity and potential support/resistance levels.

5.  **`TradeAnalysis.tsx`:**
    *   Displays real-time trade signals and analysis based on the order flow data.
    *   Provides insights into market dynamics, such as absorption, momentum, and trapped traders.
