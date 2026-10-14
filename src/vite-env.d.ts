/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the teledrive-backend service. Default: http://localhost:3000 */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}