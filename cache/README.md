# Cache Directory

This directory stores cached emote analysis results for each Discord server (guild).

## Cache Files

- Files are named: `emotes_{guildId}.json`
- Each file contains:
  - Timestamp of when the scan was performed
  - Emote usage data (counts, names, IDs)
  - Total messages scanned
  - Number of channels analyzeds

## Cache Expiration

- Cached data is valid for **24 hours** by default
- After 24 hours, the bot will automatically perform a fresh scan
- Users can force a fresh scan anytime with `/emote-stats rescan:true`

## How It Works

1. First `/emote-stats` command → Scans messages, saves to cache
2. Subsequent commands (within 24h) → Returns cached data instantly
3. After 24h or with `rescan:true` → Fresh scan, updates cache

## File Management

- Cache files are automatically created and updated
- This directory is git-ignored (cache files won't be committed)
- Safe to delete cache files manually if needed - they'll be regenerated on next scan