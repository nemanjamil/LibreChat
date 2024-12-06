const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { FileSources } = require('librechat-data-provider');
const { logger } = require('~/config');

/**
 * Deletes a file from the vector database. This function takes a file object, constructs the full path, and
 * verifies the path's validity before deleting the file. If the path is invalid, an error is thrown.
 *
 * @param {Express.Request} req - The request object from Express. It should have an `app.locals.paths` object with
 *                       a `publicPath` property.
 * @param {MongoFile} file - The file object to be deleted. It should have a `filepath` property that is
 *                           a string representing the path of the file relative to the publicPath.
 *
 * @returns {Promise<void>}
 *          A promise that resolves when the file has been successfully deleted, or throws an error if the
 *          file path is invalid or if there is an error in deletion.
 */
const deleteVectors = async (req, file) => {
  if (!file.embedded || !process.env.RAG_API_URL) {
    logger.warn('File is not embedded or RAG_API_URL is missing. Skipping deletion.');
    return;
  }

  try {
    const jwtToken = req.headers.authorization?.split(' ')[1];
    if (!jwtToken) {
      throw new Error('Authorization token is missing.');
    }

    logger.info(`Attempting to delete vectors for file_id: ${file.file_id}`);

    // Payload for the delete request
    const payload = {
      file_id: file.file_id,
    };

    // Make the delete request to the RAG API
    await axios.post(
      `${process.env.RAG_API_URL}/deleteFile`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    logger.info(`Successfully deleted vectors for file_id: ${file.file_id}`);
  } catch (error) {
    logger.error(`Error deleting vectors for file_id: ${file.file_id}`, error);
    throw new Error(error.message || 'An error occurred during file deletion.');
  }
};




/**
 * Uploads a file to the configured Vector database
 *
 * @param {Object} params - The params object.
 * @param {Object} params.req - The request object from Express. It should have a `user` property with an `id`
 *                       representing the user, and an `app.locals.paths` object with an `uploads` path.
 * @param {Express.Multer.File} params.file - The file object, which is part of the request. The file object should
 *                                     have a `path` property that points to the location of the uploaded file.
 * @param {string} params.file_id - The file ID.
 *
 * @returns {Promise<{ filepath: string, bytes: number }>}
 *          A promise that resolves to an object containing:
 *            - filepath: The path where the file is saved.
 *            - bytes: The size of the file in bytes.
 */
async function uploadVectors({ req, file, file_id, assistant_id = null, conversation_id = null, tool_resource = null }) {
  logger.info(`Assistant ID received in uploadVectors: ${assistant_id}`);
  logger.info(`Conversation ID received in uploadVectors: ${conversation_id}`);

  if (!process.env.RAG_API_URL) {
    logger.error('RAG_API_URL is not defined in the environment variables.');
    throw new Error('RAG_API_URL not defined');
  }

  try {
    const jwtToken = req.headers.authorization?.split(' ')[1];
    if (!jwtToken) {
      logger.error('JWT token is missing in the Authorization header.');
      throw new Error('JWT token is missing');
    }

    const formData = new FormData();
    formData.append('file_id', file_id);
    formData.append('file', fs.createReadStream(file.path));

    if (assistant_id) formData.append('assistant_id', assistant_id);
    if (conversation_id) formData.append('conversation_id', conversation_id);
    if (tool_resource) formData.append('tool_resource', tool_resource);

    logger.info(`Sending POST request to RAG API with FormData containing file_id: ${file_id}`);
    const response = await axios.post(`${process.env.RAG_API_URL}/upload`, formData, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        accept: 'application/json',
        ...formData.getHeaders(),
      },
    });

    const responseData = response.data;
    logger.debug(`Response from RAG API: ${JSON.stringify(responseData)}`);

    if (!responseData.document_ids || responseData.document_ids.length === 0) {
      logger.error('Embedding failed. No document IDs returned.');
      throw new Error('Embedding failed. No document IDs returned.');
    }

    logger.info(`File embedding successful for file_id: ${file_id}`);
    return {
      bytes: file.size,
      filename: file.originalname,
      filepath: 'vectordb',
      embedded: true,
    };
  } catch (error) {
    logger.error(`Error embedding file for file_id: ${file_id}`, error);
    throw new Error(error.message || 'An error occurred during file upload.');
  }
}





module.exports = {
  deleteVectors,
  uploadVectors,
};
