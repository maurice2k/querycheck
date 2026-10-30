'use strict';

const TAG = Symbol.for('querycheck.error');

/**
 * Base type of all QueryCheck errors: `err instanceof QueryCheckError`.
 *
 * The concrete errors extend the matching built-in error (SyntaxError,
 * TypeError, Error), so they cannot share a base class; instanceof checks a
 * tag instead.
 */
class QueryCheckError extends Error {
    /**
     * @param {any} value
     * @returns {boolean}
     */
    static [Symbol.hasInstance](value) {
        return value !== null && typeof value === 'object' && value[TAG] === true;
    }
}

/**
 * @param {Error} error
 * @param {string} name
 */
function tag(error, name) {
    Object.defineProperty(error, TAG, { value: true });
    error.name = name;
}

/**
 * Invalid query. Errors found while compiling start with their location
 * ("$or[1].age.$gtt: Unsupported query operator: $gtt"); the error without
 * the location is the cause.
 */
class QuerySyntaxError extends SyntaxError {
    /**
     * @param {string} message
     * @param {ErrorOptions} [options]
     */
    constructor(message, options) {
        super(message, options);
        tag(this, 'QuerySyntaxError');
    }
}

/**
 * Strict mode: two non-null values of different types were compared.
 */
class StrictTypeError extends TypeError {
    /**
     * @param {string} message
     * @param {ErrorOptions} [options]
     */
    constructor(message, options) {
        super(message, options);
        tag(this, 'StrictTypeError');
    }
}

/**
 * A $regex failed while matching a value (e.g. the regex engine ran out of
 * stack). Thrown instead of counting as "no match", which $not would turn
 * into a match.
 */
class RegexError extends Error {
    /**
     * @param {string} message
     * @param {ErrorOptions} [options]
     */
    constructor(message, options) {
        super(message, options);
        tag(this, 'RegexError');
    }
}

/**
 * A field path does not exist in the document (see setThrowOnUnknownVariable()).
 */
class UnknownVariableException extends Error {
    /**
     * @param {string} message
     * @param {ErrorOptions} [options]
     */
    constructor(message, options) {
        super(message, options);
        tag(this, 'UnknownVariableException');
    }
}

module.exports = {
    QueryCheckError,
    QuerySyntaxError,
    StrictTypeError,
    RegexError,
    UnknownVariableException,
};
