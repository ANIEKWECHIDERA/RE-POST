'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const axios = require('axios');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const app = express();

app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });

const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');

// Root route to render index.ejs
app.get('/', (req, res) => {
  res.render('index.ejs');
});

function determineMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.gif':
      return 'image';
    case '.mp4':
    case '.mov':
    case '.avi':
    case '.wmv':
      return 'video';
  }
}
// Route to handle form submission
app.post('/post', upload.array('media', 5), async (req, res) => {
  const message = req.body.message;
  const mediaFiles = req.files;
  const linkedinAccessToken = process.env.ACCESS_TOKEN;
  const facebookAccessToken = process.env.FACEBOOK_ACCESS_TOKEN;
  const instagramAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const instagramAccountId = process.env.INSTAGRAM_ACCOUNT_ID;

  if (!message) {
    return res.status(400).send('Message is required.');
  }

  try {
    // Post to LinkedIn
    if (linkedinAccessToken) {
      if (mediaFiles && mediaFiles.length > 0) {
        for (let file of mediaFiles) {
          const mediaType = determineMediaType(file.originalname);

          // console.log(file.originalname);

          const registeredMedia = await registerLinkedInMedia(
            linkedinAccessToken,
            mediaType
          );
          await uploadLinkedInMedia(
            registeredMedia.uploadMechanism[
              'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
            ].uploadUrl,
            file.path
          );
          await createLinkedInPost(
            linkedinAccessToken,
            message,
            registeredMedia.asset,
            mediaType
          );
        }
      } else {
        await createLinkedInPost(linkedinAccessToken, message, null, 'text');
      }
    } else {
      console.log('LinkedIn access token is missing.');
    }

    //Upload meadia to Google drive and generate a public URL
    let mediaUrls = [];

    if (mediaFiles && mediaFiles.length > 0) {
      for (let file of mediaFiles) {
        const fileId = await uploadFileToGoogleDrive(file.path);
        const publicUrl = await generatePublicUrl(fileId);
        mediaUrls.push({
          url: publicUrl,
          mediaType: determineMediaType(file.originalname),
        });
        console.log(`Uploaded file to Online Storage`);
      }
    }

    // Post to Facebook
    if (facebookAccessToken) {
      if (mediaUrls.length > 0) {
        for (let media of mediaUrls) {
          await postToFacebook(
            facebookAccessToken,
            message,
            media.url,
            media.mediaType
          );
        }
      } else {
        await postToFacebook(facebookAccessToken, message, null);
      }
    } else {
      console.log('Facebook access token is missing.');
    }

    if (instagramAccessToken && instagramAccountId) {
      for (let media of mediaUrls) {
        await postToInstagram(
          instagramAccessToken,
          instagramAccountId,
          message,
          media.url
        );
      }
    } else {
      console.log('Instagram access token or account ID is missing.');
    }

    res.send('Post to LinkedIn and Facebook & Instagram was successful!');
  } catch (error) {
    res.status(500).send(`Posting failed: ${error.message}`);
  }
});

// Function to register media on LinkedIn
async function registerLinkedInMedia(accessToken, mediaType) {
  const url = 'https://api.linkedin.com/v2/assets?action=registerUpload';
  const body = {
    registerUploadRequest: {
      recipes: [
        mediaType === 'image'
          ? 'urn:li:digitalmediaRecipe:feedshare-image'
          : 'urn:li:digitalmediaRecipe:feedshare-video',
      ],
      owner: 'urn:li:person:9DxIdmZZ0b', // Replace with the correct LinkedIn URN
      serviceRelationships: [
        {
          relationshipType: 'OWNER',
          identifier: 'urn:li:userGeneratedContent',
        },
      ],
    },
  };

  try {
    const response = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data.value;
  } catch (error) {
    console.log(`Media registration failed: ${error.message}`);
    throw error;
  }
}

// Function to upload media to LinkedIn
async function uploadLinkedInMedia(uploadUrl, filePath) {
  const mediaData = fs.readFileSync(filePath);

  try {
    await axios.post(uploadUrl, mediaData, {
      headers: {
        Authorization: `Bearer ${process.env.ACCESS_TOKEN}`, // Replace with the correct access token
        'Content-Type': 'application/octet-stream',
      },
    });
    console.log('LinkedIn Media upload successful!');
  } catch (error) {
    console.log(`LinkedIn Media upload failed: ${error.message}`);
    throw error;
  }
}

// Function to create LinkedIn post with media
async function createLinkedInPost(accessToken, message, asset, mediaType) {
  const url = 'https://api.linkedin.com/v2/ugcPosts';

  // Check if there is media or not and prepare the request body accordingly
  const body = asset
    ? {
        author: 'urn:li:person:9DxIdmZZ0b', // Replace with the correct LinkedIn URN
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: message,
            },
            shareMediaCategory: mediaType ? mediaType.toUpperCase() : 'NONE',
            media: [
              {
                status: 'READY',
                media: asset,
                description: {
                  text: 'Media description.',
                },
                title: {
                  text: 'Media title.',
                },
              },
            ],
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      }
    : {
        author: 'urn:li:person:9DxIdmZZ0b',
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: message,
            },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      };

  try {
    const response = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    console.log(`LinkedIn Post was successful: ${response.status}`);
  } catch (error) {
    console.log(`LinkedIn post creation failed: ${error.message}`);
    throw error;
  }
}

// OAuth2 Client Setup for Google Drive
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URL
);

oauth2Client.setCredentials({
  refresh_token: process.env.REFRESH_TOKEN,
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });

// Helper function to detect MIME type
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp4':
      return 'video/mp4';
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg';
    // Add more MIME types if necessary
    default:
      return 'application/octet-stream';
  }
}

// Function to upload a file to Google Drive
async function uploadFileToGoogleDrive(filePath) {
  const mimeType = getMimeType(filePath);

  try {
    const response = await drive.files.create({
      requestBody: {
        name: path.basename(filePath),
        mimeType: mimeType,
      },
      media: {
        mimeType: mimeType,
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
    throw error;
  }
}
// Function to post to Facebook with media
async function postToFacebook(accessToken, message, mediaUrl, mediaType) {
  const url =
    mediaType === 'video'
      ? 'https://graph.facebook.com/v16.0/341549492371560/videos'
      : mediaUrl
      ? 'https://graph.facebook.com/v16.0/341549492371560/photos'
      : 'https://graph.facebook.com/v16.0/341549492371560/feed';

  const body =
    mediaType === 'video'
      ? {
          description: message,
          file_url: mediaUrl,
          access_token: accessToken,
        }
      : mediaUrl
      ? {
          caption: message,
          url: mediaUrl,
          access_token: accessToken,
        }
      : {
          message: message,
          access_token: accessToken,
        };

  try {
    const response = await axios.post(url, body);
    console.log(`Facebook Post was successful: ${response.status}`);
  } catch (error) {
    console.log(`Facebook Post was unsuccessful: ${error.message}`);
    throw error;
  }
}

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
        creation_id: creationId,
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
// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
