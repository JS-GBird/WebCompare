const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createServer } = require('http');
const net = require('net');

const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Update the getSlug function
function getSlug(url) {
  try {
    const parsedUrl = new URL(url);
    // Remove everything after the hash
    const pathWithoutHash = parsedUrl.pathname.split('#')[0];
    return pathWithoutHash.slice(1).replace(/\/$/, '') + parsedUrl.search;
  } catch (error) {
    console.error('Error parsing URL:', url, error);
    // Remove everything after the hash for non-URL strings as well
    return url.split('#')[0].split('://').pop().split('/').slice(1).join('/').replace(/\/$/, '');
  }
}

function normalizeUrl(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

async function checkRedirect(url, newDomain) {
  const fullUrl = url.startsWith('http') ? url : `https://${newDomain}/${url}`;
  try {
    const response = await axios.get(fullUrl, {
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
      timeout: 5000 // 5 seconds timeout
    });
    if (response.request.res.responseUrl !== fullUrl) {
      return getSlug(response.request.res.responseUrl);
    }
    return false;
  } catch (error) {
    console.log(`Error checking redirect for ${url}:`, error.message);
    return false;
  }
}

async function checkRedirectsBatch(links, newDomain, concurrency = 10) {
  const results = [];
  for (let i = 0; i < links.length; i += concurrency) {
    const batch = links.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(link => checkRedirect(link, newDomain)));
    results.push(...batchResults);
  }
  return results;
}

// In the compareJson function, filter out pages with '#' in the URL
async function compareJson(oldJson, newJson, progressCallback) {
  console.log('compareJson started');
  const differences = {};
  const uniqueOldUrls = new Set();
  const uniqueNewUrls = new Set();
  const missingLinks = new Set();
  const newUrlMap = new Map();

  // Initial progress
  progressCallback(0.05, 'Starting comparison');

  try {
    console.log('Processing newJson');
    const normalizedNewJson = {};
    Object.entries(newJson).forEach(([page, links]) => {
      const normalizedPage = normalizeUrl(page);
      if (normalizedNewJson.hasOwnProperty(normalizedPage)) {
        // Merge links if the page already exists
        normalizedNewJson[normalizedPage] = [...new Set([...normalizedNewJson[normalizedPage], ...links])];
      } else {
        normalizedNewJson[normalizedPage] = links;
      }
    });

    Object.entries(normalizedNewJson).forEach(([page, links]) => {
      const pageSlug = getSlug(page);
      if (!Array.isArray(links)) {
        throw new Error(`Invalid links for page ${page}: expected array, got ${typeof links}`);
      }
      links.forEach(link => {
        const linkSlug = getSlug(link);
        uniqueNewUrls.add(linkSlug);
        if (!newUrlMap.has(linkSlug)) {
          newUrlMap.set(linkSlug, new Set());
        }
        newUrlMap.get(linkSlug).add(pageSlug);
      });
    });

    progressCallback(0.15, 'Processed new JSON');

    console.log('Processing oldJson');
    const filteredOldJson = Object.fromEntries(
      Object.entries(oldJson).filter(([page]) => !page.includes('#'))
    );

    // Check if old pages still exist in the new website
    for (const [page, links] of Object.entries(filteredOldJson)) {
      const normalizedPage = normalizeUrl(page);
      const pageSlug = getSlug(normalizedPage);
      if (normalizedNewJson.hasOwnProperty(normalizedPage) || uniqueNewUrls.has(pageSlug)) {
        differences[pageSlug] = { missing: [], extra: [], redirected: [] };
        
        if (!Array.isArray(links)) {
          throw new Error(`Invalid links for page ${page}: expected array, got ${typeof links}`);
        }
        links.forEach(link => {
          const linkSlug = getSlug(link);
          uniqueOldUrls.add(linkSlug);
          if (!newUrlMap.has(linkSlug)) {
            missingLinks.add(linkSlug);
            differences[pageSlug].missing.push(linkSlug);
          }
        });
      } else {
        console.log(`Page ${page} no longer exists in the new website`);
      }
    }

    progressCallback(0.20, 'Identified existing pages');

    console.log('Unique URLs collected');
    console.log(`Old URLs: ${uniqueOldUrls.size}, New URLs: ${uniqueNewUrls.size}, Missing Links: ${missingLinks.size}`);
    progressCallback(0.25, 'Identified missing links');

    if (Object.keys(normalizedNewJson).length === 0) {
      throw new Error('New JSON is empty');
    }
    const newDomain = new URL(Object.keys(normalizedNewJson)[0]).hostname;
    console.log(`New domain: ${newDomain}`);

    console.log(`Checking redirects for ${missingLinks.size} missing links`);
    const redirectResults = await checkRedirectsBatch(Array.from(missingLinks), newDomain);
    redirectResults.forEach((redirectTo, index) => {
      const link = Array.from(missingLinks)[index];
      if (redirectTo) {
        Object.keys(differences).forEach(pageSlug => {
          const missingIndex = differences[pageSlug].missing.indexOf(link);
          if (missingIndex !== -1) {
            differences[pageSlug].missing.splice(missingIndex, 1);
            differences[pageSlug].redirected.push({ from: link, to: redirectTo });
          }
        });
      }
      if ((index + 1) % 100 === 0 || index === missingLinks.size - 1) {
        progressCallback(0.25 + (0.6 * (index + 1) / missingLinks.size), `Checking redirects (${index + 1}/${missingLinks.size})`);
      }
    });

    console.log('Finished checking redirects');

    // Double-check redirected links
    progressCallback(0.85, 'Verifying redirected links');
    Object.keys(differences).forEach(pageSlug => {
      const redirectedLinks = differences[pageSlug].redirected;
      for (let i = redirectedLinks.length - 1; i >= 0; i--) {
        const { from, to } = redirectedLinks[i];
        if (!uniqueNewUrls.has(to)) {
          redirectedLinks.splice(i, 1);
          differences[pageSlug].missing.push(from);
        }
      }
    });

    console.log('Identifying extra links');
    // Identify extra links
    Object.entries(normalizedNewJson).forEach(([page, links]) => {
      const pageSlug = getSlug(page);
      if (!differences[pageSlug]) {
        differences[pageSlug] = { missing: [], extra: [], redirected: [] };
      }
      links.forEach(link => {
        const linkSlug = getSlug(link);
        if (!uniqueOldUrls.has(linkSlug)) {
          differences[pageSlug].extra.push(linkSlug);
        }
      });
    });

    console.log('Comparison complete');
    progressCallback(0.95, 'Finalizing comparison');

    // Short delay to show the final progress
    await new Promise(resolve => setTimeout(resolve, 500));
    progressCallback(1, 'Comparison complete');

    return { differences };
  } catch (error) {
    console.error('Error in compareJson:', error);
    throw error;
  }
}

