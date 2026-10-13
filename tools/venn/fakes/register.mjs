// Node module hook so the real function file imports the fake @netlify/blobs in tests.
import { register } from 'node:module';
register('./resolve.mjs', import.meta.url);
