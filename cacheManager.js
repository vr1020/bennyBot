const fs = require('fs').promises;
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir() {
    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating cache directory:', error);
    }
}

/**
 * Get cache filepath for a server
 */
function getCacheFilePath(guildId) {
    return path.join(CACHE_DIR, `emotes_${guildId}.json`);
}

/**
 * Load cached emote data for a server
 * Returns null if cache doesn't exist
 */
async function loadCache(guildId) {
    try {
        const filePath = getCacheFilePath(guildId);
        const data = await fs.readFile(filePath, 'utf8');
        const cache = JSON.parse(data);

        // Validate cache structure
        if (!cache.timestamp || !cache.data) {
            console.log(`Invalid cache structure for guild ${guildId}`);
            return null;
        }

        return cache;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(`Error loading cache for guild ${guildId}:`, error.message);
        }
        return null;
    }
}

/**
 * Check if cache is not expired
 */
function isCacheValid(cache, maxAgeMs = CACHE_EXPIRY_MS) {
    if (!cache || !cache.timestamp) return false;

    const age = Date.now() - cache.timestamp;
    return age < maxAgeMs;
}

/**
 * Save emote analysis results to cache
 */
async function saveCache(guildId, analysisResults) {
    try {
        await ensureCacheDir();

        const cacheData = {
            timestamp: Date.now(),
            guildId: guildId,
            data: {
                emotes: analysisResults.emotes,
                totalMessagesScanned: analysisResults.totalMessagesScanned,
                totalEmotes: analysisResults.totalEmotes,
                channelCount: analysisResults.channelCount
            }
        };

        const filePath = getCacheFilePath(guildId);
        await fs.writeFile(filePath, JSON.stringify(cacheData, null, 2), 'utf8');

        console.log(`Cache saved for guild ${guildId}`);
        return true;
    } catch (error) {
        console.error(`Error saving cache for guild ${guildId}:`, error);
        return false;
    }
}

/**
 * Delete cache for a specific server
 */
async function clearCache(guildId) {
    try {
        const filePath = getCacheFilePath(guildId);
        await fs.unlink(filePath);
        console.log(`Cache cleared for guild ${guildId}`);
        return true;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(`Error clearing cache for guild ${guildId}:`, error);
        }
        return false;
    }
}

/**
 * Get cache age in a human-readable format
 */
function getCacheAge(cache) {
    if (!cache || !cache.timestamp) return 'unknown';

    const ageMs = Date.now() - cache.timestamp;
    const ageMinutes = Math.floor(ageMs / (60 * 1000));
    const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    if (ageDays > 0) return `${ageDays} day(s)`;
    if (ageHours > 0) return `${ageHours} hour(s)`;
    if (ageMinutes > 0) return `${ageMinutes} minute(s)`;
    return 'just now';
}

module.exports = {
    loadCache,
    saveCache,
    clearCache,
    isCacheValid,
    getCacheAge,
    CACHE_EXPIRY_MS
};
