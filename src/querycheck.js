'use strict';

const { Compiler, parsePath, toSegments, walk, MISSING } = require('./compiler');
const {
    QueryCheckError,
    QuerySyntaxError,
    StrictTypeError,
    RegexError,
    UnknownVariableException,
} = require('./errors');

/**
 * Query check
 *
 * The query is compiled into a tree of closures on the first call to test()
 * (see Compiler) and reused for every following call. Changing a setting
 * discards the compiled query; it is rebuilt on the next test().
 *
 * @author Moritz Fain <moritz@fain.io>
 */
class QueryCheck {
    /** @type {any} */
    #query;
    #throwOnUnknownVariable = true;
    #strictMode = false;
    /** @type {((operand: any, data: object) => any)|null} */
    #operandEvaluator = null;
    /** @type {((data: object) => boolean)|null} */
    #compiled = null;

    /**
     * @param {object} query
     */
    constructor(query) {
        this.#query = query;
    }

    /**
     * When enabled (the default), a missing field throws
     * UnknownVariableException. When disabled, a missing field compares as
     * null, so {field: null} matches "null or missing", as in MongoDB.
     * An existing field with the value null is never unknown.
     *
     * @param {boolean} throwOnUnknown
     */
    setThrowOnUnknownVariable(throwOnUnknown) {
        this.#throwOnUnknownVariable = throwOnUnknown;
        this.#compiled = null;
    }

    /**
     * @param {boolean} strictMode
     */
    setStrictMode(strictMode) {
        this.#strictMode = strictMode;
        this.#compiled = null;
    }

    /**
     * The evaluator is called with this QueryCheck instance as `this`.
     *
     * @param {((this: QueryCheck, operand: any, data: object) => any)|null} fn
     */
    setOperandEvaluator(fn) {
        this.#operandEvaluator = fn === null ? null : (operand, data) => fn.call(this, operand, data);
        this.#compiled = null;
    }

    /**
     * @param {any} data
     * @returns {boolean}
     */
    test(data) {
        if (data === null || typeof data !== 'object' || Array.isArray(data)) {
            if (this.#strictMode) {
                throw new StrictTypeError('Input data must be a hash/object');
            }
            return false;
        }

        return this.#compile()(data);
    }

    /**
     * Compiles the query now and throws a QuerySyntaxError if it is invalid,
     * with the location in the message ("$or[1].age.$gtt: Unsupported query
     * operator: $gtt").
     *
     * test() compiles lazily on its first call, so a broken query would
     * otherwise only surface with the first document. Call validate() where
     * queries are loaded or saved, after the setters: changing a setting
     * discards the compiled query. The compiled query is kept, so the next
     * test() does not compile again.
     *
     * Errors that depend on the document (types, missing fields, values that
     * $add cannot add) are only found by test(). With an operand evaluator,
     * parts of $expr and $not are only compiled when a document reaches them.
     */
    validate() {
        this.#compile();
    }

    /**
     * @returns {(data: object) => boolean}
     */
    #compile() {
        return this.#compiled ??= new Compiler(
            this.#strictMode,
            this.#throwOnUnknownVariable,
            this.#operandEvaluator,
        ).compileQuery(this.#query);
    }

    /**
     * Resolves a field path like "customer.address.city" or "items[0].name"
     * against data, using this instance's setThrowOnUnknownVariable()
     * setting. Only own properties are resolved.
     *
     * @param {string} variableName
     * @param {object} data
     * @returns {any}
     */
    getVariableValue(variableName, data) {
        const value = walk(toSegments(parsePath(variableName)), data);

        if (value !== MISSING) {
            return value;
        }

        if (!this.#throwOnUnknownVariable) {
            return null;
        }

        throw new UnknownVariableException(`Variable '${variableName}' is not defined`);
    }
}

module.exports = QueryCheck;
module.exports.QueryCheck = QueryCheck;
module.exports.QueryCheckError = QueryCheckError;
module.exports.SyntaxError = QuerySyntaxError;
module.exports.QuerySyntaxError = QuerySyntaxError;
module.exports.StrictTypeError = StrictTypeError;
module.exports.RegexError = RegexError;
module.exports.UnknownVariableException = UnknownVariableException;
