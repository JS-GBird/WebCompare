import React, { useState, useEffect } from 'react';
import { Typography, Accordion, AccordionSummary, AccordionDetails, Paper, Grid, Box, Button, TextField, CircularProgress, LinearProgress } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import './JsonComparison.css';

function JsonComparison() {
  const [file1, setFile1] = useState(null);
  const [file2, setFile2] = useState(null);
  const [comparisonResult, setComparisonResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');

  useEffect(() => {
    fetch('http://localhost:3001/health')
      .then(response => {
        if (!response.ok) {
          throw new Error('Server health check failed');
        }
        console.log('Server is reachable');
      })
      .catch(error => {
        console.error('Error reaching server:', error);
        setError('Unable to reach the comparison server. Please check if it\'s running.');
      });
  }, []);

  const handleFileChange = (event, setFile) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target.result);
          setFile(json);
          setError(null);
        } catch (error) {
          console.error('Error parsing JSON:', error);
          setError('Error parsing JSON file. Please ensure it\'s a valid JSON.');
          setFile(null);
        }
      };
      reader.readAsText(file);
    } else {
      setFile(null);
    }
  };

  const handleCompare = async () => {
    if (!file1 || !file2) {
      setError('Please select both files before comparing.');
      return;
    }

    setIsLoading(true);
    setComparisonResult(null);
    setError(null);
    setProgress(0);
    setStatus('Starting comparison');

    console.log('Initiating comparison request'); // Debug log

    try {
      const response = await fetch('http://localhost:3001/compare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ oldJson: file1, newJson: file2 }),
      });

      console.log('Received response:', response); // Debug log

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        
        console.log('Received chunk:', chunk); // Debug log

        // Process each line in the chunk
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              if (data.progress !== undefined) {
                setProgress(data.progress * 100);
                setStatus(data.status);
              } else if (data.result) {
                setComparisonResult(data.result);
                return; // Exit the function once we have the result
              } else if (data.error) {
                throw new Error(data.error);
              }
            } catch (parseError) {
              console.error('Error parsing JSON:', parseError, 'Line:', line);
            }
          }
        }
      }

      // If we've reached this point without setting a result, throw an error
      throw new Error('No valid comparison result received');

    } catch (error) {
      console.error('Error fetching comparison:', error);
      setError(`An error occurred during comparison: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const isCompareButtonEnabled = file1 !== null && file2 !== null && !isLoading;

  return (
    <div>
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
        <Box mt={2} display="flex" flexDirection="column" alignItems="center" gap={2}>
          <Box display="flex" justifyContent="center" gap={2} alignItems="center">
            <Button 
              variant="contained" 
              color="primary" 
              onClick={handleCompare}
              startIcon={<CompareArrowsIcon />}
              disabled={!isCompareButtonEnabled}
            >
              Compare
            </Button>
            {isLoading && <CircularProgress size={24} />}
          </Box>
          {isLoading && (
            <Box width="100%" mt={2}>
              <LinearProgress variant="determinate" value={progress} />
              <Typography variant="body2" color="textSecondary" align="center">
                {`${Math.round(progress)}% - ${status}`}
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
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <Paper elevation={3} className="result-section">
              <Typography variant="h5" gutterBottom>Old Site</Typography>
              {renderJsonWithHighlights(file1, comparisonResult.differences, true)}
            </Paper>
          </Grid>
          <Grid item xs={6}>
            <Paper elevation={3} className="result-section">
              <Typography variant="h5" gutterBottom>New Site</Typography>
              {renderJsonWithHighlights(file2, comparisonResult.differences, false)}
            </Paper>
          </Grid>
        </Grid>
      )}
    </div>
  );
}

const renderJsonWithHighlights = (json, differences, isOldSite) => {
  console.log('renderJsonWithHighlights input:', { json, differences, isOldSite });

  if (!json || !differences) {
    console.log('No comparison result available');
    return <Typography>No comparison result available.</Typography>;
  }

  const getSlug = (url) => {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.pathname.slice(1).replace(/\/$/, '') + parsedUrl.search + parsedUrl.hash;
    } catch (error) {
      console.error('Error parsing URL:', url, error);
      return url.split('://').pop().split('/').slice(1).join('/').replace(/\/$/, '');
    }
  };

  return Object.entries(json).map(([page, links]) => {
    const pageSlug = getSlug(page);
    const pageDifferences = differences[pageSlug] || { missing: [], extra: [], redirected: [] };

    console.log('Processing page:', { page, pageSlug, links, pageDifferences });

    return (
      <Accordion key={page}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography>{page}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <ul>
            {links.map((link, index) => {
              const linkSlug = getSlug(link);
              let className = '';
              let redirectTo = '';

              if (isOldSite) {
                if (pageDifferences.missing.includes(linkSlug)) {
                  className = 'missing';
                } else if (pageDifferences.redirected.some(r => r.from === linkSlug)) {
                  className = 'redirected';
                  redirectTo = pageDifferences.redirected.find(r => r.from === linkSlug).to;
                }
              } else {
                if (pageDifferences.extra.includes(linkSlug)) {
                  className = 'added';
                } else if (pageDifferences.redirected.some(r => r.to === linkSlug)) {
                  // Don't highlight redirected links on the new site
                  className = '';
                }
              }
              
              console.log('Link classification:', { link, linkSlug, className, isOldSite, redirectTo });
              
              return (
                <li key={index} className={className}>
                  {linkSlug}
                  {redirectTo && <span className="redirect-info"> → {redirectTo}</span>}
                </li>
              );
            })}
          </ul>
        </AccordionDetails>
      </Accordion>
    );
  });
};

export default JsonComparison;
