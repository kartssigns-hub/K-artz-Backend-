require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const connectDB = require('./config/db');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
const Chat = require('./models/Chat');
const Message = require('./models/Message');

// ===========================
// AI CONFIGURATION
// ===========================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const loadSystemPrompt = () => {
  try {
    const promptPath = path.join(__dirname, 'secure_prompts', 'kartz_system_prompt.txt');
    return fs.readFileSync(promptPath, 'utf8');
  } catch (err) {
    console.error("❌ CRITICAL ERROR: Could not load system prompt file.");
    process.exit(1);
  }
};
const SYSTEM_PROMPT = loadSystemPrompt();


// ===========================
// SERVER SETUP
// ===========================
const app = express();
connectDB();

const allowedOrigins = [
  "http://localhost:8080",         // Local development
  "http://localhost:5173",         // Alternative local development
  "https://k-artz-app.vercel.app", // Old Vercel domain (optional to keep)
  "https://www.kartzsignage.com",  // <-- NEW: Your custom domain (www version)
  "https://kartzsignage.com"       // <-- NEW: Your custom domain (root version)
];

app.use(cors({ origin:allowedOrigins , methods: ["GET", "POST"] }));

app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] }
});

// ===========================
// NEW: REST API ROUTE FOR HISTORY
// ===========================
//  BEFORE the io.on('connection') block
app.get('/api/chat-history/:uid', async (req, res) => {
    const { uid } = req.params;

    if (!uid) {
        return res.status(400).json({ error: "Missing user UID" });
    }

    try {
        //  Find the parent Chat document for this user
        const chat = await Chat.findOne({ userId: uid });

        // If they have never chatted before, return empty array
        if (!chat) {
            return res.json([]);
        }

        // Find all messages linked to this Chat ID
        // Sort by 'createdAt' ascending (oldest first) so they appear correctly
        const rawMessages = await Message.find({ chatId: chat._id }).sort({ createdAt: 1 });

        //  Format messages to match frontend interface
        const formattedMessages = rawMessages.map(msg => ({
            id: msg._id.toString(),
            content: msg.content,
            senderType: msg.senderType,
            senderName: msg.senderName,
            timestamp: msg.createdAt // Send back the raw DB timestamp string
        }));

        console.log(`📜 Sent ${formattedMessages.length} historical messages to user ${uid}`);
        res.json(formattedMessages);

    } catch (error) {
        console.error("Error fetching chat history:", error);
        res.status(500).json({ error: "Internal Server Error fetching history" });
    }
});



// ===========================
// SOCKET.IO REAL-TIME LOGIC
// ===========================
io.on('connection', (socket) => {
  console.log(`⚡ User connected to socket: ${socket.id}`);

  socket.on('send_message', async (data) => {
    // ... (This whole block remains exactly the same as the previous version)
    // Validate
    if (!data.uid || !data.email || !data.content) return;

    try {
      //  Find or Create Chat thread
      let chat = await Chat.findOne({ userId: data.uid });
      if (!chat) {
        chat = await Chat.create({ userId: data.uid, userEmail: data.email, status: 'ai_active' });
      } else {
        chat.lastMessageAt = Date.now();
        await chat.save();
      }

      //  Save User Msg
      await Message.create({ chatId: chat._id, content: data.content, senderType: 'user', senderName: data.senderName, senderUid: data.uid });

      //  Generate AI
      const fullPrompt = `${SYSTEM_PROMPT}\n\nClient Question: ${data.content}\nK'artz Assistant Answer:`;
      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      const aiText = response.text();

      //  Save AI Msg
      const aiMessageDoc = await Message.create({ chatId: chat._id, content: aiText, senderType: 'ai', senderName: "K'artz Assistant" });

      // Send back
      socket.emit('receive_message', {
        id: aiMessageDoc._id.toString(),
        content: aiMessageDoc.content,
        senderType: aiMessageDoc.senderType,
        senderName: aiMessageDoc.senderName,
        timestamp: aiMessageDoc.createdAt
      });

    } catch (error) {
      console.error("❌ Error processing message:", error);
       // Error handling...
    }
  });

  socket.on('disconnect', () => console.log(`User disconnected: ${socket.id}`));
});


const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n--- K'artz Backend Chat Server Running on port ${PORT} ---`);

});
