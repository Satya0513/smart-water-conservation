require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const dialogflow = require('@google-cloud/dialogflow');
const uuid = require('uuid');
const axios = require('axios');
const app = express();

app.use(cors());
app.use(bodyParser.json());

// --- MongoDB Setup ---
const mongoURI = process.env.MONGO_URI;
const client = new MongoClient(mongoURI);
let db;

async function connectMongo() {
  try {
    await client.connect();
    db = client.db("waterData");
    console.log("✅ Connected to MongoDB Atlas");
  } catch (error) {
    console.error("❌ MongoDB Connection Failed:", error);
    setTimeout(connectMongo, 5000); // Retry
  }
}
connectMongo();

// --- Dialogflow Setup ---
const CREDENTIALS = {
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  project_id: process.env.PROJECT_ID
};

const projectId = CREDENTIALS.project_id;
const sessionClient = new dialogflow.SessionsClient({ credentials: CREDENTIALS });

// --- Water Availability Helper ---
function getWaterAvailability(location) {
  const lowAreas = ['Rajasthan', 'Anantapur'];
  const highAreas = ['Kerala', 'Shillong'];
  if (lowAreas.includes(location)) return 'low';
  if (highAreas.includes(location)) return 'high';
  return 'moderate';
}

// --- POST: Calculator Data ---
app.post('/calculator', async (req, res) => {
  try {
    const data = req.body;
    const total = data.shower * 50 + data.toilet * 10 + data.brush * 2 +
                  data.clothes * 70 + data.dishes * 20 + data.cooking * 10;
    const perPerson = total / data.people;

    const record = {
      ...data,
      total,
      perPerson,
      timestamp: new Date()
    };

    await db.collection("usageData").insertOne(record);
    res.send({
  success: true,
  data: {
    total,
    perPerson
  }
});

  } catch (err) {
    console.error("❌ Error saving calculator data:", err);
    res.status(500).send({ error: "Failed to store calculator data" });
  }
});

// --- GET: All Calculator Data ---
app.get('/calculator', async (req, res) => {
  try {
    const data = await db.collection("usageData").find().toArray();
    res.send(data);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch calculator data" });
  }
});

// --- POST: Chatbot Message ---
app.post('/chat', async (req, res) => {
  const userMessage = req.body.message;
  const userLocation = req.body.location || null;
  const sessionId = uuid.v4();
  const sessionPath = sessionClient.projectAgentSessionPath(projectId, sessionId);

  let locationInfo = userLocation || 'Unknown';
  if (!userLocation) {
    try {
      const ipRes = await axios.get('https://ipapi.co/json/');
      locationInfo = ipRes.data.city || 'Unknown';
    } catch (err) {
      console.log('🌐 IP detection failed:', err.message);
    }
  }

  const waterStatus = getWaterAvailability(locationInfo);
  const enrichedMessage = `${userMessage}. Location: ${locationInfo}. Water status: ${waterStatus}`;

  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text: enrichedMessage,
        languageCode: 'en-US',
      },
    },
  };

  try {
    const responses = await sessionClient.detectIntent(request);
    const result = responses[0].queryResult;
    const botReply = result.fulfillmentText;

    const logEntry = {
      userMessage,
      location: locationInfo,
      waterStatus,
      botReply,
      timestamp: new Date()
    };
    await db.collection("chatLogs").insertOne(logEntry);

    res.send({ reply: botReply });
  } catch (error) {
    console.error('❌ Dialogflow error:', error);
    res.status(500).send({ error: 'Error processing chatbot request' });
  }
});

// --- GET: Dashboard Data ---
app.get('/dashboard-data', async (req, res) => {
  try {
    const usageData = await db.collection("usageData").find().sort({ timestamp: -1 }).toArray();
    const chatLogs = await db.collection("chatLogs").find().sort({ timestamp: -1 }).toArray();
    res.json({ usageData, chatLogs });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
