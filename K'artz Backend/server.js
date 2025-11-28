// ===========================
// MODULE IMPORTS
// ===========================
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Import Custom Modules
const connectDB = require('./config/db');
const Chat = require('./models/Chat');
const Message = require('./models/Message');

// ===========================
// CONFIGURATION & INITIALIZATION
// ===========================

//  AI Configuration
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

//  Load System Prompt
// Function to securely load the system prompt from a local file
const loadSystemPrompt = () => {
  try {
    // Construct the absolute path to the prompt file
    const promptPath = path.join(__dirname, 'secure_prompts', 'kartz_system_prompt.txt');
    // Read the file synchronously during server startup
    const promptContent = fs.readFileSync(promptPath, 'utf8');
    console.log("✅ System Prompt loaded successfully from file.");
    return promptContent;
  } catch (err) {
    // Log a critical error and exit if the prompt cannot be loaded
    console.error("❌ CRITICAL ERROR: Could not load system prompt file.", err);
    process.exit(1);
  }
};
// Load the prompt content into a constant for use in the AI response generation
const SYSTEM_PROMPT = loadSystemPrompt();


// Establish a connection to the MongoDB database
connectDB();

//  Express & Server Setup
const app = express();
const server = http.createServer(app);

// ===========================
// MIDDLEWARE
// ===========================

// 1. CORS (Cross-Origin Resource Sharing) Configuration
// Define the list of allowed origins (front-end URLs) that can connect to this backend
const allowedOrigins = [
  "http://localhost:8080",         // Local development (Vite default)
  "http://localhost:5173",         // Alternative local development port
  "https://k-artz-app.vercel.app", // Your older Vercel deployment URL
  "https://www.kartzsignage.com",  // Your new custom domain (with www)
  "https://kartzsignage.com"       // Your new custom domain (without www)
];

// Apply CORS middleware to Express app for standard HTTP requests
app.use(cors({
  origin: allowedOrigins, // Allow requests from these origins
  methods: ["GET", "POST"], // Allow these HTTP methods
  credentials: true         // Allow cookies and authorization headers
}));


// Enable parsing of JSON data sent in the request body (for POST requests)
app.use(express.json());


// Initialize Socket.io on the same HTTP server with matching CORS settings
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// ===========================
// API ROUTES (RESTful Endpoints)
// ===========================

// Endpoint to retrieve the entire chat history for a specific user
app.get('/api/chat-history/:uid', async (req, res) => {
  const { uid } = req.params; // Extract the user ID from the URL parameter

  // Validate that a user ID was provided
  if (!uid) {
    console.warn("⚠️ Received chat history request without a UID.");
    return res.status(400).json({ error: "Missing user UID" });
  }

  try {
    console.log(`🔍 Fetching chat history for user: ${uid}`);

    // Find the parent 'Chat' document associated with this user ID
    const chat = await Chat.findOne({ userId: uid });

    // If no chat history exists for this user, return an empty array
    if (!chat) {
      console.log(`ℹ️ No existing chat found for user: ${uid}. Returning empty history.`);
      return res.json([]);
    }

    // Find all 'Message' documents linked to the retrieved Chat ID
    // Sort the messages by their creation time in ascending order (oldest first)
    const rawMessages = await Message.find({ chatId: chat._id }).sort({ createdAt: 1 });

    // 3. Format the messages to a cleaner structure for the front-end
    const formattedMessages = rawMessages.map(msg => ({
      id: msg._id.toString(),     // Convert Mongo ID to string
      content: msg.content,       // The message text
      senderType: msg.senderType, // Who sent it ('user' or 'ai')
      senderName: msg.senderName, // The display name of the sender
      timestamp: msg.createdAt    // The creation timestamp
    }));

    // Send the formatted message history back to the client as JSON
    console.log(`✅ Successfully sent ${formattedMessages.length} historical messages to user ${uid}`);
    res.json(formattedMessages);

  } catch (error) {
    // Log any errors that occur during the database queries
    console.error("❌ Error fetching chat history:", error);
    // Send a 500 Internal Server Error response
    res.status(500).json({ error: "Internal Server Error fetching history" });
  }
});


