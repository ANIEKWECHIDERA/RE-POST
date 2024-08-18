'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();
const { google } = require('googleapis');

const app = express();

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

//middleware for file uploads
const upload = multer({ dest: 'uploads/' });

const PORT = process.env.PORT || 4000;

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URL
);

oauth2Client.setCredentials({
  refresh_token: process.env.REFRESH_TOKEN,
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });

async function uploadFileToGoogleDrive(filePath) {
  try {
    const response = await drive.files.create({
      requestBody: {
        name: path.basename(filePath),
        mimeType: 'image/jpeg',
      },
      media: {
        mimeType: 'image/jpeg',
        body: fs.createReadStream(filePath),
      },
    });

    return response.data.id; // Return the file ID
  } catch (error) {
    console.log(`Google Drive upload failed: ${error.message}`);
    throw error;
  }
}

// Function to generate a public URL for a file in Google Drive
async function generatePublicUrl(fileId) {
  try {
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    const result = await drive.files.get({
      fileId: fileId,
      fields: 'webContentLink',
    });

    return result.data.webContentLink; // Return the public URL
  } catch (error) {
    console.log(`Generating public URL failed: ${error.message}`);
  }
}

//function to post medai to instagram
async function postToInstagram(accessToken, accountId, message, mediaUrl) {
  try {
    // create a media container
    const mediaResponse = await axios.post(
      `https://graph.facebook.com/v16.0/${accountId}/media`,
      {
        image_url: mediaUrl,
        caption: message,
        access_token: accessToken,
      }
    );

    const creationId = mediaResponse.data.id;

    //publlish the medai contatner
    const publishResponse = await axios.post(
      `https://graph.facebook.com/v16.0/${accountId}/media_publish`,
      {
        creationId: creationId,
        access_token: accessToken,
      }
    );
    console.log(`Instagram Post was successful: ${publishResponse.status}`);
  } catch (error) {
    console.error('Error posting to Instagram:', error.message);
    res.status(500).send('Error posting to Instagram');
    throw error;
  }
}

// route to handle Instagram post
app.post('/postInstagram', upload.array('media', 5), async (req, res) => {
  const message = req.body.message;
  const mediaFiles = req.files;
  const instagramAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const instagramAccountId = process.env.INSTAGRAM_ACCOUNT_ID;

  if (!mediaFiles || mediaFiles.length === 0) {
    return res.status(400).send('file is required.');
  }

  try {
    let mediaUrls = [];

    if (mediaFiles && mediaFiles.length > 0) {
      for (let file of mediaFiles) {
        const fileId = await uploadFileToGoogleDrive(file.path);
        if (!fileId) {
          console.log('Google Drive upload failed.');
        } else {
          console.log(`Google Drive upload successful: ${fileId}`);
        }
        const publicUrl = await generatePublicUrl(fileId);
        mediaUrls.push(publicUrl);
        console.log(`Uploaded file to online storage`);
      }
    }

    if (instagramAccessToken && instagramAccountId) {
      for (let mediaUrl of mediaUrls) {
        await postToInstagram(
          instagramAccessToken,
          instagramAccountId,
          message,
          mediaUrl
        );
      }
    } else {
      console.log('Instagram access token or account ID is missing.');
    }
    res.send('Post to Instagram was successssful!');
  } catch (error) {
    res.status(500).send(`Posting to Instagram failed: ${error.message}`);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
