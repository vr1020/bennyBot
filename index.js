const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('./config.js');
const fs = require('fs').promises;
const path = require('path');

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildEmojisAndStickers,
    ]
});

// Rate limiting: Track active analysis operations per guild
const activeAnalysis = new Map(); // guildId -> { userId, startTime }

// Cooldown tracking: Prevent spam (per user per guild)
const cooldowns = new Map(); // `${guildId}-${userId}` -> timestamp
const COOLDOWN_TIME = 30000; // 30 seconds between commands per user

// Persistent statistics configuration
const STATS_DIR = path.join(__dirname, 'emote-stats');
const CHECKPOINT_INTERVAL = 10000; // Save checkpoint every 10k messages

// Pinned messages configuration
const PINS_DIR = path.join(__dirname, 'pins');

// Helper function to ensure stats directory exists
async function ensureStatsDir() {
    try {
        await fs.mkdir(STATS_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating stats directory:', error);
    }
}

// Helper function to get stats file path for a guild
function getStatsFilePath(guildId) {
    return path.join(STATS_DIR, `${guildId}.json`);
}

// Helper function to load existing stats from file
async function loadStats(guildId) {
    try {
        const filePath = getStatsFilePath(guildId);
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

// Helper function to save stats to file
async function saveStats(guildId, stats) {
    try {
        await ensureStatsDir();
        const filePath = getStatsFilePath(guildId);
        await fs.writeFile(filePath, JSON.stringify(stats, null, 2), 'utf8');
        console.log(`Saved statistics to ${filePath}`);
    } catch (error) {
        console.error('Error saving stats:', error);
        throw error;
    }
}

// Helper function to save checkpoint during scanning
async function saveCheckpoint(guildId, emoteUsage, totalMessagesScanned, lastMessageId, channelCount, oldestMessageId = null) {
    const emoteData = Array.from(emoteUsage.values()).map(e => ({
        name: e.name,
        id: e.id,
        animated: e.animated,
        count: e.count
    }));

    const checkpoint = {
        guildId,
        lastUpdated: new Date().toISOString(),
        totalMessagesScanned,
        lastMessageId,
        oldestMessageId, // Track the oldest message ID we've scanned (for multi-channel persist)
        channelCount,
        emoteData
    };

    await saveStats(guildId, checkpoint);
}

// Helper function to delete stats file
async function deleteStats(guildId) {
    try {
        const filePath = getStatsFilePath(guildId);
        await fs.unlink(filePath);
        console.log(`Deleted statistics file for guild ${guildId}`);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File doesn't exist, that's fine
            return false;
        }
        throw error;
    }
}

// Helper function to ensure pins directory exists
async function ensurePinsDir() {
    try {
        await fs.mkdir(PINS_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating pins directory:', error);
    }
}

// Helper function to get pins file path for a guild
function getPinsFilePath(guildId) {
    return path.join(PINS_DIR, `${guildId}.json`);
}

// Helper function to load existing pins from file
async function loadPins(guildId) {
    try {
        const filePath = getPinsFilePath(guildId);
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File doesn't exist, return empty array
            return [];
        }
        throw error;
    }
}

// Helper function to save a pinned message
async function savePinnedMessage(guildId, messageData) {
    try {
        await ensurePinsDir();

        // Load existing pins
        const pins = await loadPins(guildId);

        // Add new pin with timestamp
        const pin = {
            messageId: messageData.id,
            channelId: messageData.channelId,
            content: messageData.content,
            author: {
                id: messageData.author.id,
                username: messageData.author.username,
                tag: messageData.author.tag
            },
            timestamp: messageData.createdAt.toISOString(),
            pinnedAt: new Date().toISOString(),
            pinnedBy: messageData.pinnedBy,
            messageUrl: messageData.url
        };

        pins.push(pin);

        // Save back to file
        const filePath = getPinsFilePath(guildId);
        await fs.writeFile(filePath, JSON.stringify(pins, null, 2), 'utf8');

        console.log(`Saved pinned message ${messageData.id} for guild ${guildId}`);
        return pin;
    } catch (error) {
        console.error('Error saving pinned message:', error);
        throw error;
    }
}

// Helper function to parse date string to Discord snowflake ID
function parseDateToSnowflake(dateString) {
    // Support multiple date formats: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY
    let dateMatch;
    let year, month, day;

    // Try YYYY-MM-DD format first
    dateMatch = dateString.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (dateMatch) {
        [, year, month, day] = dateMatch;
    } else {
        // Try DD/MM/YYYY or DD-MM-YYYY format
        dateMatch = dateString.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
        if (dateMatch) {
            [, day, month, year] = dateMatch;
        }
    }

    if (!dateMatch) {
        throw new Error('Invalid date format. Use YYYY-MM-DD, DD/MM/YYYY, or DD-MM-YYYY');
    }

    year = parseInt(year, 10);
    month = parseInt(month, 10);
    day = parseInt(day, 10);

    if (month < 1 || month > 12) {
        throw new Error('Month must be between 1 and 12');
    }
    if (day < 1 || day > 31) {
        throw new Error('Day must be between 1 and 31');
    }

    const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

    // Validate
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw new Error('Invalid date (day does not exist in that month)');
    }

    // Convert to Discord snowflake
    // Discord epoch: January 1, 2015 00:00:00 UTC
    // e.g. Convert the date to a snowflake that represents "the earliest message ID that could exist on Jan 1, 2024"
    const DISCORD_EPOCH = 1420070400000;
    const timestamp = date.getTime() - DISCORD_EPOCH;

    if (timestamp < 0) {
        throw new Error('Date must be after January 1, 2015 (Discord launch date)');
    }

    // Snowflake format: timestamp (ms since Discord epoch) * 2^22
    // Multiplying by 4194304 (2^22) places the timestamp in bits 63-22,
    // with the lower 22 bits set to 0, giving us the earliest possible
    // snowflake ID for that timestamp
    const snowflake = (BigInt(timestamp) * 4194304n).toString();

    return snowflake;
}

// Helper function to analyze emote usage
async function analyzeEmoteUsage(guild, messagesToScan = 10000, specificChannel = null, persist = false, untilSnowflake = null) {
    console.log('Starting emote analysis...');

    // Determine if this is a date-based scan
    const isDateBased = untilSnowflake !== null;

    // Get all custom emotes from the server
    const guildEmotes = guild.emojis.cache;
    console.log(`Found ${guildEmotes.size} custom emotes in the server`);

    // Load existing stats only if persist mode is enabled
    let existingStats = null;
    let lastScannedMessageId = null;
    let previousMessagesScanned = 0;
    let oldestScannedMessageId = null;

    if (persist) {
        existingStats = await loadStats(guild.id);
        if (existingStats) {
            lastScannedMessageId = existingStats.lastMessageId;
            oldestScannedMessageId = existingStats.oldestMessageId;
            previousMessagesScanned = existingStats.totalMessagesScanned || 0;
            console.log(`Loaded existing stats: ${previousMessagesScanned} messages, oldest ID: ${oldestScannedMessageId}`);
        }
    }

    // Initialize emote usage counter
    const emoteUsage = new Map();
    guildEmotes.forEach(emote => {
        emoteUsage.set(emote.id, {
            name: emote.name,
            id: emote.id,
            animated: emote.animated,
            count: 0,
            emote: emote
        });
    });

    // Restore existing counts if in persist mode
    if (existingStats && existingStats.emoteData) {
        existingStats.emoteData.forEach(emoteData => {
            if (emoteUsage.has(emoteData.id)) {
                emoteUsage.get(emoteData.id).count = emoteData.count;
            }
        });
    }

    // Get channels to scan
    let channels;
    if (specificChannel) {
        channels = new Map([[specificChannel.id, specificChannel]]);
    } else {
        channels = guild.channels.cache.filter(
            channel => channel.type === ChannelType.GuildText
        );
    }

    console.log(`Scanning ${channels.size} text channel(s)...`);

    let totalMessagesScanned = 0;
    let newMessagesScanned = 0;
    let remainingMessages = messagesToScan; // Track total remaining messages across all channels
    let currentOldestMessageId = oldestScannedMessageId; // Track oldest message across this scan
    let finalLastMessageId = lastScannedMessageId; // Track the last message ID for single-channel persistence

    // Scan messages in each channel
    for (const [channelId, channel] of channels) {
        try {
            console.log(`Fetching messages from #${channel.name}...`);

            // For single-channel persist mode, use saved position
            // For multi-channel scans, each channel starts fresh (we use date cutoff instead)
            let lastMessageId = (persist && specificChannel) ? lastScannedMessageId : null;

            // Fetch messages in batches of 100 (Discord API limit)
            while (remainingMessages > 0) {
                const fetchLimit = Math.min(remainingMessages, 100);
                const fetchOptions = { limit: fetchLimit };

                if (lastMessageId) {
                    fetchOptions.before = lastMessageId;
                }

                try {
                    const messages = await channel.messages.fetch(fetchOptions);

                    if (messages.size === 0) break; // No more messages in channel

                    // if date based scan filter by snowflake time
                    let filteredMessages = messages;
                    if (isDateBased) {
                        filteredMessages = messages.filter(msg => msg.id >= untilSnowflake);

                        if (filteredMessages.size === 0) {
                            console.log(`Reached cutoff date in #${channel.name}`);
                            break;
                        }
                    }

                    newMessagesScanned += filteredMessages.size;
                    totalMessagesScanned = previousMessagesScanned + newMessagesScanned;
                    // Decrement by filtered count, not fetched count
                    // This ensures "scan 10k messages" means 10k messages after date cutoff
                    remainingMessages -= filteredMessages.size;
                    lastMessageId = messages.last().id;

                    // Track the last message ID to resume single-channel persistent scan
                    if (specificChannel) {
                        finalLastMessageId = lastMessageId;
                    }

                    // Track the oldest message ID we've seen (for multi-channel persist)
                    if (!currentOldestMessageId || lastMessageId < currentOldestMessageId) {
                        currentOldestMessageId = lastMessageId;
                    }

                    // Scan each message for emote usage
                    filteredMessages.forEach(msg => {
                        // Custom emote format: <:emoteName:emoteId> or <a:emoteName:emoteId> for animated
                        const emoteRegex = /<a?:(\w+):(\d+)>/g;
                        let match;

                        while ((match = emoteRegex.exec(msg.content)) !== null) {
                            const emoteId = match[2];
                            if (emoteUsage.has(emoteId)) {
                                emoteUsage.get(emoteId).count++;
                            }
                        }
                    });

                    // Save checkpoint every CHECKPOINT_INTERVAL messages when in persist mode
                    if (persist && newMessagesScanned > 0 && newMessagesScanned % CHECKPOINT_INTERVAL === 0) {
                        // For single-channel persist, save the actual lastMessageId to resume from
                        // For multi-channel persist, save null (we use oldestMessageId cutoff instead)
                        const checkpointLastMessageId = specificChannel ? lastMessageId : null;
                        await saveCheckpoint(guild.id, emoteUsage, totalMessagesScanned, checkpointLastMessageId, channels.size, currentOldestMessageId);
                        console.log(`Checkpoint saved at ${totalMessagesScanned} messages`);
                    }

                    // If we got fewer messages than requested, we've reached the end
                    if (messages.size < fetchLimit) break;

                    // For date-based scans, if we got messages older than the cutoff, we're done
                    if (isDateBased && filteredMessages.size < messages.size) {
                        console.log(`Reached cutoff date in #${channel.name} (partial batch)`);
                        break;
                    }

                    // Small delay to avoid hitting rate limits too hard (only if fetching more)
                    if (remainingMessages > 0) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                } catch (fetchError) {
                    // Handle rate limiting with exponential backoff
                    if (fetchError.code === 429) {
                        const retryAfter = fetchError.retry_after || 1;
                        console.log(`Rate limited on #${channel.name}, waiting ${retryAfter}s...`);
                        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                        continue;
                    } else {
                        console.log(`Error fetching batch from #${channel.name}: ${fetchError.message}`);
                        break;
                    }
                }
            }
        } catch (error) {
            console.log(`Could not fetch messages from #${channel.name}: ${error.message}`);
        }
    }

    console.log(`Scanned ${totalMessagesScanned} messages total (${newMessagesScanned} new)`);

    // Save final checkpoint if in persist mode
    if (persist && newMessagesScanned > 0) {
        // For single-channel persist, save the last message ID to resume from that point
        // For multi-channel persist, save null (we rely on oldestMessageId cutoff instead)
        const savedLastMessageId = specificChannel ? finalLastMessageId : null;
        await saveCheckpoint(guild.id, emoteUsage, totalMessagesScanned, savedLastMessageId, channels.size, currentOldestMessageId);
        console.log(`Final checkpoint saved at ${totalMessagesScanned} messages`);
    }

    // Sort emotes by usage count (ascending - least used first)
    const sortedEmotes = Array.from(emoteUsage.values())
        .sort((a, b) => a.count - b.count);

    return {
        emotes: sortedEmotes,
        totalMessagesScanned,
        newMessagesScanned,
        totalEmotes: guildEmotes.size,
        channelCount: channels.size,
        persist
    };
}

// When the client is ready, run this code (only once)
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Bot is ready and online!`);
});

// Listen for slash commands
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'ping') {
        await interaction.reply('Pong!');
    } else if (commandName === 'hello') {
        await interaction.reply(`Hello ${interaction.user.username}!`);
    } else if (commandName === 'emote-stats-reset') {
        const guildId = interaction.guild.id;

        // Check if user has permission to reset stats
        const member = interaction.member;
        const hasPermission = member.permissions.has(PermissionFlagsBits.ManageGuild) ||
                            member.permissions.has(PermissionFlagsBits.Administrator);

        if (!hasPermission) {
            return await interaction.reply({
                content: 'Resetting statistics requires "Manage Server" permission.',
                ephemeral: true
            });
        }

        try {
            const existingStats = await loadStats(guildId);
            const hadStats = await deleteStats(guildId);

            if (hadStats) {
                let response = '**Statistics Reset**\n';
                response += `Cleared previous scan of ${existingStats.totalMessagesScanned.toLocaleString()} messages.\n`;
                response += 'Next `/emote-stats` command will start fresh.';
                await interaction.reply(response);
            } else {
                await interaction.reply({
                    content: 'No existing statistics found. Already starting fresh!',
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error('Error resetting stats:', error);
            await interaction.reply({
                content: 'Error resetting statistics. Please try again.',
                ephemeral: true
            });
        }
    } else if (commandName === 'emote-stats') {
        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        const cooldownKey = `${guildId}-${userId}`;

        if (activeAnalysis.has(guildId)) {
            const active = activeAnalysis.get(guildId);
            return await interaction.reply({
                content: `An analysis is already running in this server (started by <@${active.userId}>). Please wait for it to complete.`,
                ephemeral: true
            });
        }

        if (cooldowns.has(cooldownKey)) {
            const expirationTime = cooldowns.get(cooldownKey) + COOLDOWN_TIME;
            const timeLeft = Math.ceil((expirationTime - Date.now()) / 1000);

            if (Date.now() < expirationTime) {
                return await interaction.reply({
                    content: `Please wait ${timeLeft} more second(s) before using this command again.`,
                    ephemeral: true
                });
            }
        }

        // Get options (with defaults)
        const specificChannel = interaction.options.getChannel('channel');
        const showTop = interaction.options.getInteger('show_top') || 5;
        const minUsage = interaction.options.getInteger('min_usage') ?? 0;
        let persist = interaction.options.getBoolean('persist') || false;
        const untilDateStr = interaction.options.getString('until_date');

        // Parse date if provided
        let untilSnowflake = null;
        if (untilDateStr) {
            try {
                untilSnowflake = parseDateToSnowflake(untilDateStr);
            } catch (error) {
                return await interaction.reply({
                    content: `Invalid date: ${error.message}`,
                    ephemeral: true
                });
            }
        }

        // If until_date is provided and no message count specified, scan unlimited (up to the date)
        // Otherwise use the specified message count or default to 10000
        let messagesToScan;
        if (untilDateStr && !interaction.options.getInteger('messages')) {
            messagesToScan = Number.MAX_SAFE_INTEGER; // Effectively unlimited, will stop at date cutoff
        } else {
            messagesToScan = interaction.options.getInteger('messages') || 10000;
        }


        // Validate message count limits
        const MAX_TRANSIENT_SCAN = 50000;
        const BATCH_SIZE = 50000; // Process in 50k chunks

        // For non-persistent scans without a date cutoff, enforce max limit
        if (!persist && !untilDateStr && messagesToScan > MAX_TRANSIENT_SCAN) {
            return await interaction.reply({
                content: `Transient scans are limited to ${MAX_TRANSIENT_SCAN.toLocaleString()} messages.\n` +
                        `Use \`persist:true\` or \`until_date\` to scan more messages.`,
                ephemeral: true
            });
        }

        // Permission check for large scans (>20k messages) - skip for date-based scans
        if (messagesToScan > 20000 && !untilDateStr) {
            const member = interaction.member;
            const hasPermission = member.permissions.has(PermissionFlagsBits.ManageGuild) ||
                                member.permissions.has(PermissionFlagsBits.Administrator);

            if (!hasPermission) {
                return await interaction.reply({
                    content: 'Scanning more than 20,000 messages requires "Manage Server" permission to prevent abuse.\n' +
                            'Alternatively, use `until_date` to scan up to a specific date.',
                    ephemeral: true
                });
            }
        }

        // Set cooldown
        cooldowns.set(cooldownKey, Date.now());
        setTimeout(() => cooldowns.delete(cooldownKey), COOLDOWN_TIME);

        // Mark analysis as active
        activeAnalysis.set(guildId, { userId, startTime: Date.now() });

        // Build initial response message
        let initialMsg = 'Analyzing emote usage... This may take a moment!\n';

        // Calculate batches if this is a large persistent scan
        // For unlimited date scans, don't calculate batch count (it would be huge)
        const isUnlimitedDateScan = untilDateStr && messagesToScan === Number.MAX_SAFE_INTEGER;
        const totalBatches = (!isUnlimitedDateScan && persist) ? Math.ceil(messagesToScan / BATCH_SIZE) : 1;
        const isBatchedScan = totalBatches > 1;

        if (isUnlimitedDateScan) {
            initialMsg += `Scanning all messages until ${untilDateStr}`;
        } else if (isBatchedScan) {
            initialMsg += `Scanning ${messagesToScan.toLocaleString()} messages in ${totalBatches} batches`;
        } else {
            initialMsg += `Scanning up to ${messagesToScan.toLocaleString()} messages`;
        }

        if (specificChannel) {
            initialMsg += ` in ${specificChannel}`;
        } else {
            initialMsg += ' across all channels';
        }
        if (untilSnowflake && messagesToScan !== Number.MAX_SAFE_INTEGER) {
            initialMsg += ` until ${untilDateStr}`;
        }
        if (persist) {
            initialMsg += '\n_Persistent mode: Stats will be saved and continued from your last scan_';
        }
        initialMsg += '...';

        await interaction.reply(initialMsg);

        try {
            let allResults = null;
            let remainingMessages = messagesToScan;
            let batchNumber = 0;

            // Process in batches
            while (remainingMessages > 0) {
                batchNumber++;
                const batchSize = Math.min(remainingMessages, BATCH_SIZE);

                if (isBatchedScan) {
                    await interaction.editReply(
                        initialMsg + `\n\n**Batch ${batchNumber}/${totalBatches}**: Processing ${batchSize.toLocaleString()} messages...`
                    );
                }

                const results = await analyzeEmoteUsage(
                    interaction.guild,
                    batchSize,
                    specificChannel,
                    persist,
                    untilSnowflake
                );

                allResults = results;
                remainingMessages -= batchSize;

                // Break if we didn't get any new messages (hit the end of history)
                if (results.newMessagesScanned === 0) {
                    if (isBatchedScan) {
                        await interaction.editReply(
                            initialMsg + `\n\n**Reached end of message history** after batch ${batchNumber}/${totalBatches}`
                        );
                    }
                    break;
                }
            }

            // Use the final results from the last batch
            if (!allResults) {
                throw new Error('No results from scan');
            }

            // Filter by minimum usage and get least used emotes
            const filteredEmotes = allResults.emotes.filter(emote => emote.count >= minUsage);
            const leastUsed = filteredEmotes.slice(0, showTop);

            // Build response message
            let response = `**Emote Usage Analysis**\n`;
            if (isBatchedScan) {
                response += `Completed ${batchNumber} batch(es)\n`;
            }
            response += `Scanned ${allResults.totalMessagesScanned.toLocaleString()} messages`;
            if (allResults.persist && allResults.newMessagesScanned !== allResults.totalMessagesScanned) {
                response += ` (${allResults.newMessagesScanned.toLocaleString()} new)`;
            }
            if (specificChannel) {
                response += ` in ${specificChannel}`;
            } else {
                response += ` across ${allResults.channelCount} channel(s)`;
            }
            response += `\nTotal emotes in server: ${allResults.totalEmotes}`;
            if (minUsage > 0) {
                response += `\nFiltered to emotes with ≥${minUsage} use(s): ${filteredEmotes.length} emote(s)`;
            }
            if (allResults.persist) {
                response += `\n_Stats saved - run again with persist:true to scan deeper_`;
            }
            response += `\n\n**Top ${showTop} LEAST Used Emotes:**\n`;

            if (leastUsed.length === 0) {
                response += minUsage > 0
                    ? `No emotes found with at least ${minUsage} use(s).`
                    : 'No emotes found in this server.';
            } else {
                leastUsed.forEach((emote, index) => {
                    const emoteDisplay = emote.animated
                        ? `<a:${emote.name}:${emote.id}>`
                        : `<:${emote.name}:${emote.id}>`;
                    response += `${index + 1}. ${emoteDisplay} \`:${emote.name}:\` - Used ${emote.count} time(s)\n`;
                });
            }

            await interaction.editReply(response);
        } catch (error) {
            console.error('Error analyzing emotes:', error);

            // Handle specific Discord API errors
            let errorMessage = 'Error analyzing emotes: ';
            if (error.code === 50013) {
                errorMessage += 'Missing permissions to read messages in some channels.';
            } else if (error.code === 429) {
                errorMessage += 'Rate limited by Discord. Please try again later.';
            } else if (error.message.includes('time')) {
                errorMessage += 'Operation timed out. Try scanning fewer messages or a specific channel.';
            } else {
                errorMessage += error.message;
            }

            await interaction.editReply(errorMessage).catch(console.error);
        } finally {
            // Always cleanup: Remove active analysis marker
            activeAnalysis.delete(guildId);
        }
    }
});

// Log in to Discord with your client's token
client.login(config.token);
