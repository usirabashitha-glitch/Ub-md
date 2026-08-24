const express = require("express");
const fs = require("fs");
const { exec } = require("child_process");
const router = express.Router();
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
} = require("@whiskeysockets/baileys");
const { upload } = require("./mega");

function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get("/", async (req, res) => {
  let num = req.query.number;

  async function XubiPair() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");

    try {
      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: "silent" })
          ),
        },
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Chrome"),
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });

      // Pairing code request
      if (!sock.authState.creds.registered) {
        await delay(1500);
        num = num.replace(/[^0-9]/g, "");
        const code = await sock.requestPairingCode(num);
        console.log("Pairing Code generated for:", num);

        if (!res.headersSent) {
          res.send({ code });
        }
      }

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
          console.log("✅ Connection opened successfully");

          try {
            await delay(8000); // Wait for full sync

            const userJid = jidNormalizedUser(sock.user.id);
            console.log("📱 Sending to:", userJid);

            // ========== Upload to Mega ==========
            let sessionId = "";

            try {
              const randomName = () => {
                const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
                let str = "";
                for (let i = 0; i < 8; i++) {
                  str += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                return str + Date.now().toString().slice(-4) + ".json";
              };

              console.log("⬆️ Uploading session to Mega...");
              const megaUrl = await upload(
                fs.createReadStream("./session/creds.json"),
                randomName()
              );

              sessionId = megaUrl.replace("https://mega.nz/file/", "");
              console.log("✅ Mega Upload Success");
            } catch (err) {
              console.log("❌ Mega Upload Failed:", err.message || err);
              sessionId = "MEGA_FAILED_PLEASE_CHECK_LOGS";
            }

            // ========== Send Messages ==========
            const caption = `*XUBI-MD WhatsApp Bot*

✅ *Session Generated Successfully!*

👉 *Session ID:*
\`\`\`${sessionId}\`\`\`

📋 *How to use:*
1. Copy the Session ID above
2. Paste it into your config.js / settings.js
3. Restart the bot

⚠️ *Do not share this Session ID with anyone!*

*Powered by Xubi-md*`;

            // Send main message
            await sock.sendMessage(userJid, { text: caption });
            await delay(1200);

            // Send session only (easy to copy)
            await sock.sendMessage(userJid, { text: sessionId });
            await delay(800);

            // Warning
            await sock.sendMessage(userJid, {
              text: "🛑 *Do not share this code with anyone*",
            });

            console.log("✅ All messages sent successfully!");

          } catch (err) {
            console.log("===== ERROR WHILE SENDING =====");
            console.log(err);
          }

          // Cleanup
          await delay(4000);
          removeFile("./session");
          console.log("Session folder cleaned. Exiting...");
          process.exit(0);
        }

        // Reconnect if closed unexpectedly
        if (
          connection === "close" &&
          lastDisconnect?.error?.output?.statusCode !== 401
        ) {
          console.log("Connection closed. Reconnecting in 8s...");
          await delay(8000);
          XubiPair();
        }
      });
    } catch (err) {
      console.log("===== OUTER ERROR =====");
      console.log(err);

      exec("pm2 restart Robin");
      removeFile("./session");

      if (!res.headersSent) {
        res.send({ code: "Service Unavailable" });
      }
    }
  }

  await XubiPair();
});

process.on("uncaughtException", (err) => {
  console.log("Uncaught Exception:", err);
  exec("pm2 restart Robin");
});

module.exports = router;
