export interface TeleFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  folderPath: string; // virtual folder path (e.g. "/" or "/Documents")
  messageId: number;
  channelId: string;
  uploadedAt: number;
  starred?: boolean;
  trashed?: boolean;
  archived?: boolean;
  lastOpenedAt?: number;
  thumbnailUrl?: string;
  offline?: boolean;
}

export interface SelectedFile {
  name: string;
  size: number;
  path: string;
  data?: Uint8Array;
  type: string;
}

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  file?: SelectedFile | File;
  folderPath?: string;
  error?: string;
}
