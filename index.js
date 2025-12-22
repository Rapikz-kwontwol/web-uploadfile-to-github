const express = require('express');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const fs = require('fs');
const mime = require('mime-types');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000; // HTTP fallback port
const sslPort = process.env.SSL_PORT || 443; // HTTPS port

const githubToken = process.env.GITHUB_TOKEN; // https://github.com/settings/tokens
const owner = process.env.GITHUB_OWNER;  // GitHub username
const repo = process.env.GITHUB_REPO; // Repository name
const branch = process.env.GITHUB_BRANCH || 'main';

app.use(fileUpload());

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

/**
 * Helper to determine the request's protocol considering proxies
 */
function getRequestProtocol(req) {
  // x-forwarded-proto is set by proxies (e.g. nginx / Heroku)
  const forwarded = req.headers['x-forwarded-proto'];
  if (forwarded) return forwarded.split(',')[0].trim();
  // req.secure is true when using HTTPS
  if (req.secure) return 'https';
  return req.protocol || 'http';
}

/**
 * Generate a short mixed ID (alphanumeric) using crypto
 */
function generateId(length = 6) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(length);
  let id = '';
  for (let i = 0; i < length; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}

/**
 * Public file proxy endpoint:
 * - Client will request /files/<path/to/file> (no "uploads/" prefix)
 * - Server will fetch the file from GitHub at uploads/<path/to/file>
 * - Server responds with the proper Content-Type and the file bytes
 *
 * This keeps URLs clean (no "uploads/" in public URL) while files live in uploads/ in the repo.
 */
app.get('/files/*', async (req, res) => {
  const requestedPath = req.params[0]; // wildcard part after /files/
  if (!requestedPath) return res.status(400).send('Missing file path');

  // Map public path -> repo path (prepend uploads/)
  const gitPath = requestedPath.startsWith('uploads/') ? requestedPath : `uploads/${requestedPath}`;

  try {
    const resp = await axios.get(`https://api.github.com/repos/${owner}/${repo}/contents/${gitPath}?ref=${branch}`, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github.v3.raw'
      },
      responseType: 'arraybuffer',
      validateStatus: status => status < 500
    });

    if (resp.status === 200) {
      // Use requestedPath to determine content-type (so public URL extension is used)
      const contentType = mime.lookup(requestedPath) || 'application/octet-stream';
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=3600');
      return res.send(Buffer.from(resp.data));
    }

    // Fallback to metadata+content fetch
    const altResp = await axios.get(`https://api.github.com/repos/${owner}/${repo}/contents/${gitPath}?ref=${branch}`, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github.v3+json'
      },
      responseType: 'json'
    });

    if (altResp.status === 200 && altResp.data && altResp.data.content) {
      const buffer = Buffer.from(altResp.data.content, altResp.data.encoding || 'base64');
      const contentType = mime.lookup(requestedPath) || altResp.data.content_type || 'application/octet-stream';
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=3600');
      return res.send(buffer);
    }

    return res.status(404).send('File not found on GitHub');
  } catch (error) {
    console.error('Error proxying file:', error && error.message ? error.message : error);
    return res.status(500).send('Error fetching file from GitHub');
  }
});

