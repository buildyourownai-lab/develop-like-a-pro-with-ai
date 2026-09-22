/**
 * Typed error thrown when required Gemini environment configuration is
 * missing, so the classifier can rely on instanceof rather than matching
 * substrings of error.message.
 */
export class GeminiConfigMissingError extends Error {}
