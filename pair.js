const express = require("express");
const fs = require("fs");
const path = require("path");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  DisconnectReason,
  jidNormalizedUser,
} = require("@whiskeysockets/baileys");

const { upload } = require("./Mega");

const router = express.Router();

const SESSION_DIR = path.join(process.cwd(), "session");

const logger = pino({
  level: "fatal",
});

let sock = null;
let starting = false;


/* =========================================================
   HELPERS
========================================================= */

function removeFile(filePath) {
  if (!fs.existsSync(filePath)) return false;

  fs.rmSync(filePath, {
    recursive: true,
    force: true,
  });

  return true;
}


function randomSessionName() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  let result = "";

  for (let i = 0; i < 8; i++) {
    result += chars.charAt(
      Math.floor(Math.random() * chars.length)
    );
  }

  return "XIBU-" + result;
}


/* =========================================================
   GET MESSAGE TEXT
========================================================= */

function getTextMessage(message) {
  if (!message) return "";

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ""
  ).trim();
}


/* =========================================================
   MESSAGE HANDLER
========================================================= */

async function handleMessage(sock, msg) {
  try {

    if (!msg) return;

    if (!msg.message) return;

    /* Ignore WhatsApp status */
    if (
      msg.key.remoteJid === "status@broadcast"
    ) {
      return;
    }

    /* Ignore messages sent by the bot */
    if (msg.key.fromMe) {
      return;
    }

    const jid = msg.key.remoteJid;

    if (!jid) return;

    const text = getTextMessage(
      msg.message
    );

    if (!text) return;


    console.log(
      `[XIBU-MD] MESSAGE FROM ${jid}: ${text}`
    );


    /* =====================================================
       PING
    ===================================================== */

    if (
      text.toLowerCase() === ".ping" ||
      text.toLowerCase() === "ping"
    ) {

      await sock.sendMessage(jid, {
        text:
          "╭──〔 XIBU-MD 〕──╮\n" +
          "│\n" +
          "│ 🟢 Bot Online\n" +
          "│\n" +
          "│ 🏓 Pong!\n" +
          "│\n" +
          "╰────────────────╯",
      });

      return;
    }


    /* =====================================================
       MENU
    ===================================================== */

    if (
      text.toLowerCase() === ".menu" ||
      text.toLowerCase() === "menu" ||
      text.toLowerCase() === ".help"
    ) {

      await sock.sendMessage(jid, {
        text:
          "╭───〔 XIBU-MD 〕───╮\n" +
          "│\n" +
          "│ 🤖 WhatsApp Bot\n" +
          "│ 🟢 Status: Online\n" +
          "│\n" +
          "│ 📌 Commands\n" +
          "│\n" +
          "│ • .ping\n" +
          "│ • .menu\n" +
          "│ • .help\n" +
          "│\n" +
          "╰──────────────────╯",
      });

      return;
    }


    /* =====================================================
       TEST ALL INCOMING MESSAGES
       
       If you want the bot to reply to every message,
       remove the // from the following section.
    ===================================================== */

    /*
    await sock.sendMessage(jid, {
      text: "✅ Xibu-md received your message!"
    });
    */

  } catch (error) {

    console.error(
      "[XIBU-MD] MESSAGE HANDLER ERROR:",
      error
    );

  }
}


/* =========================================================
   START WHATSAPP
========================================================= */

