const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dialogflow = require('dialogflow'); // version 1.2.0
const uuid = require('uuid');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Load Dialogflow credentials
const CREDENTIALS = require('./service-account.json');
const projectId = CREDENTIALS.project_id;

const sessionClient = new dialogflow.SessionsClient({
  credentials: {
    private_key: CREDENTIALS.private_key,
    client_email: CREDENTIALS.client_email
  }
});

// Mock water availability based on location
function getWaterAvailability(location) {
  const lowAreas = ['Rajasthan', 'Anantapur'];
  const highAreas = ['Kerala', 'Shillong'];

  if (lowAreas.includes(location)) return 'low';
  if (highAreas.includes(location)) return 'high';
  return 'moderate';
}

// Main chatbot endpoint
app.post('/chat', async (req, res) => {
  const userMessage = req.body.message;
  const userLocation = req.body.location || null;
  const sessionId = uuid.v4();
  const sessionPath = sessionClient.sessionPath(projectId, sessionId);

  let locationInfo = 'Unknown';

  // If location not provided, detect from IP
  if (userLocation) {
    locationInfo = userLocation;
  } else {
    try {
      const ipRes = await axios.get('https://ipapi.co/json/');
      locationInfo = ipRes.data.city || 'Unknown';
    } catch (err) {
      console.log('IP location detection failed:', err.message);
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
    res.send({ reply: result.fulfillmentText });
  } catch (error) {
    console.error('Dialogflow error:', error);
    res.status(500).send({ error: 'Error processing the request' });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
