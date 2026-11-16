import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

// Serve build-time pages from Workers assets; API routes remain dynamic.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
