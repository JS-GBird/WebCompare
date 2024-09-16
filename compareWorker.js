const { compareJson } = require('./server.js');

process.on('message', async (message) => {
  const { file1, file2 } = message;
  try {
    const differences = await compareJson(file1, file2, (progress) => {
      process.send({ progress });
    });
    process.send({ result: { oldSite: file1, newSite: file2, differences } });
  } catch (error) {
    console.error('Error in worker:', error);
    process.send({ error: error.message });
  }
});
