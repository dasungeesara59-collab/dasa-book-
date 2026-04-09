# Standalone Bookmap Pro

This is a standalone extraction of the Bookmap/Heatmap feature from the AI Trading Bot dashboard. It provides a real-time, high-precision liquidity visualization using Binance Futures data.

## Features
- **Real-time Heatmap:** Visualizes liquidity walls and trade bubbles.
- **Precision DOM:** High-speed Depth of Market sidebar.
- **Pro Mode:** Fullscreen immersive view with floating controls.
- **Customizable:** Adjust heat sensitivity, bubble scale, and timeframes.

## How to Use
1. Clone this repository.
2. Open `index.html` in any modern web browser.

## Connectivity Note
The heatmap fetches live trade and depth data directly from Binance via WebSockets. However, some advanced features like **Historical Heatmap Data** and **Absorption Zones** require the bot's backend API to be running locally (usually at `http://localhost:PORT`).

If the backend is not running, you will still see live updates, but historical data may be limited.

## GitHub Publication
This folder is ready to be pushed to your own GitHub repository.
1. Create a new repository on GitHub.
2. Run the following commands in this folder:
   ```bash
   git remote add origin <your-repo-url>
   git branch -M main
   git push -u origin main
   ```