app.post('/uploadfile', async (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send('No files were uploaded.');
  }

  let uploadedFile = req.files.file;
  let mimeType = mime.lookup(uploadedFile.name) || 'application/octet-stream';
  let extension = mime.extension(mimeType) || 'bin';

  // Generate short mixed ID instead of timestamp numeric ID
  let id = generateId(6); // contoh: "aZ3k9B"
  let fileName = `${id}.${extension}`;
  // Store in repo under uploads/, but public URL will be /files/<fileName> (no uploads/)
  let gitPath = `uploads/${fileName}`;
  let base64Content = Buffer.from(uploadedFile.data).toString('base64');

  try {
    let response = await axios.put(`https://api.github.com/repos/${owner}/${repo}/contents/${gitPath}`, {
      message: `Upload file ${fileName}`,
      content: base64Content,
      branch: branch,
    }, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        'Content-Type': 'application/json',
      },
    });

    // Build your "own domain" URL:
    // - If you set BASE_URL env var, use it (should include https://)
    // - Otherwise infer protocol from request (honor x-forwarded-proto)
    const protocol = getRequestProtocol(req);
    const baseWebUrl = process.env.BASE_URL || `${protocol}://${req.get('host')}`;
    // Public URL hides the 'uploads/' prefix
    const rawUrl = `${baseWebUrl}/files/${fileName}`;

    res.send(`
   <!DOCTYPE html>
<html lang="id" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Unggahan Berhasil</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="icon" type="image/x-icon" href="https://raw.githubusercontent.com/upload-file-lab/fileupload7/main/uploads/1766330286639.jpeg?format=png&name=900x900">
    
    <!-- Konfigurasi Tailwind untuk dark mode -->
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {}
            }
        }
    </script>
    
    <style>
        /* Mode gelap (dark mode) - Hitam Putih */
        body.dark-mode {
            background-color: #000000; /* Hitam */
            color: #ffffff; /* Putih */
            transition: all 0.3s ease-in-out;
        }
        
        /* Mode terang (light mode) - Putih Hitam */
        body.light-mode {
            background-color: #ffffff; /* Putih */
            color: #000000; /* Hitam */
            transition: all 0.3s ease-in-out;
        }
        
        /* Kartu untuk mode gelap */
        .dark-card {
            background-color: #111111; /* Hitam gelap */
            border: 1px solid #333333;
            box-shadow: 0 10px 25px rgba(255, 255, 255, 0.05);
            color: #ffffff;
        }
        
        /* Kartu untuk mode terang */
        .light-card {
            background-color: #ffffff; /* Putih */
            border: 1px solid #e5e7eb;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05);
            color: #000000;
        }
        
        .card-glow {
            transition: all 0.3s ease-in-out;
        }
        
        .card-glow:hover {
            transform: translateY(-5px);
            box-shadow: 0 20px 30px rgba(0, 0, 0, 0.1);
        }
        
        /* Tombol toggle */
        .theme-toggle {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 1000;
        }
        
        /* Tombol mode */
        .toggle-btn {
            background: linear-gradient(135deg, #000000 0%, #333333 100%);
            color: white;
            border: 1px solid #444444;
        }
        
        .toggle-btn-light {
            background: linear-gradient(135deg, #ffffff 0%, #f3f4f6 100%);
            color: black;
            border: 1px solid #d1d5db;
        }
        
        /* Container untuk URL */
        .url-container {
            border-radius: 0.75rem;
            overflow: hidden;
            transition: all 0.3s;
        }
        
        .dark-url-container {
            background-color: #1a1a1a;
            border: 1px solid #333333;
        }
        
        .light-url-container {
            background-color: #f9fafb;
            border: 1px solid #e5e7eb;
        }
        
        /* Animasi */
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .fade-in {
            animation: fadeIn 0.5s ease-out;
        }
        
        /* Hidden utility */
        .hidden {
            display: none;
        }
        
        /* Checkmark animation */
        .checkmark {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            display: block;
            stroke-width: 3;
            stroke: #10b981;
            stroke-miterlimit: 10;
            box-shadow: inset 0px 0px 0px #10b981;
            animation: fill .4s ease-in-out .4s forwards, scale .3s ease-in-out .9s both;
            position: relative;
            margin: 0 auto;
        }
        
        .checkmark-dark {
            background-color: #222222;
        }
        
        .checkmark-light {
            background-color: #f3f4f6;
        }
        
        .checkmark__circle {
            stroke-dasharray: 166;
            stroke-dashoffset: 166;
            stroke-width: 3;
            stroke-miterlimit: 10;
            stroke: #10b981;
            fill: none;
            animation: stroke .6s cubic-bezier(0.65, 0, 0.45, 1) forwards;
        }
        
        .checkmark__check {
            transform-origin: 50% 50%;
            stroke-dasharray: 48;
            stroke-dashoffset: 48;
            animation: stroke .3s cubic-bezier(0.65, 0, 0.45, 1) .8s forwards;
        }
        
        @keyframes stroke {
            100% { stroke-dashoffset: 0; }
        }
        
        @keyframes scale {
            0%, 100% { transform: none; }
            50% { transform: scale3d(1.1, 1.1, 1); }
        }
        
        @keyframes fill {
            100% { box-shadow: inset 0px 0px 0px 40px rgba(16, 185, 129, 0.1); }
        }
    </style>
</head>
<body class="flex flex-col items-center justify-center min-h-screen p-4 dark-mode">
    <!-- Tombol Toggle Dark/Light Mode -->
    <div class="theme-toggle">
        <button id="theme-toggle" type="button" class="p-3 rounded-full toggle-btn hover:opacity-90 transition duration-300 focus:outline-none focus:ring-2 focus:ring-gray-400">
            <!-- Ikon bulan (dark mode) -->
            <svg id="theme-toggle-dark-icon" class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"></path>
            </svg>
            <!-- Ikon matahari (light mode) -->
            <svg id="theme-toggle-light-icon" class="w-6 h-6 hidden" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" fill-rule="evenodd" clip-rule="evenodd"></path>
            </svg>
        </button>
    </div>

    <div class="dark-card p-8 rounded-xl shadow-2xl w-full max-w-md card-glow fade-in">
        <!-- Success Checkmark Animation -->
        <div class="mb-6">
            <div id="success-checkmark" class="checkmark checkmark-dark">
                <svg class="checkmark__svg" viewBox="0 0 52 52">
                    <circle class="checkmark__circle" cx="26" cy="26" r="25" fill="none"/>
                    <path class="checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
                </svg>
            </div>
        </div>
        
        <h1 class="text-3xl font-extrabold text-center mb-4">Unggahan Berhasil!</h1>
        <div class="text-center mb-6 text-md">
            File Anda berhasil diunggah. Berikut adalah tautan URL langsungnya:
        </div>
        
        <!-- URL Container -->
        <div class="url-container dark-url-container mb-6 p-4">
            <a id="rawUrlLink" href="${rawUrl}" class="block break-words hover:opacity-80 transition duration-200 font-semibold text-lg" target="_blank" rel="noopener noreferrer">
                ${rawUrl}
            </a>
            <div class="mt-2 text-sm opacity-70">
                Klik untuk membuka di tab baru
            </div>
        </div>
        
        <!-- Action Buttons -->
        <div class="flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0 sm:space-x-4">
            <button onclick="copyUrl()" class="w-full sm:w-1/2 bg-gradient-to-r from-gray-800 to-gray-900 hover:from-gray-900 hover:to-black text-white font-bold py-3 px-4 rounded-full shadow-lg transform hover:scale-105 transition duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-gray-400">
                <div class="flex items-center justify-center">
                    <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                    </svg>
                    Salin URL
                </div>
            </button>
            
            <a href="/" class="w-full sm:w-1/2 flex items-center justify-center bg-gradient-to-r from-gray-300 to-gray-400 hover:from-gray-400 hover:to-gray-500 text-gray-800 font-bold py-3 px-4 rounded-full shadow-lg transform hover:scale-105 transition duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-gray-400">
                <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
                </svg>
                Kembali
            </a>
        </div>  

    <!-- Success Notification (Hidden by default) -->
    <div id="copy-success" class="fixed top-20 right-4 bg-green-500 text-white px-4 py-3 rounded-lg shadow-lg hidden fade-in z-50">
        URL berhasil disalin!
    </div>

    <script>
        // Element references
        const themeToggleBtn = document.getElementById('theme-toggle');
        const themeToggleDarkIcon = document.getElementById('theme-toggle-dark-icon');
        const themeToggleLightIcon = document.getElementById('theme-toggle-light-icon');
        const body = document.body;
        const card = document.querySelector('.dark-card');
        const urlContainer = document.querySelector('.url-container');
        const successCheckmark = document.getElementById('success-checkmark');
        const copySuccess = document.getElementById('copy-success');
        
        // Inisialisasi URL - ganti ini dengan URL sebenarnya dari backend
        const rawUrl = "${rawUrl}" || "https://example.com/uploaded-file.png";
        const rawUrlLink = document.getElementById('rawUrlLink');
        rawUrlLink.href = rawUrl;
        rawUrlLink.textContent = rawUrl;

        // Fungsi untuk menerapkan tema
        function applyTheme(isDarkMode) {
            if (isDarkMode) {
                body.classList.remove('light-mode');
                body.classList.add('dark-mode');
                card.classList.remove('light-card');
                card.classList.add('dark-card');
                urlContainer.classList.remove('light-url-container');
                urlContainer.classList.add('dark-url-container');
                successCheckmark.classList.remove('checkmark-light');
                successCheckmark.classList.add('checkmark-dark');
                
                // Update tombol toggle
                themeToggleBtn.classList.remove('toggle-btn-light');
                themeToggleBtn.classList.add('toggle-btn');
                
                // Update ikon
                themeToggleDarkIcon.classList.remove('hidden');
                themeToggleLightIcon.classList.add('hidden');
            } else {
                body.classList.add('light-mode');
                body.classList.remove('dark-mode');
                card.classList.remove('dark-card');
                card.classList.add('light-card');
                urlContainer.classList.remove('dark-url-container');
                urlContainer.classList.add('light-url-container');
                successCheckmark.classList.remove('checkmark-dark');
                successCheckmark.classList.add('checkmark-light');
                
                // Update tombol toggle
                themeToggleBtn.classList.remove('toggle-btn');
                themeToggleBtn.classList.add('toggle-btn-light');
                
                // Update ikon
                themeToggleDarkIcon.classList.add('hidden');
                themeToggleLightIcon.classList.remove('hidden');
            }
        }

        // Cek preferensi tema
        if (localStorage.getItem('color-theme') === 'light') {
            applyTheme(false);
        } else {
            applyTheme(true); // Default dark mode
        }

        // Toggle tema
        themeToggleBtn.addEventListener('click', function() {
            const isDarkMode = body.classList.contains('dark-mode');
            
            if (isDarkMode) {
                localStorage.setItem('color-theme', 'light');
                applyTheme(false);
            } else {
                localStorage.setItem('color-theme', 'dark');
                applyTheme(true);
            }
        });

        // Fungsi untuk menyalin URL
        function copyUrl() {
            const rawUrl = document.getElementById('rawUrlLink').href;
            
            navigator.clipboard.writeText(rawUrl).then(function() {
                // Tampilkan notifikasi sukses
                copySuccess.classList.remove('hidden');
                copySuccess.classList.add('fade-in');
                
                // Sembunyikan notifikasi setelah 3 detik
                setTimeout(() => {
                    copySuccess.classList.remove('fade-in');
                    setTimeout(() => {
                        copySuccess.classList.add('hidden');
                    }, 300);
                }, 3000);
                
            }).catch(function(error) {
                // Fallback untuk browser lama
                const textArea = document.createElement("textarea");
                textArea.value = rawUrl;
                document.body.appendChild(textArea);
                textArea.select();
                
                try {
                    document.execCommand('copy');
                    // Tampilkan notifikasi sukses
                    copySuccess.textContent = "URL berhasil disalin!";
                    copySuccess.classList.remove('hidden');
                    copySuccess.classList.add('fade-in');
                    
                    // Sembunyikan notifikasi setelah 3 detik
                    setTimeout(() => {
                        copySuccess.classList.remove('fade-in');
                        setTimeout(() => {
                            copySuccess.classList.add('hidden');
                        }, 300);
                    }, 3000);
                } catch (err) {
                    copySuccess.textContent = "Gagal menyalin URL";
                    copySuccess.classList.remove('bg-green-500', 'hidden');
                    copySuccess.classList.add('bg-red-500', 'fade-in');
                    
                    // Sembunyikan notifikasi setelah 3 detik
                    setTimeout(() => {
                        copySuccess.classList.remove('fade-in');
                        setTimeout(() => {
                            copySuccess.classList.add('hidden');
                        }, 300);
                    }, 3000);
                }
                
                document.body.removeChild(textArea);
            });
        }

        // Animasi checkmark saat halaman dimuat
        document.addEventListener('DOMContentLoaded', function() {
            // Reset animasi checkmark
            const checkmarkCircle = document.querySelector('.checkmark__circle');
            const checkmarkCheck = document.querySelector('.checkmark__check');
            
            // Reset stroke-dashoffset
            checkmarkCircle.style.strokeDashoffset = '166';
            checkmarkCheck.style.strokeDashoffset = '48';
            
            // Trigger animasi setelah delay kecil
            setTimeout(() => {
                checkmarkCircle.style.animation = 'stroke 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards';
                checkmarkCheck.style.animation = 'stroke 0.3s cubic-bezier(0.65, 0, 0.45, 1) 0.8s forwards';
            }, 100);
        });
    </script>
</body>
</html>
`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error uploading file.');
  }
});

