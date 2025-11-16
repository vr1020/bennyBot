const { REST, Routes, ApplicationCommandOptionType, ChannelType } = require('discord.js');
const config = require('./config.js');

const commands = [
    {
        name: 'ping',
        description: 'Replies with Pong!',
    },
    {
        name: 'hello',
        description: 'Greets you!',
    },
    {
        name: 'emote-stats-reset',
        description: 'Clear saved emote statistics and start fresh',
    },
    {
        name: 'emote-stats',
        description: 'Analyze custom emote usage in the server',
        options: [
            {
                name: 'messages',
                type: ApplicationCommandOptionType.Integer,
                description: 'Number of messages to scan (default: 10000, no max with persist:true)',
                required: false,
                min_value: 100,
            },
            {
                name: 'channel',
                type: ApplicationCommandOptionType.Channel,
                description: 'Specific channel to analyze (default: all channels)',
                required: false,
                channel_types: [ChannelType.GuildText],
            },
            {
                name: 'show_top',
                type: ApplicationCommandOptionType.Integer,
                description: 'Number of least-used emotes to show (default: 5)',
                required: false,
                min_value: 1,
                max_value: 50,
            },
            {
                name: 'min_usage',
                type: ApplicationCommandOptionType.Integer,
                description: 'Only show emotes used at least this many times (default: 0)',
                required: false,
                min_value: 0,
            },
            {
                name: 'persist',
                type: ApplicationCommandOptionType.Boolean,
                description: 'Save results and continue from last scan (default: false)',
                required: false,
            },
            {
                name: 'until_date',
                type: ApplicationCommandOptionType.String,
                description: 'Scan until this date (YYYY-MM-DD, DD/MM/YYYY, or DD-MM-YYYY)',
                required: false,
            },
        ],
    },
];

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        // For global commands (available in all servers)
        await rest.put(
            Routes.applicationCommands(config.clientId),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();
