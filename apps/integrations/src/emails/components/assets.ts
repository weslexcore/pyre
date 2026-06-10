// Email images are served by the landing page deployment (email clients
// can't load local assets, and import.meta.env is unavailable in the
// react-email preview server, so this stays a plain constant).
export const ASSET_BASE = 'https://pyresauna.com/email';
