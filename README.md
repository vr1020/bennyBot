# BennyBot

A Discord bot that analyzes custom emote usage in servers to help identify underused emotes.

## Features

- `/emote-stats` - Analyze custom emote usage with configurable options
- `/ping` - Health check
- `/hello` - Friendly greeting

## Setup & Deployment

### Prerequisites

- Node.js (v16 or higher)
- A Discord Bot Token and Client ID
- Bot must have these permissions in your Discord server:
  - Read Messages/View Channels
  - Send Messages
  - Read Message History
  - Use External Emojis

### Installation

1. **Clone or pull this branch:**
   ```bash
   git clone <repo-url>
   cd bennyBot
   git checkout mvp-impl
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Deploy slash commands to Discord:**
   ```bash
   npm run deploy
   ```

4. **Start the bot:**
   ```bash
   npm start
   ```

### Usage

Once the bot is running and invited to your server:

- **Basic usage:**
  - `/emote-stats` - Analyzes 10,000 recent messages across all channels

- **Custom options:**
  - `/emote-stats messages:5000` - Scan 5,000 messages
  - `/emote-stats channel:#general` - Only analyze #general
  - `/emote-stats messages:20000 show_top:10` - Scan 20k messages, show top 10 results

## Development

- `npm start` - Start the bot
- `npm run deploy` - Deploy/update slash commands

## Configuration

Default settings in `/emote-stats`:
- Messages scanned: 10,000 (max: 50,000)
- Channels: All text channels
- Results shown: Top 5 least-used emotes (max: 25)
