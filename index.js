//.
const express = require('express');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const fs = require('fs');
const mime = require('mime-types');

const app = express();
const port = 3000;
const githubToken = `YOUR TOKEN`; // https://github.com/settings/tokens
const owner = 'YOUR GITHUB USERNAME'; // GitHub username
const repo = 'YOUR REPO NAME'; // Repository name
const branch = 'main';

app.use(fileUpload());

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.post('/upload', async (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send('No files were uploaded.');
  }

  let uploadedFile = req.files.file;
  let mimeType = mime.lookup(uploadedFile.name);
  let fileName = `${Date.now()}.${mime.extension(mimeType)}`;
  let filePath = `uploads/${fileName}`;
  let base64Content = Buffer.from(uploadedFile.data).toString('base64');

  try {
    let response = await axios.put(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
      message: `Upload file ${fileName}`,
      content: base64Content,
      branch: branch,
    }, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        'Content-Type': 'application/json',
      },
    });

    let rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    // YAYAYAYYAYAYAYAYAYAYYAYAYYAYYAYAYAYAA
    res.send(`
    <!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unggahan Berhasil</title>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100">
  <div class="flex flex-col items-center justify-center min-h-screen">
    <div class="bg-white shadow-md rounded px-8 pt-6 pb-8 mb-4">
      <div class="mb-4">
        <img src="https://media.tenor.com/yWaLIc5J9WgAAAAj/momoi.gif" alt="Momoi GIF" class="mx-auto rounded-full h-32 w-32 object-cover">
      </div>
      <div class="text-center text-gray-700 mb-6">
        File succes upload, rawURL result:
      </div>
      <div class="text-center">
        <a id="rawUrlLink" href="${rawUrl}" class="text-blue-500 hover:text-blue-700">${rawUrl}</a>
      </div>
      <div class="text-center mt-4">
        <button onclick="copyUrl()" class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline">Salin URL</button>
      </div>
    </div>
  </div>

  <script>
    function copyUrl() {
      const rawUrl = document.getElementById('rawUrlLink').href;
      navigator.clipboard.writeText(rawUrl).then(function() {
        alert("URL berhasil disalin: " + rawUrl);
      }).catch(function(error) {
        alert("Gagal menyalin URL: " + error);
      });
    }
  </script>
</body>
</html>
`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error uploading file.');
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