app.post('/compare', async (req, res) => {
  console.log('Received comparison request');

  const { oldJson, newJson } = req.body;
  console.log('Request body:', { oldJsonSize: JSON.stringify(oldJson).length, newJsonSize: JSON.stringify(newJson).length });

  if (!oldJson || !newJson || Object.keys(oldJson).length === 0 || Object.keys(newJson).length === 0) {
    console.log('Invalid input data');
    return res.status(400).json({ error: 'Invalid input data' });
  }

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Transfer-Encoding': 'chunked'
  });

  try {
    console.log('Starting comparison');
    const result = await compareJson(oldJson, newJson, (progress, status) => {
      console.log(`Progress: ${progress}, Status: ${status}`);
      res.write(JSON.stringify({ progress, status }) + '\n');
    });

    console.log('Sending final result:', result);
    res.write(JSON.stringify({ result }) + '\n');
    res.end();
  } catch (error) {
    console.error('Error during comparison:', error);
    res.write(JSON.stringify({ error: `An error occurred during comparison: ${error.message}`, stack: error.stack }) + '\n');
    res.end();
  }
});

function findAvailablePort(startPort, callback) {
  let port = startPort;

  function tryPort(portToTry) {
    const tester = net.createServer()
      .once('error', err => {
        if (err.code === 'EADDRINUSE') {
          tryPort(portToTry + 1);
        } else {
          callback(err);
        }
      })
      .once('listening', () => {
        tester.once('close', () => {
          callback(null, portToTry);
        }).close();
      })
      .listen(portToTry);
  }

  tryPort(port);
}

findAvailablePort(3001, (err, port) => {
  if (err) {
    console.error('No available ports found:', err);
    process.exit(1);
  }

  server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

module.exports = { compareJson };