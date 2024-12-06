import type { ExtendedFile, FileSetter } from '~/common';
import useSetFilesToDelete from './useSetFilesToDelete';

export default function useUpdateFiles(setFiles: FileSetter) {
  const setFilesToDelete = useSetFilesToDelete();

  const addFile = (newFile: ExtendedFile) => {
    console.log('addFile called with:', newFile);
    setFiles((currentFiles) => {
      console.log('addFile currentFiles:', currentFiles);
      const updatedFiles = new Map(currentFiles);
      updatedFiles.set(newFile.file_id, newFile);
      console.log('addFile updatedFiles:', updatedFiles);
      return updatedFiles;
    });
  };

  const replaceFile = (newFile: ExtendedFile) => {
    console.log('replaceFile called with:', newFile);
    setFiles((currentFiles) => {
      console.log('replaceFile currentFiles:', currentFiles);
      const updatedFiles = new Map(currentFiles);
      updatedFiles.set(newFile.file_id, newFile);
      console.log('replaceFile updatedFiles:', updatedFiles);
      return updatedFiles;
    });
  };

  const updateFileById = (fileId: string, updates: Partial<ExtendedFile>, isEntityFile = false) => {
    console.log('updateFileById called with:', { fileId, updates, isEntityFile });
    setFiles((currentFiles) => {
      console.log('updateFileById currentFiles:', currentFiles);

      if (!currentFiles.has(fileId)) {
        console.warn(`updateFileById: File with id ${fileId} not found.`);
        return currentFiles;
      }

      const updatedFiles = new Map(currentFiles);
      const currentFile = updatedFiles.get(fileId);
      console.log('updateFileById currentFile:', currentFile);

      if (!currentFile) {
        console.warn(`updateFileById: File with id ${fileId} not found.`);
        return currentFiles;
      }

      updatedFiles.set(fileId, { ...currentFile, ...updates });
      console.log('updateFileById updatedFile:', updatedFiles.get(fileId));

      const filepath = updates['filepath'] ?? '';
      if (filepath && updates['progress'] !== 1 && !isEntityFile) {
        const files = Object.fromEntries(updatedFiles);
        console.log('updateFileById setting filesToDelete:', files);
        setFilesToDelete(files);
      }

      return updatedFiles;
    });
  };

  const deleteFileById = (fileId: string) => {
    console.log('deleteFileById called with:', fileId);
    setFiles((currentFiles) => {
      console.log('deleteFileById currentFiles:', currentFiles);

      const updatedFiles = new Map(currentFiles);
      if (updatedFiles.has(fileId)) {
        updatedFiles.delete(fileId);
        console.log(`deleteFileById: File with id ${fileId} deleted.`);
      } else {
        console.warn(`deleteFileById: File with id ${fileId} not found.`);
      }

      const files = Object.fromEntries(updatedFiles);
      console.log('deleteFileById setting filesToDelete:', files);
      setFilesToDelete(files);
      return updatedFiles;
    });
  };

  return {
    addFile,
    replaceFile,
    updateFileById,
    deleteFileById,
  };
}