// ===========================
// REAL-TIME CHAT LOGIC (Socket.io)
// ===========================

// Listen for new client connections
io.on('connection', (socket) => {
  console.log(`⚡ New client connected: Socket ID ${socket.id}`);

  // Listen for 'send_message' events from the connected client
  socket.on('send_message', async (data) => {
    console.log(`📩 Received message from ${socket.id}:`, data);

    // Validate essential data fields are present
    // The client is expected to send { uid, email, content, senderName }
    if (!data.uid || !data.email || !data.content) {
      console.error("❌ Blocked message with missing data (UID, Email, or Content).");
      // Optionally emit an error back to the client
      // socket.emit('message_error', { error: 'Missing required data.' });
      return;
    }

    try {
      // --- Step 1: Find or Create Chat Thread ---
      // Attempt to find an existing chat document for this user
      let chat = await Chat.findOne({ userId: data.uid });

      if (!chat) {
        // If no chat exists, create a new one
        console.log(`🆕 Creating a new chat thread for user ${data.uid}.`);
        chat = await Chat.create({
          userId: data.uid,
          userEmail: data.email,
          status: 'ai_active' // Default status
        });
      } else {
        // If chat exists, update the 'lastMessageAt' timestamp
        console.log(`📝 Updating existing chat thread ${chat._id}.`);
        chat.lastMessageAt = Date.now();
        await chat.save();
      }

      // --- Save User's Message to Database ---
      // Create a new Message document linked to the chat thread
      const userMessageDoc = await Message.create({
        chatId: chat._id,
        content: data.content,
        senderType: 'user',
        senderName: data.senderName || 'Client', // Use provided name or fallback
        senderUid: data.uid
      });
      console.log(`💾 User message saved with ID: ${userMessageDoc._id}`);

 
      // Construct the full prompt by combining the system prompt with the user's message
      const fullPrompt = `${SYSTEM_PROMPT}\n\nClient Question: ${data.content}\nK'artz Assistant Answer:`;

      console.log("🤖 Sending prompt to AI model...");
      // Call the Google Generative AI model to get a response
      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      const aiText = response.text();
      console.log("✅ AI response generated successfully.");


      // Create a new Message document for the AI's reply
      const aiMessageDoc = await Message.create({
        chatId: chat._id,
        content: aiText,
        senderType: 'ai',
        senderName: "K'artz Assistant"
        // senderUid is not needed for AI messages
      });
      console.log(`💾 AI message saved with ID: ${aiMessageDoc._id}`);

      //  Send AI Reply Back to Client ---
      // Emit a 'receive_message' event with the formatted AI response
      const formattedAiMsg = {
        id: aiMessageDoc._id.toString(),
        content: aiMessageDoc.content,
        senderType: aiMessageDoc.senderType,
        senderName: aiMessageDoc.senderName,
        timestamp: aiMessageDoc.createdAt
      };
      socket.emit('receive_message', formattedAiMsg);
      console.log(`📤 Sent AI reply to client ${socket.id}`);

    } catch (error) {
      console.error("❌ Error in 'send_message' handler:", error);

      // Send a temporary error message back to the user in case of failure
      // Note: We don't save this error message to the database
      socket.emit('receive_message', {
        id: 'temp_error_' + Date.now(),
        content: "I apologize, I am having trouble processing your request right now. Please try again later.",
        senderType: 'ai',
        senderName: "System Error",
        timestamp: new Date()
      });
    }
  });

  // Listen for client disconnections
  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: Socket ID ${socket.id}`);
  });
});



const PORT = process.env.PORT || 5000;


server.listen(PORT, () => {
  console.log(`\n🚀 K'artz Backend Server is running on port ${PORT}`);
  console.log(`Create something amazing! ✨\n`);
});