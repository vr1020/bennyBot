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
async function analyzeEmoteUsage(guild, messagesToScan = 1000) {
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

    // Get all text channels in the guild
    const channels = guild.channels.cache.filter(
        channel => channel.type === ChannelType.GuildText
    );

    console.log(`Scanning ${channels.size} text channels...`);

    let totalMessagesScanned = 0;
    const messagesPerChannel = Math.ceil(messagesToScan / channels.size);

    // Scan messages in each channel
    for (const [channelId, channel] of channels) {
        try {
            console.log(`Fetching messages from #${channel.name}...`);

            // Fetch messages (max 100 per request)
            const messages = await channel.messages.fetch({ limit: Math.min(messagesPerChannel, 100) });
            totalMessagesScanned += messages.size;

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
        totalEmotes: guildEmotes.size
    };
}

// When the client is ready, run this code (only once)
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Bot is ready and online!`);
});

// Listen for messages
client.on('messageCreate', async (message) => {
    // Ignore messages from bots
    if (message.author.bot) return;

    // Simple ping command
    if (message.content === '!ping') {
        await message.reply('Pong!');
    }

    // Simple hello command
    if (message.content === '!hello') {
        await message.reply(`Hello ${message.author.username}!`);
    }

    // Emote statistics command
    if (message.content === '!emote-stats') {
        await message.reply('Analyzing emote usage... This may take a moment!');

        try {
            const results = await analyzeEmoteUsage(message.guild);

            // Get top 5 least used emotes
            const leastUsed = results.emotes.slice(0, 5);

            // Build response message
            let response = `**Emote Usage Analysis**\n`;
            response += `Scanned ${results.totalMessagesScanned} messages\n`;
            response += `Total emotes in server: ${results.totalEmotes}\n\n`;
            response += `**Top 5 LEAST Used Emotes:**\n`;

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

            await message.reply(response);
        } catch (error) {
            console.error('Error analyzing emotes:', error);
            await message.reply(`Error analyzing emotes: ${error.message}`);
        }
    }
});

// Log in to Discord with your client's token
client.login(config.token);