async function startWhatsApp(
  numberForPairing = null,
  res = null
) {

  if (starting) {

    if (res && !res.headersSent) {

      return res.send({
        code:
          "Service is starting. Please try again.",
      });

    }

    return;
  }


  starting = true;


  try {

    /* Create session folder */

    if (!fs.existsSync(SESSION_DIR)) {

      fs.mkdirSync(
        SESSION_DIR,
        {
          recursive: true,
        }
      );

    }


    /* Authentication */

    const {
      state,
      saveCreds,
    } = await useMultiFileAuthState(
      SESSION_DIR
    );


    /* WhatsApp Socket */

    sock = makeWASocket({

      auth: {

        creds: state.creds,

        keys:
          makeCacheableSignalKeyStore(
            state.keys,
            logger
          ),

      },

      logger,

      printQRInTerminal: false,

      browser:
        Browsers.macOS("Safari"),

      markOnlineOnConnect: false,

      syncFullHistory: false,

    });


    /* =====================================================
       SAVE CREDENTIALS
    ===================================================== */

    sock.ev.on(
      "creds.update",
      saveCreds
    );


    /* =====================================================
       IMPORTANT:
       RECEIVE WHATSAPP MESSAGES
    ===================================================== */

    sock.ev.on(
      "messages.upsert",
      async ({
        messages,
        type,
      }) => {

        console.log(
          `[XIBU-MD] messages.upsert: ${type}`
        );

        for (
          const message of messages
        ) {

          await handleMessage(
            sock,
            message
          );

        }

      }
    );


    /* =====================================================
       CONNECTION UPDATE
    ===================================================== */

    sock.ev.on(
      "connection.update",
      async (update) => {

        const {
          connection,
          lastDisconnect,
        } = update;


        /* ============================
           CONNECTED
        ============================ */

        if (
          connection === "open"
        ) {

          console.log(
            "╔══════════════════════════╗"
          );

          console.log(
            "║   XIBU-MD CONNECTED ✅   ║"
          );

          console.log(
            "╚══════════════════════════╝"
          );


          starting = false;


          /* --------------------------------
             Send session information
          -------------------------------- */

          if (numberForPairing) {

            try {

              await delay(3000);


              const sessionFile =
                path.join(
                  SESSION_DIR,
                  "creds.json"
                );


              if (
                fs.existsSync(
                  sessionFile
                )
              ) {

                console.log(
                  "[XIBU-MD] Uploading session..."
                );


                const megaUrl =
                  await upload(
                    fs.createReadStream(
                      sessionFile
                    ),
                    `${randomSessionName()}.json`
                  );


                console.log(
                  "[XIBU-MD] Session uploaded."
                );


                const sessionID =
                  megaUrl.replace(
                    "https://mega.nz/file/",
                    ""
                  );


                const userJid =
                  jidNormalizedUser(
                    sock.user.id
                  );


                await sock.sendMessage(
                  userJid,
                  {
                    text:
                      "╭───〔 XIBU-MD 〕───╮\n" +
                      "│\n" +
                      "│ ✅ Pairing Successful\n" +
                      "│\n" +
                      "│ 🔑 Session ID:\n" +
                      "│\n" +
                      `│ ${sessionID}\n` +
                      "│\n" +
                      "│ ⚠️ Keep this private.\n" +
                      "│\n" +
                      "╰──────────────────╯",
                  }
                );

              }

            } catch (error) {

              console.error(
                "[XIBU-MD] SESSION ERROR:",
                error
              );

            }

          }


          numberForPairing = null;

        }


        /* ============================
           CONNECTION CLOSED
        ============================ */

        if (
          connection === "close"
        ) {

          starting = false;

          const statusCode =
            lastDisconnect
              ?.error
              ?.output
              ?.statusCode;


          console.log(
            `[XIBU-MD] Connection closed: ${statusCode}`
          );


          sock = null;


          /* ============================
             LOGGED OUT
          ============================ */

          if (
            statusCode ===
            DisconnectReason.loggedOut
          ) {

            console.log(
              "[XIBU-MD] Logged out."
            );


            removeFile(
              SESSION_DIR
            );


            return;
          }


          /* ============================
             RECONNECT
          ============================ */

          console.log(
            "[XIBU-MD] Reconnecting in 5 seconds..."
          );


          setTimeout(
            () => {

              startWhatsApp()
                .catch(
                  (error) => {

                    console.error(
                      "[XIBU-MD] Reconnect error:",
                      error
                    );

                  }
                );

            },
            5000
          );

        }

      }
    );


    /* =====================================================
       PAIRING CODE
    ===================================================== */

    if (
      !state.creds.registered &&
      numberForPairing
    ) {

      await delay(1500);


      const cleanNumber =
        String(
          numberForPairing
        ).replace(
          /[^0-9]/g,
          ""
        );


      if (
        cleanNumber.length < 11
      ) {

        throw new Error(
          "Invalid phone number"
        );

      }


      console.log(
        `[XIBU-MD] Requesting pairing code for ${cleanNumber}`
      );


      const code =
        await sock.requestPairingCode(
          cleanNumber
        );


      console.log(
        `[XIBU-MD] Pairing code: ${code}`
      );


      starting = false;


      if (
        res &&
        !res.headersSent
      ) {

        return res.send({
          code,
        });

      }

    } else {

      starting = false;


      if (
        res &&
        !res.headersSent
      ) {

        return res.send({
          code:
            "Already connected.",
        });

      }

    }

  } catch (error) {

    starting = false;

    sock = null;


    console.error(
      "[XIBU-MD] START ERROR:",
      error
    );


    if (
      res &&
      !res.headersSent
    ) {

      return res.send({
        code:
          "Service Unavailable",
      });

    }

  }

}


/* =========================================================
   /code
========================================================= */

router.get(
  "/",
  async (req, res) => {

    try {

      const number =
        req.query.number;


      if (!number) {

        return res.status(400).send({
          code:
            "Phone number is required.",
        });

      }


      const cleanNumber =
        String(number).replace(
          /[^0-9]/g,
          ""
        );


      if (
        cleanNumber.length < 11
      ) {

        return res.status(400).send({
          code:
            "Invalid phone number.",
        });

      }


      /* Don't create duplicate sockets */

      if (
        sock &&
        sock.user
      ) {

        return res.send({
          code:
            "Already connected.",
        });

      }


      return await startWhatsApp(
        cleanNumber,
        res
      );


    } catch (error) {

      console.error(
        "[XIBU-MD] CODE ERROR:",
        error
      );


      if (
        !res.headersSent
      ) {

        return res.status(500).send({
          code:
            "Service Unavailable",
        });

      }

    }

  }
);


/* =========================================================
   STATUS
========================================================= */

router.get(
  "/status",
  async (req, res) => {

    res.send({

      bot:
        "Xibu-md",

      connected:
        !!(
          sock &&
          sock.user
        ),

      number:
        sock?.user?.id ||
        null,

    });

  }
);


/* =========================================================
   AUTO START EXISTING SESSION
========================================================= */

if (
  fs.existsSync(
    SESSION_DIR
  ) &&
  fs.existsSync(
    path.join(
      SESSION_DIR,
      "creds.json"
    )
  )
) {

  console.log(
    "[XIBU-MD] Existing session found."
  );


  setTimeout(
    () => {

      startWhatsApp()
        .catch(
          (error) => {

            console.error(
              "[XIBU-MD] Auto-start error:",
              error
            );

          }
        );

    },
    2000
  );

}


/* =========================================================
   EXPORT
========================================================= */

module.exports = router;
