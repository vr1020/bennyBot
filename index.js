const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const config = require('./config.js');

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildEmojisAndStickers,
    ]
});

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
        // Get options (with defaults)
        const messagesToScan = interaction.options.getInteger('messages') || 10000;
        const specificChannel = interaction.options.getChannel('channel');
        const showTop = interaction.options.getInteger('show_top') || 5;

        // Build initial response message
        let initialMsg = 'Analyzing emote usage... This may take a moment!\n';
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
            await interaction.editReply(`Error analyzing emotes: ${error.message}`);
        }
    }
});

// Log in to Discord with your client's token
client.login(config.token);
