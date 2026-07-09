/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GATE_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
