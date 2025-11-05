const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config.js');

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

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
});

// Log in to Discord with your client's token
client.login(config.token);
