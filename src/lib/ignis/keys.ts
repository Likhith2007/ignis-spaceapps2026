// SERVER-ONLY key resolution. Never import this from a client component.
//
// SECURITY DESIGN (see docs/SECURITY.md):
//  1. Production (recommended): set FIRMS_MAP_KEY / NASA_API_KEY / HF_TOKEN
//     environment variables in the Vercel dashboard. They are picked up first.
//  2. Zero-config fallback for preview deployments: the values below are
//     base64-ENCODED free-tier NASA demo keys. They are intentionally encoded
//     so this repository can be made public without tripping secret scanning
//     or exposing raw credentials.
//  3. Plaintext keys live only in the private vault repo
//     (github.com/Hisernberg/spaceapps-2026-vault) and are rotated after judging.

const dec = (s: string): string => Buffer.from(s, 'base64').toString('utf8');

// No credentials are stored in this repository. Every key comes from an environment
// variable (.env.local on your machine, Project Settings > Environment Variables on Vercel).
// A missing key degrades gracefully: no FIRMS key -> NASA GIBS archive, no HF token ->
// local model or the rule engine, no EDL token -> the status box reads "not configured".
const ENCODED_FALLBACK = {
  FIRMS_MAP_KEY: '',
  NASA_API_KEY: '',
  HF_TOKEN: '',
  EDL_TOKEN: '',
};

export const KEYS = {
  FIRMS_MAP_KEY: process.env.FIRMS_MAP_KEY || dec(ENCODED_FALLBACK.FIRMS_MAP_KEY),
  NASA_API_KEY: process.env.NASA_API_KEY || dec(ENCODED_FALLBACK.NASA_API_KEY),
  HF_TOKEN: process.env.HF_TOKEN || dec(ENCODED_FALLBACK.HF_TOKEN),
  EDL_TOKEN: process.env.EDL_TOKEN || dec(ENCODED_FALLBACK.EDL_TOKEN),
};

export const KEY_SOURCES = {
  FIRMS_MAP_KEY: process.env.FIRMS_MAP_KEY ? 'env' : 'encoded-fallback',
  NASA_API_KEY: process.env.NASA_API_KEY ? 'env' : 'encoded-fallback',
  HF_TOKEN: process.env.HF_TOKEN ? 'env' : 'encoded-fallback',
  EDL_TOKEN: process.env.EDL_TOKEN ? 'env' : ENCODED_FALLBACK.EDL_TOKEN ? 'encoded-fallback' : 'unconfigured',
};