/**
 * Start server:
 * - If SSL key/cert available, start HTTPS server
 * - Also start HTTP server to redirect traffic to HTTPS (recommended)
 *
 * Provide SSL_KEY_PATH and SSL_CERT_PATH env variables or place certs in ./certs/
 */
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || './certs/privkey.pem';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || './certs/fullchain.pem';
const enforceHttps = process.env.FORCE_HTTPS === 'true';

const hasSslFiles = fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH);

if (hasSslFiles) {
  const key = fs.readFileSync(SSL_KEY_PATH);
  const cert = fs.readFileSync(SSL_CERT_PATH);

  // HTTPS server
  https.createServer({ key, cert }, app).listen(sslPort, () => {
    console.log(`HTTPS Server running at https://0.0.0.0:${sslPort}`);
  });

  // HTTP -> HTTPS redirect
  http.createServer((req, res) => {
    const host = req.headers.host ? req.headers.host.split(':')[0] : 'localhost';
    const redirectUrl = `https://${host}${req.url}`;
    res.writeHead(301, { Location: redirectUrl });
    res.end();
  }).listen(80, () => {
    console.log('HTTP -> HTTPS redirect server running on port 80');
  });
} else if (enforceHttps) {
  console.error(`SSL files not found at ${SSL_KEY_PATH} and ${SSL_CERT_PATH}. Exiting because FORCE_HTTPS=true.`);
  process.exit(1);
} else {
  // Fallback: start plain HTTP (useful for dev)
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port} (no SSL found)`);
    console.log('To enable HTTPS provide SSL_KEY_PATH and SSL_CERT_PATH or set up a reverse proxy (nginx) with TLS.');
  });
}
