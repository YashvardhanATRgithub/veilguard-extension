/**
 * Privacy instruction prepended to redacted user messages so that AI chatbots
 * treat placeholder tokens (PERSON_1, EMAIL_1 …) as real values and respond
 * naturally without questioning them.
 */

export const PRIVACY_INSTRUCTION =
    '[Privacy note: Some values in this message have been replaced with privacy ' +
    'placeholders (e.g., PERSON_1, EMAIL_1) by a browser extension. Treat these ' +
    'placeholders as real values and respond naturally — do not mention or ' +
    'question the placeholders.]\n\n';

/**
 * Prepend the privacy instruction to a text string.
 * @param {string} text
 * @returns {string}
 */
export function prependInstruction(text) {
    if (typeof text !== 'string') return text;
    return PRIVACY_INSTRUCTION + text;
}
