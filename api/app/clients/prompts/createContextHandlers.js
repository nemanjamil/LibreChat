const axios = require('axios');
const { isEnabled } = require('~/server/utils');
const { logger } = require('~/config');
const { getFilesByAssistantId } = require('~/models/File');
const { file } = require('googleapis/build/src/apis/file');

const footer = `Use the context as your learned knowledge to better answer the user.

In your response, remember to follow these guidelines:
- If you don't know the answer, simply say that you don't know.
- If you are unsure how to answer, ask for clarification.
- Avoid mentioning that you obtained the information from the context.
`;

function createContextHandlers(req, userMessageContent) {
  logger.info('We are in createContextHandlers');
  if (!process.env.RAG_API_URL) {
    return;
  }

  const queryPromises = [];
  const processedFiles = [];
  const processedIds = new Set();
  const jwtToken = req.headers.authorization.split(' ')[1];

const queryAllFiles = async (file_ids = null, file_idFromChat = null) => {
    logger.debug('Entering queryAllFiles with file_ids:', file_ids);
    logger.debug('Entering queryAllFiles with file_idFromChat:', file_idFromChat);


    
    const payload = new URLSearchParams(); // Use URLSearchParams for form data

    if(file_idFromChat) {
      logger.debug("we are in idfromchat")
      payload.append('file_ids', file_idFromChat);
      payload.append('query', userMessageContent);
      payload.append('k', 4);


    }
    // Clean file_ids
    else if(file_ids) {
      const cleanedFileIds = file_ids.map((id) => id.replace(/"/g, '')).join(','); // Convert to comma-separated string

      payload.append('file_ids', cleanedFileIds);
      payload.append('query', userMessageContent);
      payload.append('k', 4);
    }
    

    logger.info('Query payload:', payload);
    try {
        const response = await axios.post(
            `${process.env.RAG_API_URL}/query`,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${jwtToken}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );

        if (!response || !response.data) {
            logger.warn('Query response is invalid:', response);
            return { data: [] };
        }
        logger.debug('Query response received for file_ids:', file_idFromChat, 'Response:', response.data);

        logger.debug('Query response received for file_ids:', file_ids, 'Response:', response.data);
        return response.data;
    } catch (error) {
        logger.error('Error querying files:', file_ids, error.response?.data || error.message);
        throw error;
    }
};

  
  
  
  
  



const processAllFiles = async (assistant_id) => {
  logger.debug('Starting processAllFiles with assistant_id:', assistant_id);

  if (!assistant_id) {
    const errorMsg = 'Missing assistant_id in processAllFiles';
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  try {
    logger.debug(`Fetching files for assistant_id: ${assistant_id}`);
    const files = await getFilesByAssistantId(assistant_id);
    logger.debug(`Files retrieved for assistant_id ${assistant_id}:`, files);

    if (!files || files.length === 0) {
      logger.debug(`No files found for assistant_id: ${assistant_id}`);
      return;
    }

    const fileIdsToProcess = files
      .filter((file) => !processedIds.has(file.file_id))
      .map((file) => file.file_id);

    if (fileIdsToProcess.length === 0) {
      logger.debug('No new files to process. All files are already processed.');
      return;
    }

    logger.debug(`Querying files: ${fileIdsToProcess.join(', ')}`);

    // Query all unprocessed files in one batch
    const results = await queryAllFiles(fileIdsToProcess, null);
    logger.debug('Results from queryAllFiles:', results);

    // Map results to fileContext
    const fileContext = {
      content: results.similar_contents.join('\n'), // Combine similar_contents into a single string
    };

    // Mark all queried files as processed
    fileIdsToProcess.forEach((fileId) => processedIds.add(fileId));

    logger.debug('Files processed successfully:', fileIdsToProcess);

    return fileContext;
  } catch (error) {
    logger.error('Error in processAllFiles:', error);
    throw error;
  }
};





  

  const createContext = async () => {
    logger.debug('Entering createContext...');
  
    try {
      if (!queryPromises.length || !processedFiles.length) {
        logger.info('No files or query promises available.');
        return '';
      }
  
      const oneFile = processedFiles.length === 1;
      logger.debug(`Generating context for ${processedFiles.length} file(s).`);
  
      const header = `The user has attached ${oneFile ? 'a' : processedFiles.length} file${!oneFile ? 's' : ''} to the conversation:`;
      logger.debug('Header:', header);
  
      const files = processedFiles
        .map(file => `<file><filename>${file.filename}</filename><type>${file.type}</type></file>`)
        .join('');
      logger.debug('File tags generated:', files);
  
      const resolvedQueries = await Promise.all(queryPromises);
      logger.debug('Resolved queries:', resolvedQueries);
  
      // Validate each query result
      const context = resolvedQueries.map((queryResult, index) => {
        if (!queryResult || !queryResult.data) {
          logger.warn(`Query result at index ${index} is invalid:`, queryResult);
          return `<file><filename>${processedFiles[index]?.filename}</filename><context>No valid data found for this file.</context></file>`;
        }
  
        const file = processedFiles[index];
        const contextItems = queryResult.data
          .map(item => {
            const pageContent = item[0]?.page_content?.trim() || 'No content';
            return `<contextItem><![CDATA[${pageContent}]]></contextItem>`;
          })
          .join('');
  
        return `<file><filename>${file.filename}</filename><context>${contextItems}</context></file>`;
      }).join('');
  
      logger.debug('Context generated:', context);
  
      const prompt = `${header}${files}<context>${context}</context>`;
      logger.debug('Context prompt created:', prompt);
  
      return prompt;
    } catch (error) {
      logger.error('Error in createContext:', error);
      throw error;
    }
  };
  
  
  

  return {
    processAllFiles,
    queryAllFiles,
    createContext,
  };
}

module.exports = createContextHandlers;