import React, { useState, useCallback } from 'react';
import { 
  Button, 
  Container, 
  Grid, 
  Paper, 
  Typography, 
  Box,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Switch,
  FormControlLabel,
  CircularProgress,
  LinearProgress
} from '@mui/material';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DownloadIcon from '@mui/icons-material/Download';
import './JsonComparison.css';

function JsonComparison() {
  const [file1, setFile1] = useState(null);
  const [file2, setFile2] = useState(null);
  const [comparisonResult, setComparisonResult] = useState(null);
  const [error, setError] = useState(null);
  const [expandedPages, setExpandedPages] = useState(new Set());
  const [showOnlyDifferences, setShowOnlyDifferences] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [visibleDifferences, setVisibleDifferences] = useState({});

  const updateProgress = useCallback((newProgress) => {
    setProgress(prev => {
      console.log(`Updating progress: ${newProgress}%`);
      return newProgress;
    });
  }, []);

  const handleFileChange = (event, setFile) => {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        setFile(json);
        setError(null);
      } catch (error) {
        console.error('Error parsing JSON:', error);
        setError('Error parsing JSON file. Please ensure it\'s a valid JSON.');
      }
    };
    reader.readAsText(file);
  };

  const handleCompare = async () => {
    if (!file1 || !file2) {
      setError('Please select both JSON files');
      return;
    }

    setIsLoading(true);
    updateProgress(0);
    setComparisonResult(null);
    setError(null);

    try {
      console.log('Starting comparison...');
      const response = await fetch('http://localhost:3001/compare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file1, file2 }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let finalResult = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('Stream complete');
          if (buffer) {
            try {
              const finalChunk = JSON.parse(buffer);
              if ('differences' in finalChunk) {
                finalResult = finalChunk;
              }
            } catch (error) {
              console.error('Error parsing final chunk:', error);
            }
          }
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        console.log('Received chunk:', buffer);

        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const chunk = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          try {
            const parsedChunk = JSON.parse(chunk);
            console.log('Parsed chunk:', parsedChunk);
            if ('progress' in parsedChunk) {
              updateProgress(parsedChunk.progress);
            } else if ('differences' in parsedChunk) {
              finalResult = parsedChunk;
            }
          } catch (error) {
            console.error('Error parsing chunk:', error);
          }
        }
      }

      if (finalResult) {
        console.log('Final result:', finalResult);
        setComparisonResult(finalResult);
      } else {
        throw new Error('No comparison result received');
      }

      console.log('Comparison complete');
    } catch (error) {
      console.error('Error comparing files:', error);
      setError(`An error occurred while comparing the files: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const togglePage = (page) => {
    setExpandedPages((prev) => {
      const newExpandedPages = new Set(prev);
      if (newExpandedPages.has(page)) {
        newExpandedPages.delete(page);
      } else {
        newExpandedPages.add(page);
      }
      return newExpandedPages;
    });

    if (!comparisonResult) return;

    setVisibleDifferences((prev) => {
      const newVisibleDifferences = { ...prev };
      const normalizedPage = normalizeUrl(page, 'example.com');
      if (normalizedPage in comparisonResult.differences) {
        if (normalizedPage in newVisibleDifferences) {
          delete newVisibleDifferences[normalizedPage];
        } else {
          newVisibleDifferences[normalizedPage] = comparisonResult.differences[normalizedPage];
        }
      }
      return newVisibleDifferences;
    });
  };

  const renderJsonWithHighlights = (json, diffs, isOldSite) => {
    const domain = isOldSite ? 'http://website.1570.mijnsocialcms.nl' : 'https://www.gaasbeek.nl';
    const uniquePages = new Map();

    Object.entries(json).forEach(([page, links]) => {
      const normalizedPage = normalizeUrl(page, domain);
      if (!normalizedPage.includes('#')) {
        if (!uniquePages.has(normalizedPage)) {
          uniquePages.set(normalizedPage, links);
        } else {
          uniquePages.get(normalizedPage).push(...links);
        }
      }
    });

    const sortedEntries = Array.from(uniquePages.entries()).sort(([a], [b]) => a.localeCompare(b));

    return sortedEntries.map(([page, links], pageIndex) => {
      const sortedLinks = [...new Set(links.map(link => normalizeUrl(link, domain)))]
        .filter(link => link.trim() !== '')
        .sort();
      const pageDiffs = diffs[page] || {};

      if (sortedLinks.length === 0) {
        return null;
      }

      const filteredLinks = showOnlyDifferences
        ? sortedLinks.filter(url => 
            (isOldSite && pageDiffs.missing && pageDiffs.missing.includes(url)) ||
            (!isOldSite && pageDiffs.extra && pageDiffs.extra.includes(url))
          )
        : sortedLinks;

      if (filteredLinks.length === 0) {
        return null;
      }

      return (
        <Accordion 
          key={`${isOldSite ? 'old' : 'new'}-${pageIndex}-${page}`} 
          className="page-section"
          expanded={expandedPages.has(page)}
          onChange={() => togglePage(page)}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls={`panel${pageIndex}-content`}
            id={`panel${pageIndex}-header`}
          >
            <Typography className="page-url">
              {`${domain}/${page}`}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <ul>
              {filteredLinks.map((url, index) => {
                let className = '';
                if (isOldSite && pageDiffs.missing && pageDiffs.missing.includes(url)) {
                  className = 'missing';
                } else if (!isOldSite && pageDiffs.extra && pageDiffs.extra.includes(url)) {
                  className = 'added';
                }

                return (
                  <li key={`${isOldSite ? 'old' : 'new'}-${pageIndex}-${index}-${url}`} className={className}>
                    {url}
                  </li>
                );
              })}
            </ul>
          </AccordionDetails>
        </Accordion>
      );
    }).filter(Boolean);
  };

  const normalizeUrl = (url, domain) => {
    if (!url) return '';
    try {
      const parsedUrl = new URL(url, `http://${domain}`);
      let path = parsedUrl.pathname;
      path = removeTrailingSlash(path);
      return path.startsWith('/') ? path.slice(1) : path;
    } catch (error) {
      console.error('Error normalizing URL:', url, error);
      return url;
    }
  };

  const removeTrailingSlash = (path) => {
    return path.endsWith('/') ? path.slice(0, -1) : path;
  };

  const generateDifferencesJson = () => {
    if (!comparisonResult) return null;

    const differences = {};
    Object.entries(comparisonResult.differences).forEach(([page, diffs]) => {
      if (diffs.missing && diffs.missing.length > 0) {
        differences[page] = diffs.missing;
      }
    });

    return JSON.stringify(differences, null, 2);
  };

  const handleDownload = () => {
    const differencesJson = generateDifferencesJson();
    if (!differencesJson) return;

    const blob = new Blob([differencesJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'missing_links.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Container maxWidth="xl" className="json-comparison">
      <Paper elevation={3} className="input-section">
        <Typography variant="h4" gutterBottom>
          JSON Comparison Tool
        </Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={5}>
            <TextField
              fullWidth
              type="file"
              onChange={(e) => handleFileChange(e, setFile1)}
              accept=".json"
              label="Old Website JSON"
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} md={2} className="compare-icon">
            <CompareArrowsIcon fontSize="large" />
          </Grid>
          <Grid item xs={12} md={5}>
            <TextField
              fullWidth
              type="file"
              onChange={(e) => handleFileChange(e, setFile2)}
              accept=".json"
              label="New Website JSON"
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
        </Grid>
        <Box mt={2} display="flex" flexDirection="column" alignItems="center">
          <Box display="flex" justifyContent="center" gap={2} alignItems="center">
            <Button 
              variant="contained" 
              color="primary" 
              onClick={handleCompare}
              startIcon={<CompareArrowsIcon />}
              disabled={isLoading}
            >
              Compare
            </Button>
            {isLoading && <CircularProgress size={24} />}
            {comparisonResult && (
              <Button 
                variant="contained" 
                color="secondary" 
                onClick={handleDownload}
                startIcon={<DownloadIcon />}
              >
                Download Differences
              </Button>
            )}
          </Box>
          {isLoading && (
            <Box mt={2} width="100%" maxWidth={300}>
              <LinearProgress variant="determinate" value={progress} />
              <Typography variant="body2" color="textSecondary" align="center">
                {`${Math.round(progress)}%`}
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>

      {error && (
        <Paper elevation={3} className="error-section">
          <Typography color="error">{error}</Typography>
        </Paper>
      )}

      {comparisonResult && (
        <Paper elevation={3} className="results-section">
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={showOnlyDifferences}
                  onChange={(e) => setShowOnlyDifferences(e.target.checked)}
                  color="primary"
                />
              }
              label="Show only differences"
            />
          </Box>
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Typography variant="h6">Old Website Content:</Typography>
              {renderJsonWithHighlights(comparisonResult.oldSite, comparisonResult.differences, true)}
            </Grid>
            <Grid item xs={12} md={6}>
              <Typography variant="h6">New Website Content:</Typography>
              {renderJsonWithHighlights(comparisonResult.newSite, comparisonResult.differences, false)}
            </Grid>
          </Grid>
        </Paper>
      )}
    </Container>
  );
}

export default JsonComparison;
