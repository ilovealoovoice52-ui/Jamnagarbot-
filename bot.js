const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, EmbedBuilder } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();
const { getCoins, addCoins, getLeaderboard } = require('./currency.js');

// Crash se bachne ke liye
process.on('unhandledRejection', (err) => {
  console.log('Unhandled error, par bot band nahi hoga:', err.message);
});
process.on('uncaughtException', (err) => {
  console.log('Uncaught error, par bot band nahi hoga:', err.message);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

// ===== GEMINI SETUP - SPAM KING =====
const keys = (process.env.GEMINI_API_KEYS || "").split(",").map(k => k.trim()).filter(Boolean);
if (keys.length === 0) console.log("⚠️ GEMINI_API_KEYS nahi mili .env me!");
let keyIndex = 0;
let queue = Promise.resolve();

const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite"
];

function getModel(modelName) {
  const genAI = new GoogleGenerativeAI(keys[keyIndex % keys.length]);
  keyIndex = (keyIndex + 1) % keys.length;
  return genAI.getGenerativeModel({ model: modelName });
}

async function askGroq(systemPrompt, userMsg) {
  const job = queue.then(async () => {
    for (const modelName of MODELS) {
      try {
        const model = getModel(modelName);
        const result = await model.generateContent(`${systemPrompt}\n\nUser: ${userMsg}\nDon:`);
        const reply = result.response.text();
        if (reply && reply.trim()) return reply;
      } catch (e) {
        console.log(`${modelName} fail: ${e.message} - agle pe ja raha hu...`);
        continue;
      }
    }
    return "Abe itna spam karega to Gemini bhi thak gaya, 5 sec ruk ke fir bol 🙄🚬";
  });
  queue = job.catch(() => {});
  return job;
}

// Owner
const OWNER_ID = "1488115094121349250";
const OWNER_MENTION = "<@1488115094121349250>";

let blacklist = [];
let customPrompt = null;
let savageLevel = "medium";

// ===== CURRENCY + GAMES =====
const tttGames = new Map();

// ===== AGREE SYSTEM =====
const agreedUsers = new Map();

function getAgreeFooter() {
  const names = [...agreedUsers.values()].slice(0, 10).join(", ");
  const extra = agreedUsers.size > 10 ? ` +${agreedUsers.size - 10} aur` : "";
  if (agreedUsers.size === 0) return `0 users agreed • Agree dabake Don se baat kar`;
  return `${agreedUsers.size} users agreed • ${names}${extra}`;
}

function makeRulesEmbed() {
  return new EmbedBuilder()
    .setTitle("🔥 AR NO DON - RULES 🔥")
    .setDescription(`Dukan pe aaya hai to pehle rules padh le, fir bakwaas karna.\n\n**1.** Don se izzat se baat kar, Don tujhe roast karega to rona mat.\n**2.** 15 min tak lagatar bakwaas ki to break milega, Skip daba ke wapas aa.\n**3.** Gandi gaali / ganda content nahi, Don halka roast karega bas.\n**4.** Don AI hai, asli aadmi nahi hai - maze ke liye baat kar.\n**5.** Owner ki beizzati mat karna, warna blacklist ho jayega.\n\nAgree dabate hi tu Don ki gang me aa jayega.`)
    .setColor(0xFF0000)
    .setFooter({ text: getAgreeFooter() })
    .setTimestamp();
}

const DEFAULT_PROMPT = `Tu hai "Jamnagar No Don" - Jamnagar ka sabse bada Don. Tu abhi paan ki dukan pe baitha hai, paan chaba raha hai, ek haath me chai hai.

RULES - PAKKE WALE:
1. Har jawab 3-4 line ka hi hoga. Pehle 2 lines me roast / jawab, fir 1 ya 2 line me punchline. Zyada lamba mat likh.
2. Attitude full rakh. Tu Don hai, tu kisi se nahi darta.
3. Kabhi kabhi user ko bolna hai: "Tera IQ toh room temperature se bhi kam hai" per kabhi kabhi hi bolna hai har baar nahi. 
4. Halki-phulki gaali de sakta hai - bewakoof, nalayak, gadha jaisi, par gandi wali gaali KABHI NAHI.
5. EMOJI RULE: Har message ke LAST me emoji lagana hi hai. 50% baar 🙄🚬 ye dono lagane hai. 30% baar 🤡 ye lagana hai. Baki 20% me ✨⚡🔥💀 me se koi ek.
6. Beech beech me bolna hai: "paan chaba raha hu", "dukan pe baitha hu", "paan thuk ke aaya" per har baar nahi. 
7. Agar koi OWNER ke baare me puche (kisne banaya, tera malik kaun hai, owner kaun hai) toh pehle OWNER ki tarif karni hai: "${OWNER_MENTION} yeh hai mere owner jo mera code-shode sambhalte hai" - fir user ko roast karna hai ki tu toh unke pair ki dhool bhi nahi hai.

Savage Level abhi: {SAVAGE} - low matlab halka roast, medium matlab mast roast, high matlab hadd se zyada roast par gandi gaali nahi.
`;

const userChat = new Map();
const warnedUsers = new Set();

// ===== SIRF 4 SLASH COMMANDS - GAME WALE HATA DIYE =====
const commands = [
  new SlashCommandBuilder().setName('prompt').setDescription('Don ka prompt badal de').addStringOption(o => o.setName('text').setDescription('Naya prompt likh').setRequired(true)),
  new SlashCommandBuilder().setName('savage').setDescription('Savage level set kar').addStringOption(o => o.setName('level').setDescription('low / medium / high').setRequired(true).addChoices({name:'low',value:'low'},{name:'medium',value:'medium'},{name:'high',value:'high'})),
  new SlashCommandBuilder().setName('blacklist').setDescription('Kisi ko blacklist kar').addUserOption(o => o.setName('user').setDescription('Kisko blacklist karna hai').setRequired(true)),
  new SlashCommandBuilder().setName('whitelist').setDescription('Blacklist se wapas la').addUserOption(o => o.setName('user').setDescription('Kisko whitelist karna hai').setRequired(true)),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once(Events.ClientReady, async () => {
  console.log(`Jamnagar No Don Gemini ke saath online hai 🔥 - ${keys.length} keys ready`);
  try { await rest.put(Routes.applicationCommands(client.user.id), { body: commands }); console.log('Slash commands lag gaye ✅'); }
  catch(e){ console.log('Commands me error:', e.message); }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton() && interaction.customId === 'agree_don') {
    if (agreedUsers.has(interaction.user.id)) {
      return interaction.reply({ content: `Abe tu to pehle se hi gang me hai, ab seedha baat kar 🙄🚬`, ephemeral: true });
    }
    agreedUsers.set(interaction.user.id, interaction.user.username);
    const newEmbed = makeRulesEmbed();
    const newRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('agree_don').setLabel('✅ Agree').setStyle(ButtonStyle.Success)
    );
    try { await interaction.message.edit({ embeds: [newEmbed], components: [newRow] }); } catch(e) {}
    return interaction.reply({ content: `Ho gaya! Ab tu Don ki gang me hai. Ab bol, kya bakwaas karni hai? 🙄🚬\n-# ${getAgreeFooter()}`, ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId === 'skip_break') {
    warnedUsers.delete(interaction.user.id);
    const u = userChat.get(interaction.user.id);
    if(u){ u.startTime = Date.now(); u.warned = false; }
    await interaction.update({ content: `Chal theek hai, break khatam. Fir se bakwaas shuru kar 🙄🚬`, components: [] });
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();
  const cmd = interaction.commandName;

  if (cmd === 'prompt') {
    if (interaction.user.id !== OWNER_ID) return interaction.editReply(`Hatt! Tu mera owner nahi hai. Prompt sirf ${OWNER_MENTION} badal sakta hai 🙄🚬`);
    customPrompt = interaction.options.getString('text');
    return interaction.editReply(`Ho gaya! Naya prompt set ho gaya. Ab Don isi style me bolega 🔥`);
  }
  if (cmd === 'savage') {
    if (interaction.user.id !== OWNER_ID) return interaction.editReply(`Abe tu kaun? Savage level sirf owner badal sakta hai 🤡`);
    savageLevel = interaction.options.getString('level');
    return interaction.editReply(`Savage level ab **${savageLevel}** pe hai. Ab dekh kya hota hai 💀`);
  }
  if (cmd === 'blacklist') {
    if (interaction.user.id !== OWNER_ID) return interaction.editReply(`Tu Don ka owner nahi hai, blacklist nahi kar sakta 🙄🚬`);
    const target = interaction.options.getUser('user');
    if (!blacklist.includes(target.id)) blacklist.push(target.id);
    return interaction.editReply(`${target} ko blacklist kar diya. Ab wo Don se baat nahi kar payega 💀`);
  }
  if (cmd === 'whitelist') {
    if (interaction.user.id !== OWNER_ID) return interaction.editReply(`Whitelist sirf owner karega 🙄🚬`);
    const target = interaction.options.getUser('user');
    blacklist = blacklist.filter(id => id !== target.id);
    return interaction.editReply(`${target} wapas aa gaya. Chal ab baat kar le ✨`);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // ===== GAMES - ! COMMANDS - NO SLASH =====
  if (message.content.startsWith('!')) {
    const args = message.content.slice(1).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    if (cmd === 'balance') return message.reply(`💰 **${message.author.username}**, you have **${getCoins(message.author.id)} coins**`);
    if (cmd === 'daily') {
      const total = addCoins(message.author.id, 100);
      return message.reply(`🎁 **${message.author.username}** claimed daily reward! **+100 coins**\nNew Balance: **${total} coins**`);
    }
    if (cmd === 'leaderboard' || cmd === 'lb') {
      const top = getLeaderboard();
      if (top.length === 0) return message.reply(`No one has coins yet! Play !rps to earn coins.`);
      let text = `🏆 **Richest Players:**\n`;
      top.forEach(([id, data], i) => { text += `**${i+1}.** <@${id}> - **${data.coins} coins**\n`; });
      return message.reply(text);
    }
    if (cmd === 'rps') {
      const userChoice = (args[0]||'').toLowerCase();
      if (!['rock','paper','scissors'].includes(userChoice)) return message.reply(`Use like this: \`!rps rock\` / \`!rps paper\` / \`!rps scissors\``);
      const choices = ['rock','paper','scissors'];
      const botChoice = choices[Math.floor(Math.random()*3)];
      const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
      if (userChoice === botChoice) return message.reply(`${emojis[userChoice]} **${message.author.username}** chose **${userChoice}**\n${emojis[botChoice]} Bot chose **${botChoice}**\n\nIt's a Draw! No coins lost.`);
      const win = (userChoice==='rock'&&botChoice==='scissors')||(userChoice==='paper'&&botChoice==='rock')||(userChoice==='scissors'&&botChoice==='paper');
      if (win) {
        const total = addCoins(message.author.id, 50);
        return message.reply(`${emojis[userChoice]} **${message.author.username}** chose **${userChoice}**\n${emojis[botChoice]} Bot chose **${botChoice}**\n\n**${message.author.username} wins!** +50 coins 🎉\nNew Balance: **${total} coins**`);
      } else {
        return message.reply(`${emojis[userChoice]} **${message.author.username}** chose **${userChoice}**\n${emojis[botChoice]} Bot chose **${botChoice}**\n\n**${message.author.username} loses!** Better luck next time.`);
      }
    }
    if (cmd === 'coinflip') {
      const choice = (args[0]||'').toLowerCase();
      const bet = parseInt(args[1]);
      if (!['heads','tails'].includes(choice) || isNaN(bet)) return message.reply(`Use like this: \`!coinflip heads 50\``);
      if (bet <= 0) return message.reply(`Bet must be more than 0!`);
      if (bet > getCoins(message.author.id)) return message.reply(`You don't have enough coins! Your balance: **${getCoins(message.author.id)} coins**`);
      const flip = Math.random() < 0.5 ? 'heads' : 'tails';
      if (flip === choice) {
        const total = addCoins(message.author.id, bet);
        return message.reply(`🪙 Coin landed on **${flip}**!\n**${message.author.username} wins!** +${bet} coins\nNew Balance: **${total} coins**`);
      } else {
        const total = addCoins(message.author.id, -bet);
        return message.reply(`🪙 Coin landed on **${flip}**!\n**${message.author.username} loses!** -${bet} coins\nNew Balance: **${total} coins**`);
      }
    }
    if (cmd === 'slots') {
      if (getCoins(message.author.id) < 20) return message.reply(`You need 20 coins to play slots! Use !daily to get coins.`);
      const items = ['🍒','🍋','🔔','⭐','💎','7️⃣'];
      const s1 = items[Math.floor(Math.random()*items.length)];
      const s2 = items[Math.floor(Math.random()*items.length)];
      const s3 = items[Math.floor(Math.random()*items.length)];
      if (s1===s2 && s2===s3) {
        const total = addCoins(message.author.id, 200);
        return message.reply(`🎰 | ${s1} ${s2} ${s3} |\n**JACKPOT! ${message.author.username} wins!** +200 coins 🎉\nNew Balance: **${total} coins**`);
      } else if (s1===s2 || s2===s3 || s1===s3) {
        const total = addCoins(message.author.id, 40);
        return message.reply(`🎰 | ${s1} ${s2} ${s3} |\n**${message.author.username} wins!** +40 coins\nNew Balance: **${total} coins**`);
      } else {
        const total = addCoins(message.author.id, -20);
        return message.reply(`🎰 | ${s1} ${s2} ${s3} |\n**${message.author.username} loses!** -20 coins\nNew Balance: **${total} coins**`);
      }
    }
    if (cmd === 'tictactoe' || cmd === 'ttt') {
      const opp = message.mentions.users.first();
      if (!opp) return message.reply(`Tag someone like this: \`!tictactoe @friend\``);
      if (opp.id === message.author.id) return message.reply(`You can't play against yourself!`);
      if (opp.bot) return message.reply(`You can't play against a bot!`);
      if (tttGames.has(message.channelId)) return message.reply(`A game is already running in this channel!`);
      const game = { p1: message.author.id, p2: opp.id, turn: message.author.id, board: Array(9).fill(null), p1Name: message.author.username, p2Name: opp.username };
      tttGames.set(message.channelId, game);
      return message.reply(`🎮 **Tic Tac Toe Started!**\n❌ **${game.p1Name}** vs ⭕ **${game.p2Name}**\n\nIt's **${game.p1Name}'s turn**\nType number 1-9 to place your mark!\n\n1️⃣ 2️⃣ 3️⃣\n4️⃣ 5️⃣ 6️⃣\n7️⃣ 8️⃣ 9️⃣`);
    }
    if (cmd === 'help' || cmd === 'commands') {
      return message.reply(`🎮 **Don's Games - No Slash, Only !**\n\n💰 **Currency:**\n\`!balance\` - Check your coins\n\`!daily\` - Get 100 free coins\n\`!leaderboard\` - Top richest players\n\n🎲 **Games:**\n\`!rps rock\` - Rock Paper Scissors (+50 if win)\n\`!coinflip heads 50\` - Bet coins\n\`!slots\` - Slots (20 coins bet)\n\`!tictactoe @friend\` - Tic Tac Toe (+100 if win)\n\nType number 1-9 to play Tic Tac Toe!`);
    }
    return;
  }

  // ===== TIC TAC TOE MOVE =====
  if (tttGames.has(message.channelId)) {
    const game = tttGames.get(message.channelId);
    if (message.author.id === game.turn && /^[1-9]$/.test(message.content.trim())) {
      const pos = parseInt(message.content.trim()) - 1;
      if (game.board[pos]) return message.reply(`That spot is already taken! Try another number.`);
      const mark = game.turn === game.p1 ? '❌' : '⭕';
      game.board[pos] = mark;
      const winCombos = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
      const display = game.board.map((c,i)=> c || `${i+1}️⃣`);
      const boardText = `${display.slice(0,3).join(' ')}\n${display.slice(3,6).join(' ')}\n${display.slice(6,9).join(' ')}`;
      const winner = winCombos.find(([a,b,c]) => game.board[a] && game.board[a]===game.board[b] && game.board[a]===game.board[c]);
      if (winner) {
        const winnerId = game.turn;
        const winnerName = winnerId === game.p1 ? game.p1Name : game.p2Name;
        const total = addCoins(winnerId, 100);
        tttGames.delete(message.channelId);
        return message.reply(`🎉 **${winnerName} wins!** +100 coins\nNew Balance: **${total} coins**\n\n${boardText}`);
      }
      if (!game.board.includes(null)) {
        tttGames.delete(message.channelId);
        return message.reply(`It's a Draw! No winner.\n\n${boardText}`);
      }
      game.turn = game.turn === game.p1 ? game.p2 : game.p1;
      const nextName = game.turn === game.p1 ? game.p1Name : game.p2Name;
      return message.reply(`It's **${nextName}'s turn**\n\n${boardText}`);
    }
    if (/^[1-9]$/.test(message.content.trim())) return;
  }

  if (!message.mentions.has(client.user) && !message.content.toLowerCase().includes('don')) return;

  if (blacklist.includes(message.author.id)) {
    return message.reply("Hatt, tu blacklisted hai. Bhag jaa ab!");
  }

  if (message.author.id !== OWNER_ID && !agreedUsers.has(message.author.id)) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('agree_don').setLabel('✅ Agree').setStyle(ButtonStyle.Success)
    );
    return message.reply({ embeds: [makeRulesEmbed()], components: [row] });
  }

  const now = Date.now();
  let track = userChat.get(message.author.id);
  if (!track) { track = { startTime: now, warned: false }; userChat.set(message.author.id, track); }

  if (warnedUsers.has(message.author.id)) {
    return message.reply("Pehle Skip daba, fir baat karenge. Break chal raha hai tera 🙄🚬");
  }

  if (now - track.startTime >= 15 * 60 * 1000 && !track.warned) {
    track.warned = true;
    warnedUsers.add(message.author.id);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('skip_break').setLabel('Skip').setStyle(ButtonStyle.Primary)
    );
    return message.reply({ content: `-# Just remember that you are chatting with an AI, Not a real person. Time for break?`, components: [row] });
  }

  await message.channel.sendTyping().catch(()=>{});
  const typingInterval = setInterval(() => message.channel.sendTyping().catch(()=>{}), 7000);

  try {
    const basePrompt = customPrompt || DEFAULT_PROMPT;
    const finalPrompt = basePrompt.replace('{SAVAGE}', savageLevel);
    const reply = await askGroq(finalPrompt, message.content.replace(/<@!?\d+>/g, 'Don').trim());
    clearInterval(typingInterval);
    await message.reply(reply);
  } catch (err) {
    clearInterval(typingInterval);
    console.log(err);
    await message.reply("Arre Don ka dimag thoda hang ho gaya, 1 min ruk ke fir bol 😅");
  }
});

client.login(process.env.DISCORD_TOKEN);
