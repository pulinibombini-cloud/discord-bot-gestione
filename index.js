import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionFlagsBits,
  Events,
  ChannelType,
} from "discord.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) {
  console.error("DISCORD_BOT_TOKEN mancante.");
  process.exit(1);
}

const PREFIX = "!";
const BRAND_COLOR = 0x5865f2;
const MOD_ROLE_ID = process.env.MOD_ROLE_ID?.trim();
const AUTOROLE_IDS = (process.env.AUTOROLE_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DEFAULT_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

// --- Storage su file JSON ---
const DATA_FILE = path.resolve("./data/store.json");
let store = { warns: {}, reactionRoles: [] };

async function loadStore() {
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    const raw = await fs.readFile(DATA_FILE, "utf8");
    store = { warns: {}, reactionRoles: [], ...JSON.parse(raw) };
  } catch {
    await saveStore();
  }
}
async function saveStore() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2));
}
async function addWarn(guildId, userId, reason, by) {
  store.warns[guildId] ??= {};
  store.warns[guildId][userId] ??= [];
  store.warns[guildId][userId].push({ reason, at: Date.now(), by });
  await saveStore();
  return store.warns[guildId][userId].length;
}
function getWarns(guildId, userId) {
  return store.warns[guildId]?.[userId] ?? [];
}
async function addReactionRole(entry) {
  store.reactionRoles.push(entry);
  await saveStore();
}
function findReactionRole(messageId) {
  return store.reactionRoles.find((r) => r.messageId === messageId);
}

// --- Discord client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

function isMod(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (MOD_ROLE_ID && member.roles.cache.has(MOD_ROLE_ID)) return true;
  return false;
}

function noPerms(message) {
  return message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("Permessi insufficienti")
        .setDescription("Non hai i permessi per usare questo comando."),
    ],
  });
}

// --- Comandi ---
async function cmdWarn(message, args) {
  if (!isMod(message.member)) return noPerms(message);
  const target = message.mentions.members?.first();
  if (!target) return message.reply("Uso: `!warn @utente [motivo]`");
  const reason = args.slice(1).join(" ").trim() || "Nessun motivo specificato";
  const total = await addWarn(message.guild.id, target.id, reason, message.author.id);

  await message.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle("Warn registrato")
        .setDescription(`${target} è stato avvisato.`)
        .addFields(
          { name: "Motivo", value: reason },
          { name: "Warn totali", value: String(total), inline: true },
          { name: "Moderatore", value: `<@${message.author.id}>`, inline: true },
        )
        .setTimestamp(),
    ],
  });
  target.send(`Sei stato avvisato in **${message.guild.name}**.\nMotivo: ${reason}\nWarn totali: ${total}`).catch(() => {});
}

async function cmdWarns(message) {
  const target = message.mentions.members?.first() ?? message.member;
  const list = getWarns(message.guild.id, target.id);
  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xfaa61a)
        .setTitle(`Warn di ${target.user.tag}`)
        .setDescription(
          list.length === 0
            ? "Nessun warn."
            : list.map((w, i) => `**${i + 1}.** ${w.reason} — <@${w.by}> · <t:${Math.floor(w.at / 1000)}:R>`).join("\n"),
        ),
    ],
  });
}

async function cmdBan(message, args) {
  if (!isMod(message.member) && !message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
    return noPerms(message);
  }
  const target = message.mentions.members?.first();
  if (!target) return message.reply("Uso: `!ban @utente [motivo]`");
  if (!target.bannable) return message.reply("Non posso bannare questo utente.");
  const reason = args.slice(1).join(" ").trim() || "Nessun motivo specificato";

  await target.send(`Sei stato bannato da **${message.guild.name}**.\nMotivo: ${reason}`).catch(() => {});
  await target.ban({ reason });
  await message.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("Utente bannato")
        .setDescription(`${target.user.tag} è stato bannato.`)
        .addFields(
          { name: "Motivo", value: reason },
          { name: "Moderatore", value: `<@${message.author.id}>`, inline: true },
        )
        .setTimestamp(),
    ],
  });
}

async function cmdAnnuncio(message, args) {
  if (!isMod(message.member)) return noPerms(message);
  const channel = message.mentions.channels.first();
  if (!channel || channel.type !== ChannelType.GuildText) {
    return message.reply("Uso: `!annuncio #canale messaggio`");
  }
  const text = args.slice(1).join(" ").trim();
  if (!text) return message.reply("Scrivi il messaggio dopo il canale.");

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle("📢 Annuncio")
        .setDescription(text)
        .setFooter({ text: `Annuncio di ${message.author.tag}` })
        .setTimestamp(),
    ],
  });
  await message.reply(`Annuncio inviato in ${channel}.`);
}

async function cmdConsiglio(message, args) {
  const text = args.join(" ").trim();
  if (!text) return message.reply("Uso: `!consiglio il tuo suggerimento`");

  const sent = await message.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("💡 Nuovo consiglio")
        .setDescription(text)
        .addFields({ name: "Da", value: `<@${message.author.id}>`, inline: true })
        .setTimestamp(),
    ],
  });
  await sent.react("👍").catch(() => {});
  await sent.react("👎").catch(() => {});
  await message.delete().catch(() => {});
}

