const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('./config.js');
const { loadCache, saveCache, isCacheValid, getCacheAge } = require('./cacheManager.js');
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
async function saveCheckpoint(guildId, emoteUsage, totalMessagesScanned, lastMessageId, channelCount) {
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

// Helper function to analyze emote usage
async function analyzeEmoteUsage(guild, messagesToScan = 10000, specificChannel = null) {
    console.log('Starting emote analysis...');

    // Get all custom emotes from the server
    const guildEmotes = guild.emojis.cache;
    console.log(`Found ${guildEmotes.size} custom emotes in the server`);

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
    const messagesPerChannel = Math.ceil(messagesToScan / channels.size);

    // Scan messages in each channel
    for (const [channelId, channel] of channels) {
        try {
            console.log(`Fetching messages from #${channel.name}...`);

            let remainingMessages = messagesPerChannel;
            let lastMessageId = null;

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

                    totalMessagesScanned += messages.size;
                    remainingMessages -= messages.size;
                    lastMessageId = messages.last().id;

                    // Scan each message for emote usage
                    messages.forEach(msg => {
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

                    // If we got fewer messages than requested, we've reached the end
                    if (messages.size < fetchLimit) break;

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

    console.log(`Scanned ${totalMessagesScanned} messages total`);

    // Sort emotes by usage count (ascending - least used first)
    const sortedEmotes = Array.from(emoteUsage.values())
        .sort((a, b) => a.count - b.count);

    return {
        emotes: sortedEmotes,
        totalMessagesScanned,
        totalEmotes: guildEmotes.size,
        channelCount: channels.size
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
        const messagesToScan = interaction.options.getInteger('messages') || 10000;
        const specificChannel = interaction.options.getChannel('channel');
        const showTop = interaction.options.getInteger('show_top') || 5;
        const forceRescan = interaction.options.getBoolean('rescan') || false;

        // Permission check for large scans (>20k messages)
        if (messagesToScan > 20000) {
            const member = interaction.member;
            const hasPermission = member.permissions.has(PermissionFlagsBits.ManageGuild) ||
                                member.permissions.has(PermissionFlagsBits.Administrator);

            if (!hasPermission) {
                return await interaction.reply({
                    content: 'Scanning more than 20,000 messages requires "Manage Server" permission to prevent abuse.',
                    ephemeral: true
                });
            }
        }

        // Check cache first (unless force rescan is requested)
        if (!forceRescan) {
            const cache = await loadCache(guildId);
            if (cache && isCacheValid(cache)) {
                console.log(`Using cached data for guild ${guildId} (age: ${getCacheAge(cache)})`);

                // Return cached results
                const results = cache.data;
                const leastUsed = results.emotes.slice(0, showTop);

                let response = `**Emote Usage Analysis** (from cache - ${getCacheAge(cache)} old)\n`;
                response += `Scanned ${results.totalMessagesScanned.toLocaleString()} messages across ${results.channelCount} channel(s)\n`;
                response += `Total emotes in server: ${results.totalEmotes}\n\n`;
                response += `**Top ${showTop} LEAST Used Emotes:**\n`;

                if (leastUsed.length === 0) {
                    response += 'No emotes found in this server.';
                } else {
                    leastUsed.forEach((emote, index) => {
                        const emoteDisplay = emote.animated
                            ? `<a:${emote.name}:${emote.id}>`
                            : `<:${emote.name}:${emote.id}>`;
                        response += `${index + 1}. ${emoteDisplay} \`:${emote.name}:\` - Used ${emote.count} time(s)\n`;
                    });
                }

                response += `\n*Tip: Use \`rescan:true\` to force a fresh scan*`;

                return await interaction.reply(response);
            }
        }

        // Set cooldown
        cooldowns.set(cooldownKey, Date.now());
        setTimeout(() => cooldowns.delete(cooldownKey), COOLDOWN_TIME);

        // Mark analysis as active
        activeAnalysis.set(guildId, { userId, startTime: Date.now() });

        // Build initial response message
        let initialMsg = forceRescan
            ? 'Forcing fresh scan... This may take a moment!\n'
            : 'Analyzing emote usage... This may take a moment!\n';
        initialMsg += `Scanning up to ${messagesToScan.toLocaleString()} messages`;
        if (specificChannel) {
            initialMsg += ` in ${specificChannel}`;
        } else {
            initialMsg += ' across all channels';
        }
        initialMsg += '...';

        await interaction.reply(initialMsg);

        try {
            const results = await analyzeEmoteUsage(
                interaction.guild,
                messagesToScan,
                specificChannel
            );

            // Save results to cache
            await saveCache(guildId, results);

            // Get least used emotes
            const leastUsed = results.emotes.slice(0, showTop);

            // Build response message
            let response = `**Emote Usage Analysis**\n`;
            response += `Scanned ${results.totalMessagesScanned.toLocaleString()} messages`;
            if (specificChannel) {
                response += ` in ${specificChannel}`;
            } else {
                response += ` across ${results.channelCount} channel(s)`;
            }
            response += `\nTotal emotes in server: ${results.totalEmotes}\n\n`;
            response += `**Top ${showTop} LEAST Used Emotes:**\n`;

            if (leastUsed.length === 0) {
                response += 'No emotes found in this server.';
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
