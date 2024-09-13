const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.post('/compare', (req, res) => {
  console.log('Received comparison request');
  try {
    const { file1, file2 } = req.body;

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Transfer-Encoding': 'chunked'
    });

    console.log('Starting comparison');
    const differences = compareJson(file1, file2, (progress) => {
      console.log(`Progress: ${progress}%`);
      res.write(JSON.stringify({ progress }) + '\n');
    });

    console.log('Comparison complete, sending result');
    res.write(JSON.stringify({ differences, oldSite: file1, newSite: file2 }) + '\n');
    res.end();
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: error.message });
  }
});

function compareJson(obj1, obj2, progressCallback) {
  console.log('Comparing JSON objects');
  const differences = {};
  const normalizedObj1 = normalizeObject(obj1, 'website.1570.mijnsocialcms.nl');
  const normalizedObj2 = normalizeObject(obj2, 'www.gaasbeek.nl');

  const allKeys = new Set([...Object.keys(normalizedObj1), ...Object.keys(normalizedObj2)]);
  const totalKeys = allKeys.size;
  let processedKeys = 0;

  for (const key of allKeys) {
    const oldLinks = normalizedObj1[key] || [];
    const newLinks = normalizedObj2[key] || [];

    const pageDiffs = compareLinks(oldLinks, newLinks);
    if (Object.keys(pageDiffs).length > 0 || oldLinks.length !== newLinks.length) {
      differences[key] = {
        missing: oldLinks.filter(link => !newLinks.includes(link)),
        extra: newLinks.filter(link => !oldLinks.includes(link))
      };
    }

    processedKeys++;
    const progress = Math.round((processedKeys / totalKeys) * 100);
    progressCallback(progress);
  }

  return differences;
}

function normalizeObject(obj, domain) {
  const normalized = {};
  for (const [key, links] of Object.entries(obj)) {
    const normalizedKey = normalizeUrl(key, domain);
    if (!normalizedKey.includes('#')) {
      normalized[normalizedKey] = links.map(link => normalizeUrl(link, domain));
    }
  }
  return normalized;
}

function compareLinks(oldLinks, newLinks) {
  const pageDiffs = {};

  oldLinks.forEach((oldLink, index) => {
    if (!newLinks.includes(oldLink)) {
      pageDiffs[index] = { type: 'missing', value: oldLink };
    }
  });

  newLinks.forEach((newLink, index) => {
    if (!oldLinks.includes(newLink)) {
      pageDiffs[`new_${index}`] = { type: 'extra', value: newLink };
    }
  });

  return pageDiffs;
}

function normalizeUrl(url, domain) {
  try {
    const parsedUrl = new URL(url, `http://${domain}`);
    let path = parsedUrl.pathname;
    path = removeTrailingSlash(path);
    return path.startsWith('/') ? path.slice(1) : path;
  } catch (error) {
    console.error('Error normalizing URL:', url, error);
    return url;
  }
}

function removeTrailingSlash(path) {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