async function cmdAutorole(message, args) {
  if (!isMod(message.member)) return noPerms(message);

  let title = "Scegli i tuoi ruoli";
  let description = "Clicca un'emoji qui sotto per ricevere il ruolo. Riclicca per rimuoverlo.";
  let targetChannel = message.channel;
  let pairs = [];
  const raw = args.join(" ").trim();

  if (raw.length === 0) {
    if (AUTOROLE_IDS.length === 0) {
      return message.reply("Nessun ruolo autorole preconfigurato. Imposta `AUTOROLE_IDS`.");
    }
    pairs = AUTOROLE_IDS.map((id, i) => ({ emoji: DEFAULT_EMOJIS[i] ?? "🔘", roleId: id }));
  } else {
    const parts = raw.split("|").map((s) => s.trim());
    const ch = message.mentions.channels.first();
    if (parts.length < 4 || !ch || ch.type !== ChannelType.GuildText) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(BRAND_COLOR)
            .setTitle("Come usare !autorole")
            .setDescription(
              "**Modalità rapida:** scrivi solo `!autorole` e il bot pubblica il pannello con i ruoli preconfigurati nel canale corrente.\n\n**Modalità avanzata:**\n`!autorole #canale | Titolo | Descrizione | 🎮=ROLEID 🎨=ROLEID`",
            ),
        ],
      });
    }
    title = parts[1];
    description = parts[2];
    targetChannel = ch;
    pairs = parts[3]
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => {
        const eq = p.indexOf("=");
        return eq === -1 ? null : { emoji: p.slice(0, eq).trim(), roleId: p.slice(eq + 1).trim() };
      })
      .filter(Boolean);
  }

  const mapping = {};
  const lines = [];
  for (const { emoji, roleId } of pairs) {
    const role = message.guild.roles.cache.get(roleId);
    if (!role) return message.reply(`Ruolo non trovato: \`${roleId}\``);
    const customMatch = emoji.match(/^<a?:\w+:(\d+)>$/);
    const key = customMatch ? customMatch[1] : emoji;
    mapping[key] = roleId;
    lines.push(`${emoji}  **${role.name}**`);
  }

  const sent = await targetChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(title)
        .setDescription(`${description}\n\n${lines.join("\n")}`)
        .setFooter({ text: "Clicca un'emoji per ottenere il ruolo • Riclicca per rimuoverlo" }),
    ],
  });
  for (const { emoji } of pairs) await sent.react(emoji).catch(() => {});

  await addReactionRole({
    guildId: message.guild.id,
    channelId: targetChannel.id,
    messageId: sent.id,
    mapping,
  });

  if (targetChannel.id !== message.channel.id) {
    await message.reply(`Pannello autorole creato in <#${targetChannel.id}>.`);
  } else {
    await message.delete().catch(() => {});
  }
}

async function cmdHelp(message) {
  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle("Comandi disponibili")
        .setDescription("Prefisso: `!`")
        .addFields(
          { name: "!warn @utente [motivo]", value: "Avvisa un utente." },
          { name: "!warns @utente", value: "Mostra i warn di un utente." },
          { name: "!ban @utente [motivo]", value: "Banna un utente." },
          { name: "!annuncio #canale messaggio", value: "Invia un annuncio." },
          { name: "!consiglio messaggio", value: "Pubblica un consiglio." },
          { name: "!autorole", value: "Pannello reaction-role con ruoli preconfigurati." },
        ),
    ],
  });
}

// --- Eventi ---
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;
  const [cmd, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  try {
    switch (cmd.toLowerCase()) {
      case "warn": return cmdWarn(message, args);
      case "warns": return cmdWarns(message);
      case "ban": return cmdBan(message, args);
      case "annuncio": return cmdAnnuncio(message, args);
      case "consiglio": return cmdConsiglio(message, args);
      case "autorole": return cmdAutorole(message, args);
      case "help":
      case "comandi": return cmdHelp(message);
    }
  } catch (err) {
    console.error("Errore comando:", err);
    message.reply("Si è verificato un errore.").catch(() => {});
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    const entry = findReactionRole(reaction.message.id);
    if (!entry) return;
    const key = reaction.emoji.id ?? reaction.emoji.name ?? "";
    const roleId = entry.mapping[key];
    if (!roleId) return;
    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    await member?.roles.add(roleId).catch((e) => console.error("add role:", e));
  } catch (err) { console.error(err); }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    const entry = findReactionRole(reaction.message.id);
    if (!entry) return;
    const key = reaction.emoji.id ?? reaction.emoji.name ?? "";
    const roleId = entry.mapping[key];
    if (!roleId) return;
    const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
    await member?.roles.remove(roleId).catch((e) => console.error("remove role:", e));
  } catch (err) { console.error(err); }
});

client.once(Events.ClientReady, async (c) => {
  await loadStore();
  console.log(`Bot online come ${c.user.tag}`);
  c.user.setActivity("!help · moderazione", { type: 3 });
});

client.login(TOKEN);

// --- HTTP keep-alive per UptimeRobot / health check Render ---
const PORT = Number(process.env.PORT ?? 3000);
http.createServer((req, res) => {
  if (req.url === "/healthz" || req.url === "/" || req.url === "/ping") {
    const ready = client.isReady();
    res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: ready ? "ok" : "starting",
      bot: client.user?.tag ?? null,
      uptime: process.uptime(),
    }));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(PORT, () => console.log(`Health server su :${PORT}`));
